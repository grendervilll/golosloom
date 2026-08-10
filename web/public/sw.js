// Service worker: сеть-первый с фолбэком на кэш.
// Для чата важна свежесть (новые сборки), кэш — только чтобы приложение
// открывалось при недоступной сети и быстрее стартовало.
const CACHE = 'golosloom-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  // API и WebSocket не кэшируем.
  if (url.pathname.startsWith('/api') || url.pathname === '/ws' || url.protocol !== self.location.protocol) return
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        const res = await fetch(req)
        if (res && res.ok && url.origin === self.location.origin) cache.put(req, res.clone())
        return res
      } catch {
        const cached = await cache.match(req, { ignoreSearch: url.pathname === '/' })
        return cached || Response.error()
      }
    }),
  )
})
