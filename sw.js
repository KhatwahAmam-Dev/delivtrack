// Service Worker DelivTrack
// Tugas: (1) menyajikan aplikasi walau tanpa internet, (2) menyimpan tile peta
// yang pernah dilihat, (3) menerima Background Sync untuk memicu unggahan Google Drive.

const VERSION = 'v1.0.5';
const SHELL_CACHE = `delivtrack-shell-${VERSION}`;
const TILE_CACHE = `delivtrack-tile-${VERSION}`;
const RUNTIME_CACHE = `delivtrack-runtime-${VERSION}`;
const TILE_LIMIT = 600;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/config.js',
  './js/util.js',
  './js/icons.js',
  './js/db.js',
  './js/geo.js',
  './js/camera.js',
  './js/scanner.js',
  './js/signature.js',
  './js/ui.js',
  './js/map.js',
  './js/photobox.js',
  './js/messaging.js',
  './js/report.js',
  './js/drive.js',
  './js/sync.js',
  './js/trip.js',
  './js/views/setup.js',
  './js/views/prepare.js',
  './js/views/route.js',
  './js/views/handover.js',
  './js/views/done.js',
  './js/views/history.js',
  './js/views/settings.js',
  './vendor/leaflet.css',
  './vendor/leaflet.js',
  './vendor/jspdf.umd.min.js',
  './vendor/xlsx.full.min.js',
  './vendor/zxing.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // addAll gagal total bila satu berkas hilang — tambahkan satu per satu.
      await Promise.all(
        SHELL.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
        )
      );
      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => ![SHELL_CACHE, TILE_CACHE, RUNTIME_CACHE].includes(k))
          .map((k) => caches.delete(k))
      );
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.disable();
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Panggilan Google Drive / GIS tidak boleh di-cache.
  if (/(googleapis|accounts\.google|gstatic\.com\/gsi)/.test(url.host + url.pathname)) return;

  if (isTile(url)) {
    e.respondWith(cacheFirst(req, TILE_CACHE, TILE_LIMIT));
    return;
  }

  if (url.origin !== self.location.origin) {
    e.respondWith(networkFirst(req, RUNTIME_CACHE));
    return;
  }

  if (req.mode === 'navigate') {
    e.respondWith(navigationHandler(req));
    return;
  }

  e.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
});

function isTile(url) {
  return (
    /tile\.openstreetmap\.org$/.test(url.hostname) ||
    /tile\./.test(url.hostname) ||
    /\/\d+\/\d+\/\d+\.png$/.test(url.pathname)
  );
}

async function navigationHandler(req) {
  try {
    const res = await fetch(req);
    const cache = await caches.open(SHELL_CACHE);
    cache.put('./index.html', res.clone());
    return res;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (
      (await cache.match('./index.html')) ||
      (await cache.match('./')) ||
      new Response('<h1>DelivTrack offline</h1>', { headers: { 'Content-Type': 'text/html' } })
    );
  }
}

async function cacheFirst(req, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) {
      await cache.put(req, res.clone());
      if (limit) trimCache(cacheName, limit);
    }
    return res;
  } catch (e) {
    return hit || Response.error();
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: true });
  const network = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return hit || (await network) || Response.error();
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: true });
    return hit || Response.error();
  }
}

async function trimCache(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
}

/* ---------------- Latar belakang & pesan ---------------- */

self.addEventListener('sync', (e) => {
  if (e.tag !== 'delivtrack-upload') return;
  e.waitUntil(pingClients());
});

self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'delivtrack-flush') e.waitUntil(pingClients());
});

self.addEventListener('message', (e) => {
  const type = e.data?.type;
  if (type === 'skip-waiting') self.skipWaiting();
  if (type === 'flush-queue') e.waitUntil?.(pingClients());
  if (type === 'version') {
    e.source?.postMessage({ type: 'version', version: VERSION });
  }
});

async function pingClients() {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  if (!clients.length) {
    // Tidak ada jendela aktif: coba bangunkan lewat notifikasi bila diizinkan.
    return maybeNotify();
  }
  clients.forEach((c) => c.postMessage({ type: 'flush-queue' }));
}

async function maybeNotify() {
  try {
    if (self.Notification?.permission !== 'granted') return;
    await self.registration.showNotification('DelivTrack', {
      body: 'Ada data pengantaran yang menunggu diunggah ke Google Drive.',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: 'delivtrack-upload',
    });
  } catch {
    /* diabaikan */
  }
}

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.includes(self.registration.scope));
      if (open) return open.focus();
      return self.clients.openWindow('./index.html?action=history');
    })
  );
});
