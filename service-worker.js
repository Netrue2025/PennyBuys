const SHELL_CACHE = 'pennybuys-app-shell-v2';
const SHELL_FILES = [
  '/app.html',
  '/shopping-app.css',
  '/shopping-app.js',
  '/pwa.js',
  '/push-client.js',
  '/pwa.css',
  '/products-data.js',
  '/currency.css',
  '/currency.js',
  '/image-fallback.js',
  '/Media/pennybuys-logo.png',
  '/Media/pennybuys-icon.png',
  '/Media/pennybuys-app-icon.svg',
  '/Media/product-placeholder.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => Promise.allSettled(SHELL_FILES.map(file => cache.add(file)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('pennybuys-app-shell-') && key !== SHELL_CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate' && url.pathname === '/app.html') {
    const network = fetch(request).then(async response => {
      if (response.ok) {
        const cache = await caches.open(SHELL_CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    });
    event.respondWith(network.catch(async () => (await caches.match('/app.html')) || Response.error()));
    return;
  }
  if (SHELL_FILES.includes(url.pathname)) {
    const update = fetch(request).then(async response => {
      if (response.ok) {
        const cache = await caches.open(SHELL_CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    }).catch(() => null);
    event.waitUntil(update.then(() => undefined));
    event.respondWith(caches.match(request).then(cached => cached || update.then(response => response || Response.error())));
  }
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() || '' }; }
  const title = data.title || 'PennyBuys update';
  const options = {
    body: data.body || 'There is an update waiting for you.',
    icon: '/Media/pennybuys-icon.png',
    badge: '/Media/pennybuys-icon.png',
    tag: data.tag || 'pennybuys-update',
    renotify: true,
    data: { url: data.url || '/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const sameOrigin = clients.find(client => new URL(client.url).origin === self.location.origin);
    if (sameOrigin) { await sameOrigin.focus(); sameOrigin.navigate(target); }
    else await self.clients.openWindow(target);
  })());
});
