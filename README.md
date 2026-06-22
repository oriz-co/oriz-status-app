# oriz-status-app

Custom status page + uptime monitoring for the oriz.in family. Replaces UptimeRobot (commercial-use ban, Oct 2024).

- **Public dashboard:** [status.oriz.in](https://status.oriz.in)
- **API:** `https://status-api.oriz.in/api/status` · `/api/uptime?slug=<slug>&days=30`
- **RSS:** `https://status.oriz.in/feed.xml`

## Architecture

- **Frontend** — Astro static site on CF Pages. Fetches `/api/status` client-side every 60 sec.
- **Backend** — two CF Workers:
  - `oriz-status-ping` — cron every 5 min. HEAD-pings every URL in `FAMILY_*` registries + master apex. Writes latest + rolls up daily history into KV. Telegram alert on status change.
  - `oriz-status-api` — serves `/api/status`, `/api/uptime`, `/api/incidents` from KV with 60 sec edge cache.
- **KV** — single namespace `STATUS_KV`. Keys: `latest`, `history:YYYY-MM-DD` (90-day TTL), `previous`, `incidents` (last 50, JSON array).

## Free-tier math

26 apps + 19 APIs + 14 packages + 5 books + master = ~65 fetches per cron tick.
288 ticks/day × 65 = **18,720 outbound fetches/day** — comfortable under the Workers Free 100K/day limit.

## Deploy

```bash
pnpm install
pnpm build
pnpm deploy:pages        # Astro → CF Pages
pnpm deploy:worker:ping  # cron worker
pnpm deploy:worker:api   # API worker
```

DNS (added via Cloudflare API in master `scripts/`):
- `status.oriz.in` CNAME → CF Pages
- `status-api.oriz.in` CNAME → workers.dev route

See [`knowledge/decisions/architecture/oriz-status-app.md`](https://github.com/oriz-co/oriz/blob/main/knowledge/decisions/architecture/oriz-status-app.md) for the full rationale.
