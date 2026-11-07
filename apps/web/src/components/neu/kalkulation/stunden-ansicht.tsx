"use client";

import type { KalkulationsAnsicht } from "@/lib/kalkulations-ansicht";
import { euro } from "@/components/neu/akte/format";
import { kvMarke } from "./kv-erzeugung";
import { stundenKundentext, stundenZeilen } from "./preis-logik";

/**
 * Stunden-KV aus der Version (Plan 5b, Entscheidung 7, F10): Helfer und
 * Transporter mit Satz je Stunde, geschätzte Stunden, Mindeststunden,
 * feste Zusatzposten und die Schätzung, darunter der Satz, den der Kunde
 * liest. Ohne Rechner-Stunden (keine Sätze für die Firma) ein Hinweis; ob
 * die Version sperrbar ist, sagt der Sperrgrund des Dienstes.
 * Steht im Stundenmodus an Stelle von Marge, Festpreis und „So steht es im
 * KV“; die KV-Marke (Plan 5a) zieht deshalb hierher.
 */
export function StundenBlock({
  stunden,
  erzeugung,
}: {
  stunden: KalkulationsAnsicht["stunden"];
  erzeugung?: KalkulationsAnsicht["version"]["kvErzeugung"];
}) {
  const marke = erzeugung ? kvMarke(erzeugung) : null;
  return (
    <>
      <div className="kalk-panel-kopf" data-klein="">
        <div>
          <h3 className="kalk-panel-titel">Stunden-KV</h3>
          <p className="kalk-panel-unter">Abgerechnet nach Aufwand, aus der Version.</p>
        </div>
        {marke ? (
          <span className="kalk-marke kalk-kv-marke" data-ton={marke.ton}>
            {marke.text}
          </span>
        ) : null}
      </div>
      {stunden ? (
        <div className="kalk-kv" aria-label="Stunden-KV">
          {stundenZeilen(stunden).map((z) => (
            <div key={z.label} className="kalk-kvl">
              <span className="kalk-kvl-t">{z.label}</span>
              <span className="kalk-kvl-a">{z.wert}</span>
              {z.formel ? <span className="kalk-kvl-f">{z.formel}</span> : null}
            </div>
          ))}
          <div className="kalk-std-summe">
            <span>Schätzung</span>
            <b>{euro(stunden.summeGeschaetztCent)}</b>
          </div>
          <p className="kalk-std-kunde">
            Kunde liest: „{stundenKundentext(stunden)}“
          </p>
        </div>
      ) : (
        <p className="kalk-kv-fehler kalk-std-leer" role="status">
          Der Rechner liefert für diese Firma keine Stundensätze. Bitte Sätze und Mindeststunden in den Rechner-Einstellungen hinterlegen.
        </p>
      )}
    </>
  );
}
