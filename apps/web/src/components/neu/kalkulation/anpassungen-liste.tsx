"use client";

import type { AnpassungAnsicht } from "@/lib/kalkulations-ansicht";
import type { AnpassungStart } from "./anpassung-dialog";

/** Womit der Dialog für eine bestehende Anpassung öffnet (Art und Schlüssel vorbelegt). */
export function startFuer(a: AnpassungAnsicht): AnpassungStart {
  switch (a.art) {
    case "marge":
      return { art: "marge" };
    case "satz":
      return { art: "satz", key: a.key === "fahrt" ? "fahrt" : "arbeit" };
    case "zeitposten":
      return { art: "zeitposten", key: a.key, bezeichnung: a.text.split(":")[0] };
    case "material_frei":
      return { art: "material_frei", key: a.key, bezeichnung: a.text.split(":")[0] };
    case "eingabe":
      return { art: "eingabe", key: a.key };
    case "zeile":
      return { art: "zeile", key: a.key, label: a.text.split(":")[0] ?? a.key, aktuell: null };
  }
}

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
