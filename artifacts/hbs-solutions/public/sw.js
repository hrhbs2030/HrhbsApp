// HBS حلول الغد — Web Push service worker.
// Shows the notification the server pushed and opens the portal page it
// points to. No fetch handler and no caching: the page is served as before.
/* eslint-disable no-restricted-globals */

// The worker is registered with scope `${basePath}/`, so the base path is the
// scope's pathname without its trailing slash ('' when the site is at '/').
const basePath = new URL(self.registration.scope).pathname.replace(/\/$/, '');

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: event.data ? event.data.text() : '' }; }
  const title = data.title || 'HBS حلول الغد';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: basePath + '/icon-192.png',
    badge: basePath + '/icon-192.png',
    dir: 'rtl',
    lang: 'ar',
    data: { path: typeof data.path === 'string' ? data.path : '/' },
    tag: 'hbs-' + (data.id != null ? data.id : Date.now()),
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.path) || '/';
  const origin = self.location.origin;
  const target = origin + basePath + (path.startsWith('/') ? path : '/' + path);
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => client.url.startsWith(origin));
    if (existing) {
      const focused = 'navigate' in existing ? existing.navigate(target).catch(() => existing) : Promise.resolve(existing);
      return focused.then((client) => (client || existing).focus());
    }
    return self.clients.openWindow(target);
  }));
});
