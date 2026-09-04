self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const notification = self.registration.showNotification(data.title || 'Bentevi', {
    body: data.body || '',
    tag: data.tag || 'bentevi-notification',
    data: { url: data.url || '/' },
    icon: '/branding/bentevi/icon-192.png',
    badge: '/branding/bentevi/icon-192.png',
  });
  const notifyOpenPages = self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((pages) => pages.forEach((page) => page.postMessage({
      type: 'vortek-push',
      eventType: data.eventType || null,
    })));

  event.waitUntil(Promise.all([notification, notifyOpenPages]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => client.url === targetUrl);
    return existing ? existing.focus() : clients.openWindow(targetUrl);
  }));
});
