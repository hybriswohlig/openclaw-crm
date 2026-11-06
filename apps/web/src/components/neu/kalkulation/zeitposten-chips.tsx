"use client";

import type { KalkulationsAnsicht } from "@/lib/kalkulations-ansicht";

export type ZeitpostenVorlage = KalkulationsAnsicht["zeitpostenVorlagen"][number];

const STUNDEN = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

/** „20 min“, „1 h“, „1,5 h“, „2 h“ */
export function minutenText(minuten: number): string {
  if (minuten < 60) return `${minuten} min`;
  return `${STUNDEN.format(minuten / 60)} h`;
}

/**
 * Zeitposten-Bibliothek unter der Arbeit-Gruppe (Spec 3.6): je Vorlage ein
 * Chip „+ Klavier 1 h“, dazu „+ eigener Zeitposten: Bezeichnung, Zeit, Grund“.
 * Jeder Klick öffnet den Anpassungs-Dialog (Pflichtgrund).
 */
export function ZeitpostenChips({
  vorlagen,
  beschaeftigt,
  onVorlage,
  onEigener,
}: {
  vorlagen: ZeitpostenVorlage[];
  beschaeftigt: boolean;
  onVorlage: (vorlage: ZeitpostenVorlage) => void;
  onEigener: () => void;
}) {
  return (
    <div className="kalk-chips" role="group" aria-label="Zeitposten hinzufügen">
      {vorlagen.map((v) => (
        <button key={v.id} type="button" className="kalk-chip" disabled={beschaeftigt} onClick={() => onVorlage(v)}>
          + {v.bezeichnung} {minutenText(v.minuten)}
        </button>
      ))}
      <button type="button" className="kalk-plus" disabled={beschaeftigt} onClick={onEigener}>
        + eigener Zeitposten: Bezeichnung, Zeit, Grund
      </button>
    </div>
  );
}

/** „+ Materialposten: Bezeichnung, Betrag, Grund“ unter der Material-Gruppe. */
export function MaterialChip({ beschaeftigt, onKlick }: { beschaeftigt: boolean; onKlick: () => void }) {
  return (
    <div className="kalk-chips">
      <button type="button" className="kalk-plus" disabled={beschaeftigt} onClick={onKlick}>
        + Materialposten: Bezeichnung, Betrag, Grund
      </button>
    </div>
  );
}
