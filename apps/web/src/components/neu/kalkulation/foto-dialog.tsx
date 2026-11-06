"use client";

import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import type { GrundlageAnsicht } from "@/lib/kalkulations-ansicht";
import { volumenText } from "@/lib/anzeige";

export type Foto = GrundlageAnsicht["fotos"][number];

/** „Wandschrank 3,2 m³“, ohne Volumen nur der Name. */
export function trefferText(t: Foto["treffer"][number]): string {
  return t.volumenCbm === null ? t.name : `${t.name} ${volumenText(t.volumenCbm)}`;
}

/** Ein Kundenfoto groß mit den Inventarzeilen, die darauf erkannt wurden. */
export function FotoDialog({
  foto,
  nummer,
  gesamt,
  portalZiel,
  onSchliessen,
}: {
  foto: Foto;
  nummer: number;
  gesamt: number;
  portalZiel: HTMLElement | undefined;
  onSchliessen: () => void;
}) {
  return (
    <GlassDialog open onOpenChange={(offen) => !offen && onSchliessen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen" className="kalk-foto-dialog">
        <GlassDialogTitle className="akte-dialog-titel">
          Foto {nummer} von {gesamt}
        </GlassDialogTitle>
        <img src={foto.url} alt={foto.treffer.length > 0 ? foto.treffer.map(trefferText).join(", ") : `Foto ${nummer}`} />
        {foto.treffer.length > 0 ? (
          <>
            <GlassDialogDescription className="kalk-dialog-aktuell" style={{ marginTop: 12, marginBottom: 0 }}>
              Darauf erkannt:
            </GlassDialogDescription>
            <ul className="kalk-foto-dialog-treffer" aria-label="Erkannte Teile">
              {foto.treffer.map((t, i) => (
                <li key={`${t.name}-${i}`}>{trefferText(t)}</li>
              ))}
            </ul>
          </>
        ) : (
          <GlassDialogDescription className="kalk-foto-dialog-leer">Auf diesem Foto wurde kein Teil zugeordnet.</GlassDialogDescription>
        )}
      </GlassDialogContent>
    </GlassDialog>
  );
}
