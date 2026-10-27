const CACHE = 'coopfr-v40';
const ASSETS = ['./', 'index.html', 'app.js', 'style.css', 'manifest.webmanifest', 'logo.png'];

// Install: fetch every file fresh from the server (cache:'reload' skips the browser's own cache)
// so a stale copy can never be stored. A missing optional file does not block the install.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(ASSETS.map(a =>
        fetch(new Request(a, { cache: 'reload' }))
          .then(r => (r && r.ok) ? c.put(a, r) : null)
          .catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

// Activate: delete every older cache.
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fetch: NETWORK FIRST for every file (page, app.js, style.css…), so a new deployment is used straight
// away. The stored copy is only a fallback for when the device is offline.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                                  // never touch API POSTs
  if (new URL(req.url).origin !== location.origin) return;           // ignore cross-origin
  const fresh = req.mode === 'navigate' ? req : new Request(req, { cache: 'no-cache' });
  e.respondWith(
    fetch(fresh)
      .then(res => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('index.html')))
  );
});
