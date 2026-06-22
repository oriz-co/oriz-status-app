/*
 * Shared targets registry — single source of truth for what the cron worker
 * pings AND for what the dashboard renders. Kept inline (not pulled from
 * @chirag127/astro-shell at runtime) because Workers can't import npm
 * packages in this shape and we want the registry to ship inside the
 * worker bundle.
 *
 * To regenerate after adding a new app/api:
 *   node scripts/sync-from-shell.mjs   (TODO — wires to FAMILY_* registries)
 *
 * Mirrors `@chirag127/astro-shell/family-data` as of 2026-06-22.
 */
export interface Target {
  slug: string
  name: string
  url: string
  category: 'master' | 'app' | 'api' | 'package' | 'book'
  status: 'live' | 'planned'
}

export const TARGETS: Target[] = [
  /* ── master apex ─────────────────────────────────────────────── */
  { slug: 'master', name: 'oriz.in', url: 'https://oriz.in', category: 'master', status: 'live' },

  /* ── apps (one-level subdomains, live) ───────────────────────── */
  { slug: 'me', name: 'me.oriz.in', url: 'https://me.oriz.in', category: 'app', status: 'live' },
  { slug: 'blog', name: 'blog.oriz.in', url: 'https://blog.oriz.in', category: 'app', status: 'live' },
  { slug: 'books', name: 'books.oriz.in', url: 'https://books.oriz.in', category: 'app', status: 'live' },
  { slug: 'book-lore', name: 'book-lore.oriz.in', url: 'https://book-lore.oriz.in', category: 'app', status: 'live' },
  { slug: 'financial-cards', name: 'financial-cards.oriz.in', url: 'https://financial-cards.oriz.in', category: 'app', status: 'live' },
  { slug: 'journal', name: 'journal.oriz.in', url: 'https://journal.oriz.in', category: 'app', status: 'live' },
  { slug: 'post', name: 'post.oriz.in', url: 'https://post.oriz.in', category: 'app', status: 'live' },
  { slug: 'packages', name: 'packages.oriz.in', url: 'https://packages.oriz.in', category: 'app', status: 'live' },

  /* ── tool subdomains ─────────────────────────────────────────── */
  { slug: 'pdf', name: 'pdf.oriz.in', url: 'https://pdf.oriz.in', category: 'app', status: 'live' },
  { slug: 'image', name: 'image.oriz.in', url: 'https://image.oriz.in', category: 'app', status: 'live' },
  { slug: 'text', name: 'text.oriz.in', url: 'https://text.oriz.in', category: 'app', status: 'live' },
  { slug: 'qr', name: 'qr.oriz.in', url: 'https://qr.oriz.in', category: 'app', status: 'live' },
  { slug: 'finance', name: 'finance.oriz.in', url: 'https://finance.oriz.in', category: 'app', status: 'live' },
  { slug: 'dev', name: 'dev.oriz.in', url: 'https://dev.oriz.in', category: 'app', status: 'live' },
  { slug: 'convert', name: 'convert.oriz.in', url: 'https://convert.oriz.in', category: 'app', status: 'live' },
  { slug: 'data', name: 'data.oriz.in', url: 'https://data.oriz.in', category: 'app', status: 'live' },
  { slug: 'audio', name: 'audio.oriz.in', url: 'https://audio.oriz.in', category: 'app', status: 'live' },
  { slug: 'video', name: 'video.oriz.in', url: 'https://video.oriz.in', category: 'app', status: 'live' },

  /* ── API subdomains (the 19 grandfathered *.api.oriz.in -> one-level mirrors) ─ */
  { slug: 'currency-api', name: 'currency-api.oriz.in', url: 'https://currency-api.oriz.in', category: 'api', status: 'live' },
  { slug: 'mmi-api', name: 'mmi-api.oriz.in', url: 'https://mmi-api.oriz.in', category: 'api', status: 'live' },
  { slug: 'rates-api', name: 'rates-api.oriz.in', url: 'https://rates-api.oriz.in', category: 'api', status: 'live' },
  { slug: 'pin-api', name: 'pin-api.oriz.in', url: 'https://pin-api.oriz.in', category: 'api', status: 'live' },
  { slug: 'ifsc-api', name: 'ifsc-api.oriz.in', url: 'https://ifsc-api.oriz.in', category: 'api', status: 'live' },
]
