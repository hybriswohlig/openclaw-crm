"use client";

import { useId, useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import type { Schreibzug } from "./plan-logik";

/**
 * Rückfrage vor jedem Schreiben eines Tages (Entscheidung 7): Text aus
 * `verschiebenText` bzw. „+ Termin“, nach KV-Annahme ein Pflichthaken; Fehler
 * bleiben im Dialog. Abbrechen schreibt nichts, der Eintrag springt zurück.
 */
export function VerschiebenDialog({
  zug,
  fehler,
  speichert,
  portalZiel,
  onAbbrechen,
  onBestaetigen,
}: {
  zug: Schreibzug;
  fehler: string | null;
  speichert: boolean;
  portalZiel: HTMLElement | undefined;
  onAbbrechen: () => void;
  onBestaetigen: () => void;
}) {
  const id = useId();
  const [haken, setHaken] = useState(false);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const { text } = zug;
  const bereit = text.pflicht === null || haken;

  return (
    <GlassDialog open onOpenChange={(offen) => !offen && !speichert && onAbbrechen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen">
        <GlassDialogTitle className="akte-dialog-titel">{text.titel}</GlassDialogTitle>
        <GlassDialogDescription className="akte-dialog-text">{text.text}</GlassDialogDescription>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!bereit) return setHinweis("Bitte zuerst bestätigen.");
            setHinweis(null);
            onBestaetigen();
          }}
        >
          {text.pflicht ? (
            <label className="plan-dialog-haken" htmlFor={id}>
              <input id={id} type="checkbox" checked={haken} onChange={(e) => setHaken(e.target.checked)} />
              {text.pflicht}
            </label>
          ) : null}
          {hinweis ?? fehler ? (
            <p className="akte-dialog-fehler" role="alert">
              {hinweis ?? fehler}
            </p>
          ) : null}
          <div className="akte-dialog-knoepfe">
            <GlassButton type="button" variant="ghost" onClick={onAbbrechen} disabled={speichert}>
              Abbrechen
            </GlassButton>
            <GlassButton type="submit" disabled={speichert || !bereit}>
              {speichert ? "Speichert" : text.knopf}
            </GlassButton>
          </div>
        </form>
      </GlassDialogContent>
    </GlassDialog>
  );
}
