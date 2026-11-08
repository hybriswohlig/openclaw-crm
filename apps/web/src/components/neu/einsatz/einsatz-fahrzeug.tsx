"use client";

import { euroText } from "@/lib/anzeige";
import type { AuslastungAnzeige } from "@/lib/einsatz";

export interface FahrzeugBuchung {
  id: string;
  text: string;
  /** Anteil Miete ÷ geplante Aufträge in Cent; null ohne Angabe. */
  anteilCent: number | null;
  zugeordnet: boolean;
}

/**
 * Fahrzeugkarte (12a Entscheidung 12, 12b Entscheidung 10): was am Tag zur
 * Verfügung steht. Zugeordnete Buchung, sonst Buchungen der Firma am Tag,
 * sonst die Tagesmiete der Empfehlung. Darunter die Auslastung des einen
 * Auftrags (`auslastungAus`) mit der Formel, nie ein Füllstand der Buchung.
 */
export function EinsatzFahrzeug({
  tagText,
  fahrzeugName,
  station,
  fahrzeugEur,
  auslastung,
  buchungen = [],
  aktion,
}: {
  tagText: string | null;
  fahrzeugName: string | null;
  station: string | null;
  fahrzeugEur: number | null;
  auslastung: AuslastungAnzeige;
  buchungen?: FahrzeugBuchung[];
  /** 12b: Zuordnen, Lösen, Station und Klasse (vom Dialog gesetzt). */
  aktion?: React.ReactNode;
}) {
  const zugeordnet = buchungen.find((b) => b.zugeordnet) ?? null;
  const zeigen = zugeordnet ? [zugeordnet] : buchungen;
  return (
    <section className="ez-karte" aria-labelledby="ez-fahrzeug-titel">
      <div className="ez-karte-kopf">
        <h3 id="ez-fahrzeug-titel">{tagText ? `Fahrzeug am ${tagText}` : "Fahrzeug"}</h3>
        <p>Was zur Verfügung steht, auch länger gemietet</p>
      </div>
      <div className="ez-fahrzeuge">
        {zeigen.map((b) => (
          <div key={b.id} className="ez-fahrzeug" data-an={b.zugeordnet || undefined}>
            <span>
              <b>{b.zugeordnet ? "Buchung" : "Buchung der Firma"}</b>
              <small>{b.text}</small>
            </span>
            {b.anteilCent !== null ? (
              <span className="ez-fahrzeug-betrag">
                {euroText(b.anteilCent)}
                <small>Anteil</small>
              </span>
            ) : null}
          </div>
        ))}
        {!zugeordnet ? (
          <div className="ez-fahrzeug" data-an={buchungen.length === 0 || undefined}>
            <span>
              <b>Tagesmiete{fahrzeugName ? ` ${fahrzeugName}` : ""}</b>
              <small>{station ? `${station} · Empfehlung der Kalkulation` : "Empfehlung der Kalkulation"}</small>
            </span>
            {fahrzeugEur !== null ? <span className="ez-fahrzeug-betrag">{euroText(Math.round(fahrzeugEur * 100))}</span> : null}
          </div>
        ) : null}
        {aktion}
        <div className="ez-auslastung" data-ton={auslastung.ton}>
          <div className="ez-auslastung-kopf">
            <span>Auslastung, Schätzung</span>
            <span>{auslastung.text}</span>
          </div>
          {auslastung.anteil !== null ? (
            <div
              className="ez-balken"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(auslastung.anteil * 100)}
              aria-label="Auslastung"
            >
              <i style={{ width: `${Math.round(auslastung.anteil * 100)}%` }} />
            </div>
          ) : null}
          <small>{auslastung.formel}. Aus dem Inventar gerechnet, kein gemessener Füllstand.</small>
        </div>
      </div>
    </section>
  );
}
