"use client";

import type { PlanImBlick as Chip } from "@/lib/plan-heute";

/**
 * „Im Blick“ über dem Raster (Mockup 04, Entscheidung 8): Datumschips öffnen
 * den Tag, „+N weitere“ klappt die übrigen auf, der graue Zählchip blendet
 * alles außer den nicht festen Terminen ab (zweiter Klick hebt auf). Gold
 * nennt den Grund als Text, nie nur Farbe.
 */
export function PlanImBlick({
  chips,
  nurNichtFest,
  onKlick,
}: {
  chips: readonly Chip[];
  nurNichtFest: boolean;
  onKlick: (chip: Chip) => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="plan-blick" role="group" aria-label="Im Blick">
      <span className="plan-blick-label">Im Blick</span>
      {chips.map((c) => {
        const zaehl = c.art === "nicht_fest";
        return (
          <button
            key={c.key}
            type="button"
            className="plan-blick-chip"
            aria-pressed={zaehl ? nurNichtFest : undefined}
            onClick={() => onKlick(c)}
          >
            <i data-ton={c.ton} aria-hidden="true" />
            <b>{c.fett}</b> {c.text}
          </button>
        );
      })}
    </div>
  );
}
