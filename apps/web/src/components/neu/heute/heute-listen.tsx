"use client";

import Link from "next/link";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import type { HeuteAntwort } from "@/lib/plan-heute";
import { INBOX_LINK, LEER_FREIGABEN, LEER_MELDUNGEN, freigabenGesamt, gekappt, meldungenGesamt, weitereText } from "./heute-logik";

/**
 * Rechte Spalte (Entscheidung 11): offene „Ich habe bezahlt“-Meldungen und
 * KI-Entwürfe zur Freigabe, je höchstens 5 Zeilen und „und N weitere“.
 * Meldungen führen in die Akte, Entwürfe in die Inbox an genau diesen Eintrag.
 */
export function HeuteListen({ antwort: a }: { antwort: HeuteAntwort }) {
  const meldungen = gekappt(a.meldungen);
  const freigaben = gekappt(a.freigaben);
  const mGesamt = meldungenGesamt(a);
  const fGesamt = freigabenGesamt(a);
  const mWeitere = weitereText(mGesamt, meldungen.length);
  const fWeitere = weitereText(fGesamt, freigaben.length);

  return (
    <>
      <GlassPanel variant="panel" className="akte-panel heute-panel" aria-labelledby="heute-meldungen-titel">
        <div className="akte-panel-kopf">
          <div>
            <h2 className="akte-panel-titel" id="heute-meldungen-titel">
              Zahlungsmeldungen
            </h2>
            <p className="akte-panel-unter">Kunden melden „bezahlt“, bitte prüfen</p>
          </div>
          {mGesamt > 0 ? <span className="akte-panel-rechts heute-anzahl">{mGesamt}</span> : null}
        </div>
        <div className="heute-panel-koerper">
          {meldungen.length === 0 ? (
            <p className="heute-panel-leer">{LEER_MELDUNGEN}</p>
          ) : (
            <ul className="heute-liste">
              {meldungen.map((m) => (
                <li key={m.dealId}>
                  <Link href={m.href} className="heute-liste-zeile">
                    <span className="heute-liste-name">{m.name}</span>
                    <span className="heute-liste-text" data-ton="gold">
                      {m.text}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {mWeitere ? <p className="heute-weitere">{mWeitere}</p> : null}
        </div>
      </GlassPanel>

      <GlassPanel variant="panel" className="akte-panel heute-panel" aria-labelledby="heute-freigaben-titel">
        <div className="akte-panel-kopf">
          <div>
            <h2 className="akte-panel-titel" id="heute-freigaben-titel">
              Zur Freigabe
            </h2>
            <p className="akte-panel-unter">KI-Entwürfe, die auf dein Okay warten</p>
          </div>
          {fGesamt > 0 ? <span className="akte-panel-rechts heute-anzahl">{fGesamt}</span> : null}
        </div>
        <div className="heute-panel-koerper">
          {freigaben.length === 0 ? (
            <p className="heute-panel-leer">{LEER_FREIGABEN}</p>
          ) : (
            <ul className="heute-liste">
              {freigaben.map((f) => (
                <li key={f.key}>
                  <Link href={f.href} className="heute-liste-zeile">
                    <span className="heute-liste-name">{f.name}</span>
                    <span className="heute-liste-text" data-ton="blau">
                      {f.text}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {fWeitere ? (
            <Link href={INBOX_LINK} className="heute-weitere heute-weitere-link">
              {fWeitere} in der Inbox
            </Link>
          ) : null}
        </div>
      </GlassPanel>
    </>
  );
}
