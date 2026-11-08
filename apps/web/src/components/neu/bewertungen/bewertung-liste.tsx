"use client";

import { GlassPanel } from "@/components/glassyui/glass-panel";
import type { BewertungListe, BewertungZeile } from "@/lib/bewertungen-kunden";
import { LISTE_LEER, LISTE_TITEL, type ZeilenAktion } from "./bewertungen-logik";
import { BewertungZeileAnsicht } from "./bewertung-zeile";

/** Eine Liste der Arbeitsliste als Panel; leer mit Satz. */
export function BewertungListeAnsicht({
  liste,
  zeilen,
  laeuft,
  onAktion,
}: {
  liste: BewertungListe;
  zeilen: BewertungZeile[];
  laeuft: string | null;
  onAktion: (z: BewertungZeile, a: ZeilenAktion) => void;
}) {
  const id = `bew-liste-${liste}`;
  return (
    <GlassPanel variant="panel" className="bew-liste" aria-labelledby={id}>
      <header className="bew-liste-kopf">
        <h2 id={id}>{LISTE_TITEL[liste]}</h2>
        <span className="bew-liste-zahl">{zeilen.length}</span>
      </header>
      {zeilen.length === 0 ? (
        <p className="bew-leer">{LISTE_LEER[liste]}</p>
      ) : (
        <ul className="bew-zeilen">
          {zeilen.map((z) => (
            <BewertungZeileAnsicht key={z.dealId} zeile={z} laeuft={laeuft === z.dealId} onAktion={(a) => onAktion(z, a)} />
          ))}
        </ul>
      )}
    </GlassPanel>
  );
}
