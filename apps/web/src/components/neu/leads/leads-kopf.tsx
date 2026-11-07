"use client";

import { useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import { NeuerLeadDialog } from "./neuer-lead-dialog";

/** „+ Neuer Lead“: öffnet den Dialog der neuen Oberfläche (Plan 10, Entscheidung 10). */
export function NeuerLeadKnopf({ kompakt = false }: { kompakt?: boolean }) {
  const [offen, setOffen] = useState(false);
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
