"use client";

import { useState } from "react";
import { DokumentDialog } from "./dokument-dialog";
import { RechnungDialog, type RechnungsEingabe } from "./rechnung-dialog";

/**
 * Rechnung erstellen in der neuen Oberfläche (Plan 9): erst der
 * Rechnungsschritt (Betrag, Fälligkeit, Grund), dann der bestehende
 * Dokumentdialog mit diesem Betrag. Gemeinsam für Akte, Tagesabschluss und Kasse.
 */
export function RechnungFluss({
  dealId,
  altLink = `/objects/deals/${dealId}`,
  portalZiel,
  onEnde,
  onGeaendert,
}: {
  dealId: string;
  altLink?: string;
  portalZiel: HTMLElement | undefined;
  /** Nach dem Schließen (mit oder ohne Rechnung): neu laden. */
  onEnde: () => void;
  /** Nach einem Storno im Rechnungsschritt (Dialog bleibt offen). */
  onGeaendert?: () => Promise<void> | void;
}) {
  const [rechnung, setRechnung] = useState<RechnungsEingabe | null>(null);
  if (rechnung) {
    return <DokumentDialog dealId={dealId} art="RE" altLink={altLink} portalZiel={portalZiel} rechnung={rechnung} onSchliessen={onEnde} />;
  }
  return <RechnungDialog dealId={dealId} portalZiel={portalZiel} onWeiter={setRechnung} onSchliessen={onEnde} onGeaendert={onGeaendert} />;
}
