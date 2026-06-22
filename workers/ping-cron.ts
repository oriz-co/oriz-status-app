/*
 * oriz-status-ping — cron worker that probes every site in TARGETS every
 * 5 minutes, writes the latest snapshot + a daily rollup to KV, and
 * fires a Telegram alert on any status transition.
 *
 * KV keys written:
 *   - latest          : { at, services: ProbeResult[] }     (no TTL — overwritten)
 *   - previous        : same shape, snapshot from the prior tick (used for diff)
 *   - history:YYYY-MM-DD : { [slug]: { up, down, total } }  (90 day TTL)
 *   - incidents       : last 50 status transitions as JSON array (no TTL, capped)
 *
 * Free-tier math: 24 targets × 288 ticks/day = 6,912 outbound subrequests/day.
 * Workers Free is 100K/day total, so we have ~14× headroom.
 *
 * If TARGETS grows past 50, drop subrequests-per-invocation past 50 (Free
 * limit) into chunks of 50.
 */
import { TARGETS } from './targets'

interface Env {
  STATUS_KV: KVNamespace
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_OPS_CHAT_ID?: string
}

interface ProbeResult {
  slug: string
  name: string
  url: string
  category: string
  status: 'up' | 'down' | 'degraded'
  code: number
  ms: number
  ts: number
  error?: string
}

const TIMEOUT_MS = 8000

async function probe(t: typeof TARGETS[number]): Promise<ProbeResult> {
  const start = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    // HEAD first — many CF Pages sites accept HEAD. Fall back to GET on 405.
    let r = await fetch(t.url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      cf: { cacheTtl: 0, cacheEverything: false } as RequestInitCfProperties,
    })
    if (r.status === 405 || r.status === 501) {
      r = await fetch(t.url, { method: 'GET', redirect: 'follow', signal: controller.signal })
    }
    clearTimeout(timer)
    const ms = Date.now() - start
    const status: ProbeResult['status'] = r.ok ? (ms > 3000 ? 'degraded' : 'up') : 'down'
    return { slug: t.slug, name: t.name, url: t.url, category: t.category, status, code: r.status, ms, ts: Date.now() }
  } catch (e) {
    clearTimeout(timer)
    return {
      slug: t.slug, name: t.name, url: t.url, category: t.category,
      status: 'down', code: 0, ms: Date.now() - start, ts: Date.now(),
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

async function telegramAlert(env: Env, text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_OPS_CHAT_ID) return
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_OPS_CHAT_ID, text, parse_mode: 'Markdown', disable_web_page_preview: true }),
    })
  } catch (e) {
    console.warn('telegram alert failed', e)
  }
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Chunk into batches of 25 to stay well under the 50-subrequest free-tier
    // limit per invocation.
    const batchSize = 25
    const all: ProbeResult[] = []
    for (let i = 0; i < TARGETS.length; i += batchSize) {
      const chunk = TARGETS.slice(i, i + batchSize)
      const results = await Promise.all(chunk.map(probe))
      all.push(...results)
    }

    const now = Date.now()
    const snapshot = { at: now, services: all }

    // Diff against previous snapshot for incident detection.
    const prevRaw = await env.STATUS_KV.get('latest')
    const prev: { at: number; services: ProbeResult[] } | null = prevRaw ? JSON.parse(prevRaw) : null
    const prevBySlug = new Map((prev?.services ?? []).map(s => [s.slug, s]))

    const transitions: { slug: string; name: string; from: string; to: string; at: number; code: number }[] = []
    for (const s of all) {
      const before = prevBySlug.get(s.slug)
      if (before && before.status !== s.status) {
        transitions.push({ slug: s.slug, name: s.name, from: before.status, to: s.status, at: now, code: s.code })
      }
    }

    // Daily rollup
    const day = new Date(now).toISOString().slice(0, 10)
    const historyKey = `history:${day}`
    const existing: Record<string, { up: number; down: number; total: number }> =
      JSON.parse((await env.STATUS_KV.get(historyKey)) || '{}')
    for (const r of all) {
      const slot = existing[r.slug] ?? { up: 0, down: 0, total: 0 }
      slot.total++
      if (r.status === 'up' || r.status === 'degraded') slot.up++
      else slot.down++
      existing[r.slug] = slot
    }

    // Incidents log (capped 50)
    if (transitions.length > 0) {
      const incidentsRaw = (await env.STATUS_KV.get('incidents')) || '[]'
      const incidents: typeof transitions = JSON.parse(incidentsRaw)
      const updated = [...transitions, ...incidents].slice(0, 50)
      ctx.waitUntil(env.STATUS_KV.put('incidents', JSON.stringify(updated)))

      // Telegram alert
      const lines = transitions.map(t =>
        `${t.to === 'down' ? '🔴' : t.to === 'degraded' ? '🟡' : '🟢'} *${t.name}*  ${t.from} → *${t.to}*${t.code ? `  (HTTP ${t.code})` : ''}`
      )
      ctx.waitUntil(telegramAlert(env, `*oriz / status*\n\n${lines.join('\n')}\n\nhttps://status.oriz.in`))
    }

    ctx.waitUntil(env.STATUS_KV.put('previous', prevRaw || '{}'))
    ctx.waitUntil(env.STATUS_KV.put('latest', JSON.stringify(snapshot)))
    ctx.waitUntil(env.STATUS_KV.put(historyKey, JSON.stringify(existing), { expirationTtl: 90 * 86400 }))
  },

  // Allow manual trigger via fetch (for testing).
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/trigger' && request.method === 'POST') {
      await this.scheduled({} as ScheduledController, env, ctx)
      return new Response('ok', { status: 200 })
    }
    return new Response('oriz-status-ping cron worker — POST /trigger to run on demand', {
      headers: { 'Content-Type': 'text/plain' },
    })
  },
}
