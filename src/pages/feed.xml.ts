/*
 * Build-time stub. RSS is served by the status-api Worker at
 * https://status-api.oriz.in/feed.xml because KV reads happen at the
 * edge, not at static-build time. This static file is a 0-byte
 * placeholder so /feed.xml on the Pages domain redirects clients to
 * the canonical worker route via the <meta refresh> fallback.
 *
 * In production, set up a CF Pages redirect rule in _redirects so
 * /feed.xml -> https://status-api.oriz.in/feed.xml (302).
 */
import type { APIRoute } from 'astro'

export const GET: APIRoute = async () => {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Canonical RSS lives at https://status-api.oriz.in/feed.xml — this file is a build-time placeholder. -->\n<rss version="2.0"><channel><title>oriz / status incidents</title><link>https://status-api.oriz.in/feed.xml</link><description>See canonical feed at status-api.oriz.in/feed.xml</description></channel></rss>\n`,
    { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } }
  )
}
