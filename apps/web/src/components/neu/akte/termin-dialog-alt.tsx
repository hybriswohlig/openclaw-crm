"use client";

import "@/styles/neu-akte-dock.css";

import { DateOfferComposer } from "@/components/customer-link/date-offer-composer";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";

/**
 * Termin: Hülle um den bestehenden `DateOfferComposer` (Terminvorschläge für
 * den Kundenlink) in einem Glas-Dialog (Entscheidung 3). Die Komponente lädt
 * und speichert selbst; ein Schließen lädt die Akte neu, weil der Termin in
 * Kacheln und Ablauf steht.
 */
export function TerminDialogAlt({
  dealId,
  portalZiel,
  onSchliessen,
}: {
  dealId: string;
  portalZiel: HTMLElement | undefined;
  onSchliessen: () => void;
}) {
  return (
    <GlassDialog open onOpenChange={(offen) => !offen && onSchliessen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen" className="akte-dialog-breit">
        <GlassDialogTitle className="akte-dialog-titel">Termin</GlassDialogTitle>
        <GlassDialogDescription className="akte-dialog-text">
          Terminvorschläge für den Kundenlink, wie in der alten Akte.
        </GlassDialogDescription>
        <div className="akte-dialog-alt">
          <DateOfferComposer dealRecordId={dealId} />
        </div>
      </GlassDialogContent>
    </GlassDialog>
  );
}
