"use client";

import { useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import { stufeSetzen } from "@/components/neu/stufen-wechsel/stufe-setzen";
import { tagKurz } from "@/lib/anzeige";
import type { PlanEintrag } from "@/lib/plan-heute";

/**
 * „Durchführung bestätigen“ (Entscheidung 17, Spec 3.1): Rückfrage, dann
 * `stufeSetzen` auf die erste aktive Stufe der Kategorie Durchgeführt; der
 * Server setzt dabei wie beim Board-Zug `move_completed_at`. Fehler bleiben
 * im Dialog.
 */
export function BestaetigenDialog({
  eintrag: e,
  stufe,
  portalZiel,
  onEnde,
}: {
  /** Plan-Eintrag oder nur Deal, Titel und letzter Termintag (Tagesabschluss auf Heute). */
  eintrag: Pick<PlanEintrag, "dealId" | "titel"> & { bisTag: string | null };
  stufe: { id: string; label: string };
  portalZiel: HTMLElement | undefined;
  onEnde: (gesetzt: boolean) => void;
}) {
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  return (
    <GlassDialog open onOpenChange={(o) => !o && !speichert && onEnde(false)}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen">
        <GlassDialogTitle className="akte-dialog-titel">Durchführung von {e.titel} bestätigen?</GlassDialogTitle>
        <GlassDialogDescription className="akte-dialog-text">
          {e.bisTag ? `Der Termin am ${tagKurz(e.bisTag)} ist vorbei. ` : ""}Die Stufe wechselt auf „{stufe.label}“, danach steht der Auftrag im Plan als erledigt.
        </GlassDialogDescription>
        <form
          onSubmit={async (ev) => {
            ev.preventDefault();
            setSpeichert(true);
            setFehler(null);
            const f = await stufeSetzen(e.dealId, stufe.id);
            setSpeichert(false);
            if (f) setFehler(f);
            else onEnde(true);
          }}
        >
          {fehler ? (
            <p className="akte-dialog-fehler" role="alert">
              {fehler}
            </p>
          ) : null}
          <div className="akte-dialog-knoepfe">
            <GlassButton type="button" variant="ghost" onClick={() => onEnde(false)} disabled={speichert}>
              Abbrechen
            </GlassButton>
            <GlassButton type="submit" disabled={speichert}>
              {speichert ? "Speichert" : "Bestätigen"}
            </GlassButton>
          </div>
        </form>
      </GlassDialogContent>
    </GlassDialog>
  );
}
