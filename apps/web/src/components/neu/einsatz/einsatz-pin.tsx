"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import { anfahrtText, type Anfahrt, type KartenPerson, type PinGruppe } from "@/lib/einsatz";
import type { EinsatzPersonLage } from "@/lib/einsatz-ansicht";
import { gruppenLage, pinText } from "./einsatz-karte-logik";

export type PinLage = "team" | "frei" | "belegt" | "abwesend";

const ABWESEND_WORT = { urlaub: "Urlaub", krank: "krank", gesperrt: "gesperrt" } as const;

/** Lage als Wort (auch für Screenreader): „frei“, „belegt bei Umzug Nowak“, „Urlaub“. */
export function lageWort(p: Pick<EinsatzPersonLage, "lage" | "abwesend" | "belegtMit"> | undefined, k: KartenPerson): string {
  if (k.lage === "frei") return "frei";
  if (k.lage === "belegt") return p && p.belegtMit.length > 0 ? `belegt bei ${p.belegtMit.map((d) => d.titel).join(", ")}` : "belegt";
  return p?.abwesend ? ABWESEND_WORT[p.abwesend] : "abwesend";
}

/**
 * Status als Symbol, nicht nur als Farbe (Auftrag 10.11. Punkt 4): Haken im
 * Team, leerer Kreis frei, Uhr belegt, durchgestrichener Kreis abwesend.
 */
export function LageSymbol({ lage }: { lage: PinLage }) {
  return (
    <svg className="ezk-symbol" viewBox="0 0 16 16" aria-hidden="true" data-lage={lage}>
      {lage === "team" ? <path d="M3.5 8.5l3 3 6-6.5" /> : null}
      {lage === "frei" ? <circle cx="8" cy="8" r="4.5" /> : null}
      {lage === "belegt" ? (
        <>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 5v3.2l2.2 1.4" />
        </>
      ) : null}
      {lage === "abwesend" ? (
        <>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M4.2 11.8l7.6-7.6" />
        </>
      ) : null}
    </svg>
  );
}

/**
 * Ein Pin je Ort (Bündel): bis zu drei Kürzel und „+N“, kürzeste Anfahrt,
 * Symbol der Lage. Knopf mit `aria-label`; Enter öffnet die Namensliste.
 * Ziehen startet über `onZiehenStart` (Maus sofort, Touch nach kurzem Halten).
 */
export function EinsatzPin({
  gruppe,
  teamIds,
  anfahrten,
  details,
  offen,
  gezogen,
  onOeffnen,
  onZiehenStart,
}: {
  gruppe: PinGruppe;
  teamIds: readonly string[];
  anfahrten: readonly Anfahrt[];
  details: ReadonlyMap<string, EinsatzPersonLage>;
  offen: boolean;
  gezogen: boolean;
  onOeffnen: (g: PinGruppe) => void;
  onZiehenStart: (k: KartenPerson, e: ReactPointerEvent<HTMLElement>) => void;
}) {
  const lage = gruppenLage(gruppe, teamIds);
  const t = pinText(gruppe, anfahrten);
  // Ein Bündel zieht die erste Person, die noch nicht im Team ist (frei zuerst).
  const ziehbar = gruppe.personen.find((p) => !teamIds.includes(p.employeeId)) ?? gruppe.personen[0]!;
  const label =
    gruppe.personen.length === 1
      ? (() => {
          const k = gruppe.personen[0]!;
          const an = anfahrten.find((a) => a.employeeId === k.employeeId);
          return `${k.name}, ${k.ortText || "Ort unbekannt"}, ${lageWort(details.get(k.employeeId), k)}${teamIds.includes(k.employeeId) ? ", im Team" : ""}, Anfahrt ${an ? anfahrtText(an.anKm, an.anMin, an.anMinQuelle) : "unbekannt"}`;
        })()
      : `${gruppe.personen.length} Personen in ${gruppe.ortText || "einem Ort"}: ${gruppe.personen
          .map((k) => `${k.name} ${lageWort(details.get(k.employeeId), k)}${teamIds.includes(k.employeeId) ? ", im Team" : ""}`)
          .join("; ")}`;
  return (
    <button
      type="button"
      className="ezk-pin"
      data-lage={lage}
      data-offen={offen || undefined}
      data-gezogen={gezogen || undefined}
      aria-label={label}
      aria-expanded={offen}
      onPointerDown={(e) => onZiehenStart(ziehbar, e)}
      onClick={() => onOeffnen(gruppe)}
    >
      <span className="ezk-pin-kreise" aria-hidden="true">
        {t.kuerzel.map((k, i) => (
          <span key={`${k}-${i}`} className="ezk-pin-kreis">
            {k}
          </span>
        ))}
        {t.mehr > 0 ? <span className="ezk-pin-mehr">+{t.mehr}</span> : null}
      </span>
      <LageSymbol lage={lage} />
      {t.minuten !== null ? <span className="ezk-pin-min">{t.minuten} min</span> : null}
    </button>
  );
}
