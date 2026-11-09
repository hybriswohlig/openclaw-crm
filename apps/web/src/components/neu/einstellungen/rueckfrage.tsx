"use client";

import { GlassButton } from "@/components/glassyui/glass-button";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import { RUECKFRAGE, type RueckfrageArt } from "./texte";

/**
 * Ein Satz vor dem Speichern, was Kunden danach sehen (Entscheidung 6).
 * Mehrere Änderungen in einem Abschnitt: ein Dialog mit allen Sätzen.
 */
export function Rueckfrage({
  arten,
  portalZiel,
  onJa,
  onNein,
}: {
  arten: readonly RueckfrageArt[] | null;
  portalZiel: HTMLElement | undefined;
  onJa: () => void;
  onNein: () => void;
}) {
  if (!arten || arten.length === 0) return null;
  const t =
    arten.length === 1
      ? RUECKFRAGE[arten[0]]
      : { titel: "Änderungen speichern?", text: arten.map((a) => RUECKFRAGE[a].text).join(" "), knopf: "Speichern" };
  return (
    <GlassDialog open onOpenChange={(o) => !o && onNein()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen">
        <GlassDialogTitle className="akte-dialog-titel">{t.titel}</GlassDialogTitle>
        <GlassDialogDescription className="akte-dialog-text">{t.text}</GlassDialogDescription>
        <div className="akte-dialog-knoepfe">
          <GlassButton type="button" variant="ghost" onClick={onNein}>
            Abbrechen
          </GlassButton>
          <GlassButton type="button" onClick={onJa}>
            {t.knopf}
          </GlassButton>
        </div>
      </GlassDialogContent>
    </GlassDialog>
  );
}
