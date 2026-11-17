self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() || '' }; }
  const title = data.title || 'PennyBuys update';
  const options = {
    body: data.body || 'There is an update waiting for you.',
    icon: '/Media/pennybuys-logo.png',
    badge: '/Media/pennybuys-logo.png',
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
