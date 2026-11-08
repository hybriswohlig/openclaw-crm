"use client";

import { GlassInput } from "@/components/glassyui/glass-input";

/** Suchfeld der Kundenseite: Name, Telefon in jeder Schreibweise, E-Mail oder Deal-Nummer. */
export function KundenSuche({ wert, onAendern, art }: { wert: string; onAendern: (q: string) => void; art: string }) {
  return (
    <div className="kd-suche">
      <GlassInput
        type="search"
        aria-label="Kunden suchen"
        placeholder="Name, Telefon, E-Mail oder Deal-Nummer"
        autoComplete="off"
        value={wert}
        onChange={(e) => onAendern(e.target.value)}
      />
      {art ? <span className="kd-suche-art">Suche nach {art}</span> : null}
    </div>
  );
}
