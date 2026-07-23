import { precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope;

// Navigation requests go network-first so the auth proxy can redirect to login
// when the session expires, rather than serving a stale cached page.
// NetworkFirst falls back to its own cache when offline.
registerRoute(
  new NavigationRoute(new NetworkFirst({ cacheName: 'navigations' })),
);

precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('push', (event) => {
  const { title, body, tag } = (event as PushEvent).data!.json() as {
    title: string;
    body: string;
    tag: string;
  };
  event.waitUntil(self.registration.showNotification(title, { body, tag }));
});

self.addEventListener('notificationclick', (event) => {
  (event as NotificationEvent).notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) return (client as WindowClient).focus();
        }
        return self.clients.openWindow('/');
      }),
  );
});
