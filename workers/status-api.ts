/*
 * oriz-status-api — read-only Worker that serves the dashboard's data
 * needs from KV with a 60 sec edge cache.
 *
 *   GET /api/status                       — latest snapshot
 *   GET /api/uptime?slug=<slug>&days=30  — uptime % over last N days (1..90)
 *   GET /api/incidents                    — last 50 status transitions
 *   GET /feed.xml                         — RSS 2.0 of last 50 incidents
 *
 * CORS: open (Access-Control-Allow-Origin: *) — data is public.
 */

interface Env {
  STATUS_KV: KVNamespace
}

interface Transition {
  slug: string
  name: string
  from: string
  to: string
  at: number
  code: number
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

const json = (data: unknown, maxAge = 60): Response =>
  new Response(JSON.stringify(data), {
    headers: {
      ...CORS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${maxAge}, s-maxage=${maxAge}`,
    },
  })

async function uptime(env: Env, slug: string, days: number): Promise<Response> {
  const now = new Date()
  let upTotal = 0
  let total = 0
  const daily: { day: string; up: number; total: number; pct: number | null }[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() - i)
    const day = d.toISOString().slice(0, 10)
    const raw = await env.STATUS_KV.get(`history:${day}`)
    if (!raw) { daily.push({ day, up: 0, total: 0, pct: null }); continue }
    const parsed: Record<string, { up: number; down: number; total: number }> = JSON.parse(raw)
    const slot = parsed[slug]
    if (!slot) { daily.push({ day, up: 0, total: 0, pct: null }); continue }
    upTotal += slot.up
    total += slot.total
    daily.push({ day, up: slot.up, total: slot.total, pct: slot.total ? +(slot.up * 100 / slot.total).toFixed(2) : null })
  }
  return json({ slug, days, uptime: total ? +(upTotal * 100 / total).toFixed(3) : null, samples: total, daily })
}

function rss(incidents: Transition[]): Response {
  const items = incidents.map(t => {
    const title = `${t.name} ${t.from} → ${t.to}`
    const desc = `${t.name} transitioned from ${t.from} to ${t.to}${t.code ? ` (HTTP ${t.code})` : ''}`
    const pubDate = new Date(t.at).toUTCString()
    const guid = `${t.slug}-${t.at}`
    return `    <item>
      <title>${title}</title>
      <link>https://status.oriz.in/#${t.slug}</link>
      <description>${desc}</description>
      <pubDate>${pubDate}</pubDate>
      <guid isPermaLink="false">${guid}</guid>
    </item>`
  }).join('\n')
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>oriz / status incidents</title>
    <link>https://status.oriz.in</link>
    <description>Status transitions across the oriz.in family</description>
    <language>en</language>
${items}
  </channel>
</rss>`
  return new Response(body, {
    headers: {
      ...CORS,
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

    const url = new URL(request.url)
    if (url.pathname === '/api/status') {
      const latest = await env.STATUS_KV.get('latest')
      return json(latest ? JSON.parse(latest) : { at: null, services: [] })
    }
    if (url.pathname === '/api/uptime') {
      const slug = url.searchParams.get('slug')
      const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') ?? '30')))
      if (!slug) return json({ error: 'slug required' }, 0)
      return uptime(env, slug, days)
    }
    if (url.pathname === '/api/incidents' || url.pathname === '/feed.xml') {
      const raw = await env.STATUS_KV.get('incidents')
      const list: Transition[] = raw ? JSON.parse(raw) : []
      return url.pathname === '/feed.xml' ? rss(list) : json(list, 60)
    }
    if (url.pathname === '/' || url.pathname === '') {
      return new Response('oriz-status-api · GET /api/status · /api/uptime?slug=&days= · /api/incidents · /feed.xml', {
        headers: { ...CORS, 'Content-Type': 'text/plain' },
      })
    }
    return new Response('not found', { status: 404, headers: CORS })
  },
}
