"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * Renders an EPC Girocode QR for a SEPA Credit Transfer. The payload is built
 * server-side in `customer-portal-core/girocode.ts` and arrives as a string in
 * `payload`. We render it client-side via the `qrcode` package (already a
 * project dependency, used for Baileys pairing).
 *
 * Customer scans this with any German banking app → IBAN/amount/Verwendungs-
 * zweck pre-filled → confirm → done.
 */
export function GirocodeQr({
  payload,
  primaryColor,
  size = 240,
}: {
  payload: string;
  primaryColor: string;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      try {
        const QRCode = (await import("qrcode")).default;
        const canvas = canvasRef.current;
        if (!canvas) return;
        await QRCode.toCanvas(canvas, payload, {
          width: size,
          // Generous margin so banking apps with strict ISO/IEC 18004 readers
          // still pick it up even on a small phone screen.
          margin: 2,
          errorCorrectionLevel: "M",
          color: {
            dark: `#${primaryColor}`,
            light: "#ffffff",
          },
        });
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) setError(true);
      }
    }
    void render();
    return () => {
      cancelled = true;
    };
  }, [payload, primaryColor, size]);

  if (error) {
    return (
      <div className="flex h-60 w-60 items-center justify-center rounded-xl bg-muted text-xs text-muted-foreground">
        QR konnte nicht erzeugt werden.
      </div>
    );
  }

  return (
    <div
      className="relative flex items-center justify-center rounded-xl bg-white p-3"
      style={{ width: size + 24, height: size + 24 }}
    >
      {!ready && (
        <Loader2 className="absolute h-6 w-6 animate-spin text-muted-foreground" />
      )}
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        style={{ width: size, height: size, opacity: ready ? 1 : 0, transition: "opacity 200ms" }}
        aria-label="EPC QR-Code für SEPA-Überweisung"
      />
    </div>
  );
}
