"use client";

import type { InboxChip, InboxChips } from "@/lib/inbox-neu";
import { CHIPS, chipZahl } from "./inbox-logik";

/**
 * Die Chips „Jetzt“ über der Liste (Entscheidung 6): Einfachauswahl, zugleich
 * Filter; die Zähler zeigen immer den Gesamtstand. Ein zweiter Klick hebt die
 * Auswahl auf. `kompakt` am Handy: kurze Labels, einzeilig scrollbar.
 */
export function InboxChipsZeile({
  chips,
  aktiv,
  kompakt,
  onWaehlen,
}: {
  chips: InboxChips | null;
  aktiv: InboxChip;
  kompakt: boolean;
  onWaehlen: (chip: InboxChip) => void;
}) {
  return (
    <div className="inbox-chips" role="group" aria-label="Jetzt" data-kompakt={kompakt || undefined}>
      {kompakt ? null : <span className="inbox-chips-label">Jetzt</span>}
      {CHIPS.map((c) => {
        const zahl = chips ? chipZahl(chips, c.key) : null;
        const an = aktiv === c.key;
        return (
          <button
            key={c.key}
            type="button"
            className="inbox-chip-jetzt"
            aria-pressed={an}
            onClick={() => onWaehlen(an ? null : c.key)}
          >
            <i data-ton={c.ton} aria-hidden="true" />
            {kompakt ? (
              <>
                {c.kurz} <b>{zahl ?? "…"}</b>
              </>
            ) : (
              <>
                <b>{zahl ?? "…"}</b> {c.label}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
