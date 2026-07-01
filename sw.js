/* Service worker — CalendarioGym
 * - Cache first para assets locales
 * - Network first para imágenes remotas del dataset (con fallback a cache)
 * - Soporte para notificaciones push via showNotification
 */

const VERSION = "calendariogym-v1.0.6";
const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./assets/exercises.json",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      cache.addAll(CORE.map((u) => new Request(u, { cache: "reload" }))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Mismo origen → cache-first con fallback a red
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req)
            .then((res) => {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
              return res;
            })
            .catch(() => caches.match("./index.html")),
      ),
    );
    return;
  }

  // GitHub raw (imágenes y gifs del dataset) → stale-while-revalidate
  if (url.host === "raw.githubusercontent.com") {
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const cached = await cache.match(req);
        const fetchPromise = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      }),
    );
  }
});

// Mensaje desde la página: trigger manual de notificación (ya cubierto por app.js
// con reg.showNotification, pero exponemos handler por si se quiere cronometrar
// en background en el futuro).
self.addEventListener("message", (event) => {
  if (event.data?.type === "test-notification") {
    self.registration.showNotification("🏋️ CalendarioGym", {
      body: "Notificación disparada desde el service worker.",
      icon: "assets/icons/icon-192.png",
      badge: "assets/icons/icon-192.png",
      tag: "gym-reminder",
      renotify: true,
    });
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      if (clients.length) return clients[0].focus();
      return self.clients.openWindow("./");
    }),
  );
});
