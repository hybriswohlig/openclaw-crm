"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";

interface QrSnapshot {
  id: string;
  pairingStatus:
    | "idle"
    | "awaiting_qr"
    | "awaiting_code"
    | "connecting"
    | "connected"
    | "logged_out"
    | "error"
    | null;
  qrPayload: string | null;
  qrUpdatedAt: string | null;
  pairingCode: string | null;
  ownJid: string | null;
  lastSeenAt: string | null;
  lastDisconnectReason: string | null;
  isActive: boolean;
}

interface Props {
  accountId: string;
  /** Called once `pairingStatus === 'connected'`. */
  onConnected?: () => void;
}

/**
 * Modal-content component that drives the Baileys QR pairing flow.
 *
 * Flow:
 *   1. POST /api/v1/integrations/baileys/start  → bridge spawns a socket.
 *   2. Poll  /api/v1/integrations/baileys/qr     every 3s for pairing state.
 *   3. Render the QR string as a PNG via the `qrcode` package (dynamic
 *      import keeps it out of the SSR bundle).
 *   4. Stop polling once status is 'connected', 'logged_out', or 'error'.
 */
export function BaileysPairingPanel({ accountId, onConnected }: Props) {
  const [snapshot, setSnapshot] = useState<QrSnapshot | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const stoppedPolling = useRef(false);

  // Kick the bridge once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/integrations/baileys/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId }),
        });
        if (!cancelled && !res.ok) {
          const j = (await res.json().catch(() => ({}))) as {
            error?: { message?: string };
          };
          setStartError(
            j.error?.message ?? "Bridge konnte nicht gestartet werden",
          );
        }
      } catch (err) {
        if (!cancelled) {
          setStartError(
            err instanceof Error
              ? err.message
              : "Netzwerkfehler beim Bridge-Start",
          );
        }
      } finally {
        if (!cancelled) setStarting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const fetchSnapshot = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/v1/integrations/baileys/qr?accountId=${encodeURIComponent(accountId)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as QrSnapshot;
      setSnapshot(data);
      if (
        data.pairingStatus === "connected" ||
        data.pairingStatus === "logged_out" ||
        data.pairingStatus === "error"
      ) {
        stoppedPolling.current = true;
      }
      if (data.pairingStatus === "connected") onConnected?.();
    } catch {
      // network blip — try again on the next tick
    }
  }, [accountId, onConnected]);

  // Poll loop.
  useEffect(() => {
    if (starting) return;
    void fetchSnapshot();
    const handle = setInterval(() => {
      if (stoppedPolling.current) return;
      void fetchSnapshot();
    }, 3000);
    return () => clearInterval(handle);
  }, [starting, fetchSnapshot]);

  // Re-render the QR PNG when the payload changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!snapshot?.qrPayload) {
        setQrDataUrl(null);
        return;
      }
      try {
        const QRCode = (await import("qrcode")).default;
        const url = await QRCode.toDataURL(snapshot.qrPayload, {
          width: 280,
          margin: 1,
          errorCorrectionLevel: "M",
        });
        if (!cancelled) setQrDataUrl(url);
      } catch {
        if (!cancelled) setQrDataUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [snapshot?.qrPayload]);

  if (starting) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
        <Loader2 className="h-4 w-4 animate-spin" />
        Bridge wird gestartet…
      </div>
    );
  }

  if (startError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        <div className="flex items-center gap-2 font-medium">
          <AlertTriangle className="h-4 w-4" />
          Bridge-Start fehlgeschlagen
        </div>
        <p className="mt-1 text-xs">{startError}</p>
      </div>
    );
  }

  const status = snapshot?.pairingStatus ?? "idle";

  if (status === "connected") {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
        <div className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" />
          Verbunden
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {snapshot?.ownJid
            ? `Eigene Nummer: ${snapshot.ownJid.replace(/@.*$/, "")}`
            : "Pairing erfolgreich abgeschlossen."}
        </p>
      </div>
    );
  }

  if (status === "logged_out") {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
        <div className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4" />
          Gerät abgemeldet
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Das verknüpfte Gerät wurde vom Telefon entfernt. Bitte erneut
          pairen — der Account ist deaktiviert.
        </p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        <div className="flex items-center gap-2 font-medium">
          <AlertTriangle className="h-4 w-4" />
          Verbindungsfehler
        </div>
        <p className="mt-1 text-xs">
          {snapshot?.lastDisconnectReason ?? "Bridge meldet einen Fehler."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        {status === "awaiting_qr"
          ? "Warte auf QR-Code…"
          : status === "awaiting_code"
            ? "Pairing-Code wird angefordert…"
            : status === "connecting"
              ? "Verbinde mit WhatsApp…"
              : "Status wird geladen…"}
      </div>

      {qrDataUrl ? (
        <div className="flex flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUrl}
            alt="WhatsApp pairing QR"
            className="rounded-lg border border-border bg-white p-2"
            width={280}
            height={280}
          />
          <ol className="text-xs text-muted-foreground space-y-1 list-decimal pl-5">
            <li>
              WhatsApp auf dem Telefon → <em>Einstellungen</em>
            </li>
            <li>
              <em>Verknüpfte Geräte</em> → <em>Gerät verknüpfen</em>
            </li>
            <li>QR-Code scannen.</li>
          </ol>
        </div>
      ) : snapshot?.pairingCode ? (
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-center">
          <div className="text-xs text-muted-foreground mb-1">
            Pairing-Code
          </div>
          <div className="font-mono text-2xl tracking-widest">
            {snapshot.pairingCode}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
