"use client";

import { LEADS_CHIPS, chipText, type LeadsChip, type LeadsChips } from "@/lib/leads-board";

/**
 * Die Chips „Heute im Blick“ (Entscheidung 6): Einfachauswahl, zugleich
 * Filter, zweiter Klick hebt auf; die Zähler gelten immer für alle Deals des
 * Workspace. `kompakt` am Handy: einzeilig scrollbar, ohne Label.
 */
export function LeadsChipsZeile({
  chips,
  aktiv,
  kompakt,
  onWaehlen,
}: {
  chips: LeadsChips | null;
  aktiv: LeadsChip;
  kompakt: boolean;
  onWaehlen: (chip: LeadsChip) => void;
}) {
  return (
    <div className="leads-chips" role="group" aria-label="Heute im Blick" data-kompakt={kompakt || undefined}>
      {kompakt ? null : <span className="leads-chips-label">Heute im Blick</span>}
      {LEADS_CHIPS.map((c) => {
        const zahl = chips ? chips[c.key] : null;
        const an = aktiv === c.key;
        return (
          <button key={c.key} type="button" className="leads-chip" aria-pressed={an} onClick={() => onWaehlen(an ? null : c.key)}>
            <i data-ton={c.ton} aria-hidden="true" />
            <b>{zahl ?? "…"}</b> {chipText(c.key, zahl ?? 0)}
          </button>
        );
      })}
    </div>
  );
}
