"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";

type Status =
  | "loading"
  | "unsupported"
  | "ios-not-installed"
  | "blocked"
  | "ready"
  | "subscribed";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const out = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) out[i] = rawData.charCodeAt(i);
  return out;
}

function isIOS(): boolean {
  if (typeof window === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function isPwaStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

export function EnablePushButton() {
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
      return;
    }
    // iOS only delivers Web Push when the PWA has been added to the homescreen
    if (isIOS() && !isPwaStandalone()) {
      setStatus("ios-not-installed");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("blocked");
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      setStatus(existing ? "subscribed" : "ready");
    } catch (err) {
      setStatus("ready");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const keyRes = await fetch("/api/v1/push/vapid-public-key");
      const keyJson = (await keyRes.json()) as { publicKey: string | null };
      if (!keyJson.publicKey) {
        setError(
          "Server-Push ist nicht konfiguriert (VAPID-Keys fehlen). Bitte Admin kontaktieren."
        );
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "blocked" : "ready");
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const keyBytes = urlBase64ToUint8Array(keyJson.publicKey);
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes.buffer.slice(
            keyBytes.byteOffset,
            keyBytes.byteOffset + keyBytes.byteLength
          ) as ArrayBuffer,
        });
      }

      const res = await fetch("/api/v1/push/subscribe", {
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
      if (!res.ok) {
        throw new Error(`Subscribe failed: ${res.status}`);
      }
      setStatus("subscribed");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Aktivieren fehlgeschlagen — bitte erneut versuchen."
      );
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await fetch(
          `/api/v1/push/subscribe?endpoint=${encodeURIComponent(endpoint)}`,
          { method: "DELETE" }
        );
      }
      setStatus("ready");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Deaktivieren fehlgeschlagen."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="k-card flex flex-col gap-3 p-5"
      style={{ background: "#fff" }}
    >
      <div className="flex items-start gap-3">
        <span
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{
            background:
              "color-mix(in srgb, var(--accent-soft) 60%, var(--paper))",
            color: "var(--kottke-accent)",
          }}
        >
          {status === "subscribed" ? <Bell size={18} /> : <BellOff size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="k-display" style={{ fontSize: 16, fontWeight: 500 }}>
            Push-Benachrichtigungen
          </div>
          <p
            className="mt-1 text-[13px]"
            style={{ color: "var(--ink-soft)" }}
          >
            Bekomme eine Mitteilung sobald ein Kunde schreibt — auch wenn die App
            geschlossen ist.
          </p>

          <StatusBlock status={status} />

          {error && (
            <p
              className="mt-2 text-[12.5px]"
              style={{ color: "oklch(0.5 0.18 25)" }}
            >
              {error}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {status === "subscribed" ? (
              <button
                className="k-btn sm"
                onClick={disable}
                disabled={busy}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Deaktivieren
              </button>
            ) : status === "ready" || status === "blocked" ? (
              <button
                className="k-btn primary sm"
                onClick={enable}
                disabled={busy || status === "blocked"}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Aktivieren
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBlock({ status }: { status: Status }) {
  if (status === "loading") return null;

  if (status === "unsupported") {
    return (
      <p
        className="mt-2 text-[12.5px]"
        style={{ color: "var(--ink-muted)" }}
      >
        Dieser Browser unterstützt keine Push-Benachrichtigungen.
      </p>
    );
  }

  if (status === "ios-not-installed") {
    return (
      <div
        className="mt-2 rounded-lg p-3 text-[12.5px]"
        style={{
          background: "var(--paper-2)",
          border: "1px dashed var(--line-strong)",
          color: "var(--ink-soft)",
        }}
      >
        <b style={{ color: "var(--ink)" }}>iPhone / iPad:</b> Push funktioniert
        nur, wenn die App zum Home-Bildschirm hinzugefügt wurde.
        <br />
        Tippe in Safari auf <b>Teilen</b> → <b>Zum Home-Bildschirm</b>, öffne die
        App von dort und versuche es erneut.
      </div>
    );
  }

  if (status === "blocked") {
    return (
      <p
        className="mt-2 text-[12.5px]"
        style={{ color: "var(--ink-muted)" }}
      >
        Benachrichtigungen wurden blockiert. Bitte in den Browser- bzw. iOS-
        Systemeinstellungen erlauben.
      </p>
    );
  }

  if (status === "subscribed") {
    return (
      <p
        className="mt-2 text-[12.5px]"
        style={{ color: "oklch(0.45 0.12 150)" }}
      >
        ● Aktiv — du bekommst Push bei neuen Kundennachrichten.
      </p>
    );
  }

  return null;
}
