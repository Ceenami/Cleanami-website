// CleanNami web-push service worker.
function notificationUrl(value) {
  try {
    const url = new URL(typeof value === "string" ? value : "/", self.location.origin);
    if (url.origin === self.location.origin) return url.href;
  } catch {
    // Fall back to the website when an old or malformed payload has no usable URL.
  }
  return new URL("/", self.location.origin).href;
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "CleanNami", body: event.data ? event.data.text() : "" };
  }
  if (!data || typeof data !== "object") data = {};

  event.waitUntil(
    self.registration.showNotification(data.title || "CleanNami", {
      body: data.body || "",
      icon: "/android-chrome-192x192.png",
      badge: "/android-chrome-192x192.png",
      data: { url: notificationUrl(data.url) },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = notificationUrl(event.notification.data?.url);
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url === url && "focus" in client) {
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      })
  );
});
