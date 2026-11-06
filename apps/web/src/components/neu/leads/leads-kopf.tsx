"use client";

import Link from "next/link";
import { GlassButton } from "@/components/glassyui/glass-button";

/** Ziel von „+ Neuer Lead“: der Anlegen-Dialog der alten Seite (Entscheidung 19). */
export const NEUER_LEAD_URL = "/objects/deals?create=1";

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
        <GlassButton asChild>
          <Link href={NEUER_LEAD_URL}>+ Neuer Lead</Link>
        </GlassButton>
      </div>
    </header>
  );
}
