"use client";

import { GlassPanel } from "@/components/glassyui/glass-panel";
import type { KasseSchlange, KasseZeile } from "@/lib/geld";
import { kachelText, KASSE_LEER } from "./kasse-logik";
import { KasseZeileAnsicht } from "./kasse-zeile";

/** Eine Warteschlange der Kasse als Panel mit Titel, Summe und Zeilen; leer mit Satz. */
export function KasseSchlangeAnsicht({
  schlange,
  titel,
  zeilen,
  summe,
  laeuft,
  onAktion,
  onVerwerfen,
}: {
  schlange: KasseSchlange;
  titel: string;
  zeilen: KasseZeile[];
  summe: { anzahl: number; cent: number; unbekannt: number };
  laeuft: string | null;
  onAktion: (z: KasseZeile) => void;
  onVerwerfen?: (z: KasseZeile) => void;
}) {
  const id = `kasse-${schlange}`;
  return (
    <GlassPanel variant="panel" className="kasse-schlange" data-schlange={schlange} aria-labelledby={id}>
      <header className="kasse-schlange-kopf">
        <h2 id={id}>{titel}</h2>
        <span className="kasse-schlange-summe">{kachelText(summe)}</span>
      </header>
      {zeilen.length === 0 ? (
        <p className="kasse-leer">{KASSE_LEER[schlange]}</p>
      ) : (
        <ul className="kasse-zeilen">
          {zeilen.map((z) => (
            <KasseZeileAnsicht
              key={z.dealId}
              zeile={z}
              schlange={schlange}
              laeuft={laeuft === `${schlange}:${z.dealId}`}
              onAktion={() => onAktion(z)}
              onVerwerfen={onVerwerfen ? () => onVerwerfen(z) : undefined}
            />
          ))}
        </ul>
      )}
    </GlassPanel>
  );
}
