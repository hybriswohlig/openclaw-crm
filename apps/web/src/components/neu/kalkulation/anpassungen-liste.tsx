"use client";

import type { AnpassungAnsicht } from "@/lib/kalkulations-ansicht";
import { startFuer, type AnpassungStart } from "./anpassung-start";

/**
 * „Anpassungen“ (Entscheidung 13): die wirksamen Übersteuerungen der Version
 * mit Name, Zeit und Grund in Gold; Klick öffnet den Dialog zum Ändern oder
 * Zurücknehmen. „+ Anpassung mit Begründung“ öffnet die freie Wahl der Art.
 */
export function AnpassungenListe({
  anpassungen,
  beschaeftigt,
  onOeffnen,
}: {
  anpassungen: AnpassungAnsicht[];
  beschaeftigt: boolean;
  onOeffnen: (start: AnpassungStart) => void;
}) {
  return (
    <>
      <div className="kalk-panel-kopf" data-klein="">
        <div>
          <h3 className="kalk-panel-titel">Anpassungen</h3>
          <p className="kalk-panel-unter">fließen in die Kalibrierung des Rechners</p>
        </div>
      </div>
      <ul className="kalk-notizen" aria-label="Anpassungen dieser Version">
        {anpassungen.length === 0 ? (
          <li>
            <p className="kalk-notizen-leer">Keine Anpassungen. Der Rechner rechnet mit seinen Regeln.</p>
          </li>
        ) : null}
        {anpassungen.map((a) => (
          <li key={a.id}>
            <button type="button" className="kalk-notiz" disabled={beschaeftigt} onClick={() => onOeffnen(startFuer(a))} aria-label={`${a.text}, ändern oder zurücknehmen`}>
              {a.text}
              <small>
                {a.von} · {a.am} · „{a.grund}“
              </small>
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="kalk-plus kalk-notiz-plus" disabled={beschaeftigt} onClick={() => onOeffnen({ art: "wahl" })}>
            + Anpassung mit Begründung
          </button>
        </li>
      </ul>
    </>
  );
}
