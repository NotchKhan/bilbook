// Intentionally network-only: no fetch handler, no offline copies of private content.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("bilspace-")) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("message", (event) => {
  if (event.data?.type === "LOGOUT")
    event.waitUntil(
      (async () => {
        for (const key of await caches.keys()) {
          if (key.startsWith("bilspace-")) await caches.delete(key);
        }
      })(),
    );
});
