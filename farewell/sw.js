// Self-destroying service worker.
//
// The app used to live here with a Workbox precache scoped to /cocktail/. An
// installed PWA boots from that precache, so simply deleting the old build
// isn't enough — the phone keeps serving the app it already has and never sees
// the farewell page.
//
// Workbox's autoUpdate registration re-fetches this URL on navigation. Serving
// this file instead of the old one hands control to a worker whose only job is
// to erase every cache, unregister itself, and reload any open window — after
// which the origin behaves like a plain website again.
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
      await self.registration.unregister()
      const windows = await self.clients.matchAll({ type: 'window' })
      for (const client of windows) client.navigate(client.url)
    })(),
  )
})

// Until the activate step finishes, pass everything straight to the network so
// nothing is answered from the stale precache.
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request))
})
