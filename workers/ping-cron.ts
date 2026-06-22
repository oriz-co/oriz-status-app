/*
 * oriz-status-ping — cron worker that probes every site in TARGETS every
 * 5 minutes and writes ONE consolidated KV blob (`status:current`) per
 * tick, plus fires a Telegram alert on any status transition.
 *
 * KV writes (1 per tick to stay under Free tier 1000 writes/day cap):
 *   - status:current : {
 *       at: number,
 *       services: ProbeResult[],          // latest snapshot
 *       previous: ProbeResult[],          // last tick's services (for diff)
 *       history: {                        // last 90 days, daily rollup
 *         [day: 'YYYY-MM-DD']: { [slug]: { up, down, total } }
 *       },
 *       incidents: Transition[]           // last 50 status transitions
 *     }
 *
 * Free-tier math: 25 targets × 288 ticks/day = 7,200 outbound subrequests/day
 * (Workers Free is 100K/day). KV writes: 1/tick × 288/day = 288 writes/day
 * (KV Free is 1,000/day). Comfortable headroom on both.
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

interface Transition {
  slug: string
  name: string
  from: string
  to: string
  at: number
  code: number
}

type DayRollup = Record<string, { up: number; down: number; total: number }>

interface StatusBlob {
  at: number
  services: ProbeResult[]
  previous: ProbeResult[]
  history: Record<string, DayRollup>
  incidents: Transition[]
}

const TIMEOUT_MS = 8000
const HISTORY_DAYS = 90
const INCIDENTS_CAP = 50

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

function pruneHistory(history: Record<string, DayRollup>, today: string): Record<string, DayRollup> {
  // Keep only the most recent HISTORY_DAYS days (lex order works for YYYY-MM-DD).
  const cutoff = new Date(today + 'T00:00:00Z')
  cutoff.setUTCDate(cutoff.getUTCDate() - (HISTORY_DAYS - 1))
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  const out: Record<string, DayRollup> = {}
  for (const day of Object.keys(history)) {
    if (day >= cutoffStr) out[day] = history[day]
  }
  return out
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

    // Single KV read for the consolidated blob.
    const prevRaw = await env.STATUS_KV.get('status:current')
    const prevBlob: StatusBlob | null = prevRaw ? JSON.parse(prevRaw) : null

    // Diff against previous snapshot for incident detection.
    const prevServices = prevBlob?.services ?? []
    const prevBySlug = new Map(prevServices.map(s => [s.slug, s]))

    const transitions: Transition[] = []
    for (const s of all) {
      const before = prevBySlug.get(s.slug)
      if (before && before.status !== s.status) {
        transitions.push({ slug: s.slug, name: s.name, from: before.status, to: s.status, at: now, code: s.code })
      }
    }

    // Daily rollup (in-memory, pruned to last 90 days).
    const day = new Date(now).toISOString().slice(0, 10)
    const history = prevBlob?.history ?? {}
    const today: DayRollup = history[day] ?? {}
    for (const r of all) {
      const slot = today[r.slug] ?? { up: 0, down: 0, total: 0 }
      slot.total++
      if (r.status === 'up' || r.status === 'degraded') slot.up++
      else slot.down++
      today[r.slug] = slot
    }
    history[day] = today
    const prunedHistory = pruneHistory(history, day)

    // Incidents log (capped 50).
    const prevIncidents = prevBlob?.incidents ?? []
    const incidents = transitions.length > 0
      ? [...transitions, ...prevIncidents].slice(0, INCIDENTS_CAP)
      : prevIncidents

    // Telegram alert (out-of-band, doesn't gate the write).
    if (transitions.length > 0) {
      const lines = transitions.map(t =>
        `${t.to === 'down' ? '🔴' : t.to === 'degraded' ? '🟡' : '🟢'} *${t.name}*  ${t.from} → *${t.to}*${t.code ? `  (HTTP ${t.code})` : ''}`
      )
      ctx.waitUntil(telegramAlert(env, `*oriz / status*\n\n${lines.join('\n')}\n\nhttps://status.oriz.in`))
    }

    // ONE KV write per tick (vs 4 previously). 288/day vs Free tier 1,000/day.
    const blob: StatusBlob = {
      at: now,
      services: all,
      previous: prevServices,
      history: prunedHistory,
      incidents,
    }
    ctx.waitUntil(env.STATUS_KV.put('status:current', JSON.stringify(blob)))
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
