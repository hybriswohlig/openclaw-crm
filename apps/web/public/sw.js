// Kottke CRM service worker — push notifications + basic offline shell.
// Scope is the site root, so this file MUST live in /public.

const CACHE_VERSION = "kottke-v2";

self.addEventListener("install", (event) => {
  // Activate immediately so the new SW takes over on next page load.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Purge EVERY cache left over from any previous service-worker version.
      // Older versions may have cached app assets; without this, a stale bundle
      // can keep running after a deploy and throw client-side exceptions.
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (_) {
        // ignore — best effort
      }
      await self.clients.claim();
    })()
  );
});

// No fetch handler: this service worker never serves cached responses, so the
// browser always fetches fresh app code from the network. (Push only.)

self.addEventListener("push", (event) => {
  // Default payload if push arrives without a body
  let payload = {
    title: "Kottke",
    body: "Neue Nachricht.",
    url: "/inbox",
    tag: "kottke-inbox",
  };

  try {
    if (event.data) {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    }
  } catch (err) {
    try {
      payload.body = event.data ? event.data.text() : payload.body;
    } catch (_) {
      // ignore
    }
  }

  const options = {
    body: payload.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: payload.tag || "kottke-inbox",
    data: { url: payload.url || "/inbox" },
    requireInteraction: false,
    silent: false,
    vibrate: [80, 40, 80],
  };

  event.waitUntil(self.registration.showNotification(payload.title || "Kottke", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/inbox";

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Focus an existing tab if one is already on the target URL
      for (const client of clientsList) {
        try {
          const url = new URL(client.url);
          if (client.url.includes(targetUrl)) {
            return client.focus();
          }
          // Or any same-origin tab — focus and navigate
          if (url.origin === self.location.origin && "navigate" in client) {
            await client.focus();
            return client.navigate(targetUrl);
          }
        } catch (_) {
          // ignore parse errors
        }
      }

      // Otherwise open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })()
  );
});

// Keep subscription fresh when the browser silently rotates the endpoint
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const sub = await self.registration.pushManager.getSubscription();
        if (!sub) return;
        await fetch("/api/v1/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription: sub.toJSON() }),
        });
      } catch (err) {
        // best effort — next page load will re-subscribe
      }
    })()
  );
});
