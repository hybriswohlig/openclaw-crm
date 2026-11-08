"use client";

import type { PlanBuchung } from "@/lib/einsatz";
import { eintraegeAm, planTitel, type PlanEintrag } from "@/lib/plan-heute";
import type { EintragWahl } from "./plan-eintrag";
import { PlanZeile } from "./plan-zeile";

/**
 * Tag (Entscheidung 16): Liste nach Uhrzeit (ganztägig zuletzt, Reihenfolge
 * der Antwort) mit voller Zeile, Team, Fahrzeugtyp, Stufe, Firma und Link in
 * die Akte; dieselbe Zeile wie auf „Heute“. Klick auf den Titel öffnet das
 * Popover, die Zeile selbst ist der Anker. Kein Ziehen.
 */
export function PlanTag({
  tag,
  eintraege,
  leer,
  onWaehlen,
  buchungen = [],
  onBuchung,
}: {
  tag: string;
  eintraege: readonly PlanEintrag[];
  /** Text, wenn der Tag leer ist (hängt an Filtern). */
  leer: React.ReactNode;
  onWaehlen: EintragWahl;
  /** Plan 12b: Buchungen, die den Tag decken, über der Liste. */
  buchungen?: readonly PlanBuchung[];
  onBuchung?: (b: PlanBuchung) => void;
}) {
  const liste = eintraegeAm(eintraege, tag);
  const amTag = buchungen.filter((b) => b.von <= tag && b.bis >= tag);
  const leiste =
    amTag.length > 0 ? (
      <div className="plan-tag-buchungen" aria-label="Transporter-Buchungen">
        {amTag.map((b) => (
          <button key={b.id} type="button" className="plan-buchung" data-status={b.status} data-warnung={b.warnungen.length > 0 || undefined} onClick={() => onBuchung?.(b)}>
            {b.warnungen.length > 0 ? <i className="plan-buchung-warn" aria-hidden="true" /> : null}
            <span className="plan-buchung-text">{b.text}</span>
          </button>
        ))}
      </div>
    ) : null;
  if (liste.length === 0)
    return (
      <>
        {leiste}
        <div className="plan-tag-leer">{leer}</div>
      </>
    );
  return (
    <>
    {leiste}
    <ul className="plan-tag" aria-label={planTitel("tag", tag)}>
      {liste.map((e) => (
        <li key={e.id} data-eintrag={e.id}>
          <PlanZeile
            eintrag={e}
            onWaehlen={(gewaehlt) => {
              const anker = document.querySelector<HTMLElement>(`.plan-tag li[data-eintrag="${CSS.escape(gewaehlt.id)}"] .plan-zeile-titel`);
              if (anker) onWaehlen(gewaehlt, anker);
            }}
          />
        </li>
      ))}
    </ul>
    </>
  );
}
