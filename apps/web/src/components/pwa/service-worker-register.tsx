"use client";

import { useEffect } from "react";

/**
 * Registers the root-scope service worker once on first mount. Kept silent on
 * iOS Safari pre-16.4 (no `serviceWorker` API on that platform) by feature-
 * detecting before touching the API.
 *
 * The actual push permission prompt is gated behind an explicit user click in
 * `<EnablePushButton/>` — required by iOS Safari for installed PWAs.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") return;

    const controller = new AbortController();

    (async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[pwa] service worker registration failed", err);
      }
    })();

    return () => controller.abort();
  }, []);

  return null;
}
