"use client";

import { useSyncExternalStore } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import { NeuerLeadDialog } from "./neuer-lead-dialog";

/*
 * Offen-Zustand außerhalb der Komponente: Die Leads-Seite tauscht beim Laden das
 * Skelett gegen das Board und am Handy die ganze Ansicht; der Knopf wird dabei neu
 * eingehängt. Ein offener Dialog bleibt so offen (das Board lädt meist, bevor jemand tippt).
 */
let dialogOffen = false;
const zuhoerer = new Set<() => void>();
function setOffen(offen: boolean) {
  dialogOffen = offen;
  for (const melden of zuhoerer) melden();
}
function abonnieren(melden: () => void) {
  zuhoerer.add(melden);
  return () => {
    zuhoerer.delete(melden);
  };
}

/** „+ Neuer Lead“: öffnet den Dialog der neuen Oberfläche (Plan 10, Entscheidung 10). */
export function NeuerLeadKnopf({ kompakt = false }: { kompakt?: boolean }) {
  const offen = useSyncExternalStore(
    abonnieren,
    () => dialogOffen,
    () => false
  );
  return (
    <>
      {kompakt ? (
        <GlassButton size="sm" aria-label="Neuer Lead" onClick={() => setOffen(true)}>
          +
        </GlassButton>
      ) : (
        <GlassButton onClick={() => setOffen(true)}>+ Neuer Lead</GlassButton>
      )}
      <NeuerLeadDialog offen={offen} onClose={() => setOffen(false)} />
    </>
  );
}

/** Kopf der Leads-Seite (Entscheidung 19, Mockup 03). */
export function LeadsKopf() {
  return (
    <header className="neu-kopf leads-kopf">
      <div className="leads-kopf-text">
        <h1>Leads</h1>
        <p className="neu-kopf-zweite">Jede Anfrage und jeder Auftrag, von der ersten Nachricht bis zur Zahlung.</p>
        <p className="leads-meta">Zieh eine Karte in die nächste Stufe. Was dabei passiert (KV, AB, Rechnung), fragt das CRM vorher.</p>
      </div>
      <div className="leads-kopf-aktionen">
        <NeuerLeadKnopf />
      </div>
    </header>
  );
}
