"use client";

import "@/styles/neu-einsatz.css";

import type { PlanBuchung } from "@/lib/einsatz";
import { leistenFuerWoche } from "./buchung-logik";

/**
 * Leisten der Transporter-Buchungen über den Tagen einer Woche (12b
 * Entscheidung 9): mehrtägig über die Tage, eintägig in der Tageszelle.
 * Klick öffnet die Buchung. Steht als erste Zeile in der Wochenreihe.
 */
export function BuchungLeiste({
  buchungen,
  tage,
  onOeffnen,
}: {
  buchungen: readonly PlanBuchung[];
  tage: readonly string[];
  onOeffnen?: (b: PlanBuchung) => void;
}) {
  const abschnitte = leistenFuerWoche(buchungen, tage);
  if (abschnitte.length === 0) return null;
  return (
    <div className="plan-buchungen" role="gridcell" aria-colspan={7} aria-label="Transporter-Buchungen">
      {abschnitte.map((a) => (
        <button
          key={`${a.buchung.id}-${a.spalte}`}
          type="button"
          className="plan-buchung"
          data-status={a.buchung.status}
          data-warnung={a.buchung.warnungen.length > 0 || undefined}
          data-weiter-links={a.weiterLinks || undefined}
          data-weiter-rechts={a.weiterRechts || undefined}
          style={{ gridColumn: `${a.spalte} / span ${a.breite}`, gridRow: a.bahn }}
          title={[a.buchung.text, ...a.buchung.warnungen].join("\n")}
          aria-label={`Buchung ${a.buchung.text}${a.buchung.warnungen.length > 0 ? `, ${a.buchung.warnungen.length} Warnung` : ""}, öffnen`}
          onClick={(e) => {
            e.stopPropagation();
            onOeffnen?.(a.buchung);
          }}
        >
          {a.buchung.warnungen.length > 0 ? <i className="plan-buchung-warn" aria-hidden="true" /> : null}
          <span className="plan-buchung-text">{a.breite >= 2 ? a.buchung.text : `${a.buchung.klasseName} · ${a.buchung.zugeordnet}/${a.buchung.geplant}`}</span>
        </button>
      ))}
    </div>
  );
}
