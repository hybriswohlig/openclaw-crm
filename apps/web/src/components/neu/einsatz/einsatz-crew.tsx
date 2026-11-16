"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import type { CrewAusschreibungAnsicht } from "@/lib/einsatz-ansicht";
import { crewAusschreibungSetzen } from "./einsatz-api";

/**
 * Crew-Portal im Einsatz-Dialog: wie viele Leute gesucht sind und ob der Job im
 * Portal steht. Wird sofort am Auftrag gespeichert, unabhängig von „Team bestätigen“.
 * Ohne eigene Zahl gilt die Teamgröße der Kalkulation. Der Wert wird nur beim
 * Öffnen übernommen (Aufrufer setzt `key`), damit ein später eintreffendes
 * Neuladen eine gerade gespeicherte Eingabe nie überschreibt.
 */
export function EinsatzCrew({ dealId, wert }: { dealId: string; wert: CrewAusschreibungAnsicht }) {
  const titelId = useId();
  const [w, setW] = useState(wert);
  const [laeuft, setLaeuft] = useState(false);

  async function setzen(body: { leute?: number | null; ausschreiben?: boolean }) {
    setLaeuft(true);
    const r = await crewAusschreibungSetzen(dealId, body);
    setLaeuft(false);
    if (!r.ok) {
      toast.error("Nicht gespeichert.", { description: r.message });
      return;
    }
    if (r.data) setW(r.data);
  }

  if (!w.auftragId) {
    return (
      <section className="ez-anfragen ez-crew" aria-labelledby={titelId}>
        <h3 id={titelId}>Crew-Portal</h3>
        <p className="ez-notiz">Noch kein Auftrag zu diesem Deal. Einmal die Akte öffnen, dann lässt sich hier die Zahl der Leute eintragen.</p>
      </section>
    );
  }

  const zahl = w.leute ?? w.ausKalkulation;
  const herkunft = w.leute !== null ? "eingetragen" : w.ausKalkulation !== null ? "aus der Kalkulation" : null;

  return (
    <section className="ez-anfragen ez-crew" aria-labelledby={titelId}>
      <h3 id={titelId}>Crew-Portal</h3>
      <div className="ez-crew-zeile">
        <span className="ez-crew-label">Leute gesucht</span>
        <span className="ez-crew-stepper" role="group" aria-label="Leute gesucht">
          <button
            type="button"
            aria-label="Eine Person weniger"
            disabled={laeuft || zahl === null || zahl <= 1}
            onClick={() => zahl !== null && void setzen({ leute: zahl - 1 })}
          >
            −
          </button>
          <output aria-live="polite">{zahl ?? "–"}</output>
          <button
            type="button"
            aria-label="Eine Person mehr"
            disabled={laeuft || (zahl !== null && zahl >= 50)}
            onClick={() => void setzen({ leute: (zahl ?? 0) + 1 })}
          >
            +
          </button>
        </span>
        {herkunft ? <span className="ez-crew-herkunft">{herkunft}</span> : null}
        {w.leute !== null && w.ausKalkulation !== null ? (
          <button type="button" className="ez-crew-link" disabled={laeuft} onClick={() => void setzen({ leute: null })}>
            der Kalkulation folgen ({w.ausKalkulation})
          </button>
        ) : null}
        <label className="ez-crew-schalter">
          <input type="checkbox" checked={w.ausschreiben} disabled={laeuft} onChange={(e) => void setzen({ ausschreiben: e.target.checked })} />
          im Portal zeigen
        </label>
      </div>
      <p className="ez-notiz">
        {!w.ausschreiben
          ? "Die Crew sieht diesen Job nicht. Wer hier im Team bestätigt ist, sieht ihn trotzdem unter „Meine“."
          : zahl === null || zahl < 1
            ? "Ohne Zahl sieht die Crew diesen Job nicht. Bitte eintragen."
            : "Wer im Team bestätigt ist, sieht den Job im Portal unter „Meine“, mit Adresse."}
      </p>
    </section>
  );
}
