"use client";

import Link from "next/link";
import type { KundenUmzug } from "@/lib/bewertungen-kunden";
import { LISTE_TITEL } from "@/components/neu/bewertungen/bewertungen-logik";
import { FirmenChips } from "./firmen-chips";
import { datum, euro } from "./kunden-logik";

/** Alle Umzüge der Person: Stufe, Datum, Betrag, Rest, Firma, Bewertungsstand, Link in die Akte. */
export function KundenakteUmzuege({ umzuege }: { umzuege: KundenUmzug[] }) {
  if (umzuege.length === 0) return <p className="kd-leer">Noch kein Auftrag.</p>;
  return (
    <ul className="kd-zeilen">
      {umzuege.map((u) => (
        <li key={u.dealId} className="kd-zeile kd-umzug">
          <div className="kd-zeile-haupt">
            <Link href={`/app/leads/${u.dealId}`} className="kd-zeile-name">
              {u.titel || "Ohne Namen"}
            </Link>
            <span className="kd-zeile-meta">
              {[u.dealNummer, u.stufe.label, u.umzugsdatum ? datum(u.umzugsdatum) : null].filter(Boolean).join(" · ")}
            </span>
          </div>
          <FirmenChips firmen={u.firma ? [u.firma] : []} />
          <span className="kd-zeile-text">
            {u.bewertung ? `Bewertung: ${LISTE_TITEL[u.bewertung].toLowerCase()}` : ""}
          </span>
          <span className="kd-zeile-betrag" data-offen={u.offenCent != null && u.offenCent > 0 ? true : undefined}>
            {u.gesamtCent == null ? "Betrag unbekannt" : euro(u.gesamtCent)}
            <small>{u.offenCent == null ? "Rest unbekannt" : u.offenCent > 0 ? `${euro(u.offenCent)} offen` : "bezahlt"}</small>
          </span>
        </li>
      ))}
    </ul>
  );
}
