"use client";

import { useEffect, useRef } from "react";

/**
 * Privacy-respecting open + duration tracker for the public status portal.
 *
 * - Stable `sessionId` is persisted in localStorage so re-opening the link in
 *   the same browser counts as one session, not many.
 * - Foreground-active time is measured client-side: a wall-clock tick starts
 *   on mount and on visibilitychange→visible; it stops on visibilitychange→
 *   hidden and on unmount. We push the delta (active + visible) on each
 *   heartbeat so server-side roll-ups can't be inflated by a single overnight
 *   tab.
 * - On `pagehide` / `visibilitychange→hidden` we flush via `navigator.send
 *   Beacon` which works during navigation. Errors swallowed — telemetry must
 *   never break the customer's page.
 */
export function useVisitTracker(token: string, stage: number) {
  const lastFlushRef = useRef<number>(0);
  const lastVisibleStartRef = useRef<number | null>(null);
  const activeMsAccumRef = useRef<number>(0);
  const visibleMsAccumRef = useRef<number>(0);
  const sessionIdRef = useRef<string>("");
  const channelRef = useRef<string>("unknown");
  const sentOpenRef = useRef<boolean>(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // ── sessionId from localStorage (per-token so cross-deal links stay
    //    distinct even on a shared browser). Fresh UUID v4 on miss.
    const key = `kottke.portal.session.${token}`;
    let sid = "";
    try {
      sid = window.localStorage.getItem(key) ?? "";
    } catch {
      // private mode / quota — fall through and use a per-mount id.
    }
    if (!sid) {
      sid = randomUuid();
      try {
        window.localStorage.setItem(key, sid);
      } catch {
        // ignore
      }
    }
    sessionIdRef.current = sid;

    // ── Best-effort channel inference from referrer + utm.
    const url = new URL(window.location.href);
    const utm = url.searchParams.get("utm_source")?.toLowerCase() ?? "";
    if (utm === "sms" || utm === "whatsapp" || utm === "email" || utm === "share_panel") {
      channelRef.current = utm;
    } else {
      const ref = document.referrer.toLowerCase();
      if (ref.includes("whatsapp")) channelRef.current = "whatsapp";
      else if (ref.includes("mail")) channelRef.current = "email";
      else if (ref === "") channelRef.current = "sms";
      else channelRef.current = "unknown";
    }

    lastFlushRef.current = Date.now();
    lastVisibleStartRef.current =
      document.visibilityState === "visible" ? Date.now() : null;

    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

    function tickActive(now: number) {
      const startedAt = lastVisibleStartRef.current;
      if (startedAt != null) {
        const delta = Math.max(0, now - startedAt);
        // Cap a single tick to 60 s so a backgrounded laptop can't claim
        // multi-hour engagement. The next heartbeat resets the window.
        activeMsAccumRef.current += Math.min(delta, 60_000);
        visibleMsAccumRef.current += Math.min(delta, 60_000);
        lastVisibleStartRef.current = now;
      }
    }

    function buildPayload(event: "open" | "heartbeat") {
      return JSON.stringify({
        sessionId: sessionIdRef.current,
        event,
        activeMsDelta: Math.round(activeMsAccumRef.current),
        visibleMsDelta: Math.round(visibleMsAccumRef.current),
        channel: channelRef.current,
        referrer: document.referrer || null,
        isMobile,
        stageAtOpen: stage,
      });
    }

    async function flush(event: "open" | "heartbeat") {
      const now = Date.now();
      tickActive(now);
      if (event === "heartbeat" && activeMsAccumRef.current < 1000 && sentOpenRef.current) {
        // Under one second of new engagement — skip.
        return;
      }
      const body = buildPayload(event);
      activeMsAccumRef.current = 0;
      visibleMsAccumRef.current = 0;
      lastFlushRef.current = now;
      try {
        // Prefer fetch with keepalive; fall back to sendBeacon on lifecycle
        // events where fetch is unreliable.
        await fetch(`/api/public/${token}/track`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        });
        sentOpenRef.current = true;
      } catch {
        // Telemetry — best effort.
      }
    }

    function beaconFlush() {
      const now = Date.now();
      tickActive(now);
      if (activeMsAccumRef.current < 250 && sentOpenRef.current) return;
      const body = buildPayload("heartbeat");
      activeMsAccumRef.current = 0;
      visibleMsAccumRef.current = 0;
      lastFlushRef.current = now;
      try {
        const blob = new Blob([body], { type: "application/json" });
        navigator.sendBeacon(`/api/public/${token}/track`, blob);
      } catch {
        // ignore
      }
    }

    // First-open beacon (records session_id + channel + ua + ip).
    void flush("open");

    const interval = window.setInterval(() => {
      void flush("heartbeat");
    }, 25_000);

    function onVisibility() {
      const now = Date.now();
      if (document.visibilityState === "visible") {
        lastVisibleStartRef.current = now;
      } else {
        tickActive(now);
        lastVisibleStartRef.current = null;
        beaconFlush();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);

    function onPageHide() {
      beaconFlush();
    }
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onPageHide);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onPageHide);
      beaconFlush();
    };
  }, [token, stage]);
}

function randomUuid(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    // ignore
  }
  // Fallback: time + random hex. Not RFC 4122 but stable per browser.
  return (
    "fb-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  );
}
