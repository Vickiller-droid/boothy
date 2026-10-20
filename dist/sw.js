// Only notification support: no cached private pages and no background timers.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL('./#ride', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    for (const client of clients) {
      if (new URL(client.url).origin === new URL(target).origin) { await client.navigate(target); return client.focus(); }
    }
    return self.clients.openWindow(target);
  }));
});
