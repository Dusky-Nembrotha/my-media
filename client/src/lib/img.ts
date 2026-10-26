/**
 * Cached artwork is stored as "/artwork/<file>", which is relative to wherever
 * the app is mounted — so it needs the base path putting back on.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

export function artworkUrl(src: string | null | undefined): string | undefined {
  if (!src) return undefined
  if (src.startsWith('/artwork/')) return BASE + src
  return src
}
