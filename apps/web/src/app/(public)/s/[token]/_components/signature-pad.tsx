"use client";

import { useEffect, useRef } from "react";
import SignaturePad from "signature_pad";

/**
 * Unterschriftsfeld (Wrapper um signature_pad). Liefert nach jedem Strich das
 * PNG als Data-URL, nach „Löschen“ oder einer Größenänderung null.
 * Weißer Hintergrund, damit das PNG im PDF nicht transparent ist.
 */
export function SignatureField({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pad = new SignaturePad(canvas, {
      backgroundColor: "rgb(255,255,255)",
      penColor: "#111",
      minWidth: 1,
      maxWidth: 2.8,
    });
    padRef.current = pad;

    // Nur bei echter Breitenänderung neu setzen: Mobile-Browser melden beim
    // Scrollen Höhenänderungen (Adressleiste), die sonst die Unterschrift löschen.
    let breite = 0;
    const groesseSetzen = () => {
      const neu = canvas.offsetWidth;
      if (!neu || neu === breite) return;
      breite = neu;
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = neu * ratio;
      canvas.height = canvas.offsetHeight * ratio;
      canvas.getContext("2d")?.scale(ratio, ratio);
      pad.clear();
      onChangeRef.current(null);
    };
    const strichEnde = () => onChangeRef.current(pad.isEmpty() ? null : pad.toDataURL("image/png"));

    // ResizeObserver statt window.resize: greift auch, wenn das Feld erst
    // sichtbar wird (aufgeklappter Abschnitt im Dialog).
    const beobachter = new ResizeObserver(groesseSetzen);
    beobachter.observe(canvas);
    groesseSetzen();
    pad.addEventListener("endStroke", strichEnde);
    return () => {
      beobachter.disconnect();
      pad.removeEventListener("endStroke", strichEnde);
      pad.off();
      padRef.current = null;
    };
  }, []);

  function loeschen() {
    padRef.current?.clear();
    onChangeRef.current(null);
  }

  return (
    <div>
      <canvas ref={canvasRef} className="portal-signature-pad" aria-label="Unterschriftsfeld: mit Finger oder Maus unterschreiben" />
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>Mit Finger oder Maus unterschreiben</span>
        <button type="button" onClick={loeschen} className="font-medium underline underline-offset-2">
          Löschen
        </button>
      </div>
    </div>
  );
}
