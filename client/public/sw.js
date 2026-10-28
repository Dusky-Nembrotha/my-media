/*
 * The smallest service worker that makes the app installable.
 *
 * Deliberately timid. A worker that caches too eagerly pins people to an old
 * build and is miserable to undo from a phone, so: the API is never cached,
 * navigations always go to the network and only fall back to a stored shell
 * when there is no network at all, and the only thing kept is the hashed
 * asset bundle — whose names change on every build, so a stale copy cannot
 * be served by mistake.
 */
const VERSION = 'shelved-v1'
const SHELL = new URL('./', self.registration.scope).pathname

self.addEventListener('install', (event) => {
  // Take over straight away rather than waiting for every tab to close.
  self.skipWaiting()
  event.waitUntil(caches.open(VERSION).then((c) => c.add(SHELL)).catch(() => {}))
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // Your library is live data and belongs to the server, always.
  if (url.pathname.includes('/api/')) return

  // A page: fresh if possible, the stored shell if the network is gone.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match(SHELL)) || Response.error()),
    )
    return
  }

  // Hashed assets and artwork: safe to keep, since the name changes when the
  // content does.
  if (/\/assets\/|\/artwork\/|\.(png|svg|jpg|webp|woff2?)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const hit = await caches.match(request)
      if (hit) return hit
      const res = await fetch(request)
      if (res.ok) (await caches.open(VERSION)).put(request, res.clone())
      return res
    })())
  }
})
