"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, X, Loader2 } from "lucide-react";

/**
 * App-launch prompt for push permissions.
 *
 * UX rules:
 *  - Shows once per app session when `Notification.permission === "default"`
 *    (i.e. user has neither granted nor denied yet).
 *  - "Später" hides it for this session via sessionStorage — the next app
 *    launch (or PWA cold start on iOS) prompts again.
 *  - "Aktivieren" runs the same subscribe flow the settings page uses.
 *  - On iOS we only render if the app is running standalone (homescreen
 *    PWA), because Safari tabs can't show the system prompt anyway.
 *  - Never appears when permission is already "granted" or "denied", and
 *    never appears while VAPID server config is missing.
 */
const SESSION_KEY = "kottke.push.banner.dismissed";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

export function PushPromptBanner() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [vapidKey, setVapidKey] = useState<string | null>(null);
  // On iOS Safari (not installed): we render a different, low-key hint
  // suggesting "Add to Home Screen". Hidden on all other platforms.
  const [iosInstallHint, setIosInstallHint] = useState(false);

  const checkAndShow = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (
      window.location.protocol !== "https:" &&
      window.location.hostname !== "localhost"
    )
      return;

    // Dismissed for this session — stay quiet until next cold start.
    try {
      if (sessionStorage.getItem(SESSION_KEY) === "1") return;
    } catch {
      /* private mode etc. — ignore */
    }

    // iOS in Safari tab: prompt the user to add to homescreen instead of
    // requesting permission (the request can't succeed in a tab).
    if (isIOS() && !isStandalone()) {
      setIosInstallHint(true);
      setVisible(true);
      return;
    }

    if (Notification.permission !== "default") return;

    // Fetch VAPID key. If server hasn't been configured yet, skip — no
    // point asking the user to enable something the server can't fulfil.
    try {
      const res = await fetch("/api/v1/push/vapid-public-key");
      const data = (await res.json()) as { publicKey: string | null };
      if (!data?.publicKey) return;
      setVapidKey(data.publicKey);
    } catch {
      return;
    }

    // If a subscription already exists in the SW but permission is somehow
    // still "default", trust the existing sub and don't nag.
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) return;
    } catch {
      /* fall through and show banner */
    }

    setVisible(true);
  }, []);

  useEffect(() => {
    checkAndShow();
  }, [checkAndShow]);

  function dismiss() {
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      /* ignore — banner will just re-show */
    }
    setVisible(false);
  }

  async function enable() {
    if (busy) return;
    setBusy(true);
    try {
      if (!vapidKey) {
        // VAPID disappeared between mount and click — bail quietly.
        dismiss();
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        // "denied" is permanent in iOS PWA — never ask again this session;
        // settings page is the way back. "default" means user dismissed
        // the iOS prompt — leave the banner up for the next launch.
        if (permission === "denied") dismiss();
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const keyBytes = urlBase64ToUint8Array(vapidKey);
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes.buffer.slice(
            keyBytes.byteOffset,
            keyBytes.byteOffset + keyBytes.byteLength
          ) as ArrayBuffer,
        });
      }

      await fetch("/api/v1/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription: sub.toJSON(),
          deviceLabel:
            navigator.userAgent.length > 80
              ? navigator.userAgent.slice(0, 80)
              : navigator.userAgent,
        }),
      });
      setVisible(false);
    } catch {
      // Network or browser-side error — let the next launch retry. Don't
      // mark as dismissed.
    } finally {
      setBusy(false);
    }
  }

  if (!visible) return null;

  if (iosInstallHint) {
    return (
      <BannerShell onDismiss={dismiss}>
        <div className="flex items-start gap-3">
          <span
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{
              background: "color-mix(in srgb, var(--accent-soft) 60%, var(--paper))",
              color: "var(--kottke-accent)",
            }}
          >
            <Bell size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div
              className="k-display"
              style={{ fontSize: 14, fontWeight: 500 }}
            >
              Push-Mitteilungen bei neuen Nachrichten
            </div>
            <p
              className="mt-1 text-[12.5px]"
              style={{ color: "var(--ink-soft)" }}
            >
              Tippe in Safari auf <b>Teilen</b> → <b>Zum Home-Bildschirm</b>,
              öffne die App von dort und du kannst sofort Mitteilungen
              aktivieren.
            </p>
          </div>
        </div>
      </BannerShell>
    );
  }

  return (
    <BannerShell onDismiss={dismiss}>
      <div className="flex items-start gap-3">
        <span
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{
            background: "color-mix(in srgb, var(--accent-soft) 60%, var(--paper))",
            color: "var(--kottke-accent)",
          }}
        >
          <Bell size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div
            className="k-display"
            style={{ fontSize: 14, fontWeight: 500 }}
          >
            Push-Mitteilungen aktivieren
          </div>
          <p
            className="mt-1 text-[12.5px]"
            style={{ color: "var(--ink-soft)" }}
          >
            Bekomme eine Mitteilung sobald ein Kunde schreibt — auch wenn die
            App geschlossen ist.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              className="k-btn primary sm"
              onClick={enable}
              disabled={busy}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Aktivieren
            </button>
            <button className="k-btn ghost sm" onClick={dismiss}>
              Später
            </button>
          </div>
        </div>
      </div>
    </BannerShell>
  );
}

function BannerShell({
  children,
  onDismiss,
}: {
  children: React.ReactNode;
  onDismiss: () => void;
}) {
  return (
    <div
      className="k-card relative md:rounded-2xl"
      style={{
        margin: "10px 12px 0",
        padding: "12px 14px",
        background: "#fff",
        border: "1px dashed color-mix(in oklch, var(--kottke-accent) 30%, transparent)",
        boxShadow: "0 1px 2px rgba(34,29,22,.03), 0 6px 18px -8px rgba(34,29,22,.08)",
      }}
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Schließen"
        className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md"
        style={{ color: "var(--ink-muted)" }}
      >
        <X size={14} />
      </button>
      {children}
    </div>
  );
}
