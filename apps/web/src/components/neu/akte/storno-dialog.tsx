"use client";

import "@/styles/neu-akte-dock.css";

import { useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import { GRUND_MIN_ZEICHEN } from "@/lib/geld";
import { grundReicht } from "@/components/neu/kasse/kasse-logik";

/**
 * Rückfrage mit Pflichtgrund (Plan 9, G4): Storno einer Zahlung oder Rechnung.
 * `onBestaetigen` liefert eine Fehlermeldung oder null; Fehler bleiben im Dialog.
 */
export function StornoDialog({
  titel,
  text,
  knopf = "Stornieren",
  portalZiel,
  onBestaetigen,
  onSchliessen,
}: {
  titel: string;
  text: string;
  knopf?: string;
  portalZiel: HTMLElement | undefined;
  onBestaetigen: (grund: string) => Promise<string | null>;
  onSchliessen: () => void;
}) {
  const [grund, setGrund] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  return (
    <GlassDialog open onOpenChange={(o) => !o && !laeuft && onSchliessen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen">
        <GlassDialogTitle className="akte-dialog-titel">{titel}</GlassDialogTitle>
        <GlassDialogDescription className="akte-dialog-text">{text}</GlassDialogDescription>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!grundReicht(grund)) return setFehler(`Bitte einen Grund mit mindestens ${GRUND_MIN_ZEICHEN} Zeichen angeben.`);
            setLaeuft(true);
            setFehler(null);
            const f = await onBestaetigen(grund.trim());
            setLaeuft(false);
            if (f) setFehler(f);
          }}
        >
          <label className="akte-dialog-feld">
            Grund
            <textarea
              className="lg-input lg-textarea"
              rows={2}
              value={grund}
              onChange={(e) => setGrund(e.target.value)}
              placeholder="Zum Beispiel: doppelt erfasst"
              required
              autoFocus
            />
          </label>
          {fehler ? (
            <p className="akte-dialog-fehler" role="alert">
              {fehler}
            </p>
          ) : null}
          <div className="akte-dialog-knoepfe">
            <GlassButton type="button" variant="ghost" onClick={onSchliessen} disabled={laeuft}>
              Abbrechen
            </GlassButton>
            <GlassButton type="submit" disabled={laeuft || !grundReicht(grund)}>
              {laeuft ? "Läuft" : knopf}
            </GlassButton>
          </div>
        </form>
      </GlassDialogContent>
    </GlassDialog>
  );
}
