"use client";

import { useId, useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import { euro } from "@/components/neu/akte/format";
import type { MargeAnsicht } from "@/lib/kalkulations-ansicht";
import { margeAusPreis, preisGrenzen } from "./preis-eingabe-logik";

const PROZENT = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

/**
 * Kundenpreis direkt eingeben (Wunsch Inhaber 15.11.): die Marge ergibt sich
 * daraus und wird wie beim Regler als Marge gespeichert. Während des Tippens
 * steht darunter, welche Marge und welcher Gewinn herauskommen.
 */
export function PreisEingabe({
  marge,
  aktuellCent,
  gesperrt,
  onUebernehmen,
}: {
  marge: MargeAnsicht;
  aktuellCent: number | null;
  gesperrt: boolean;
  onUebernehmen: (prozent: number, preisCent: number) => Promise<boolean>;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const ergebnis = text.trim() === "" ? null : margeAusPreis(marge, text);
  const grenzen = marge.selbstkostenEur > 0 ? preisGrenzen(marge) : null;
  const gleich = ergebnis?.ok === true && aktuellCent !== null && ergebnis.preisCent === aktuellCent;

  async function absenden() {
    if (!ergebnis?.ok || gleich || gesperrt || laeuft) return;
    setLaeuft(true);
    const ok = await onUebernehmen(ergebnis.prozent, ergebnis.preisCent);
    setLaeuft(false);
    if (ok) setText("");
  }

  return (
    <form
      className="kalk-preis-eingabe"
      onSubmit={(e) => {
        e.preventDefault();
        void absenden();
      }}
    >
      <label htmlFor={`${id}-preis`} className="kalk-preis-eingabe-titel">
        Preis direkt eingeben
      </label>
      <div className="kalk-preis-eingabe-zeile">
        <input
          id={`${id}-preis`}
          className="lg-input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          disabled={gesperrt || laeuft}
          placeholder={aktuellCent !== null ? euro(aktuellCent) : "z. B. 2.450 €"}
          onChange={(e) => setText(e.target.value)}
          aria-describedby={`${id}-info`}
        />
        <GlassButton type="submit" size="sm" disabled={gesperrt || laeuft || !ergebnis?.ok || gleich}>
          {laeuft ? "Speichert …" : ergebnis?.ok && ergebnis.warnung ? "Trotzdem übernehmen" : "Übernehmen"}
        </GlassButton>
      </div>
      <p id={`${id}-info`} className="kalk-preis-eingabe-info" data-fehler={ergebnis && !ergebnis.ok ? "" : undefined} aria-live="polite">
        {ergebnis === null
          ? grenzen
            ? `Üblich von ${euro(grenzen.minCent)} (30 %) bis ${euro(grenzen.maxCent)} (60 %), mit Warnung ab ${euro(grenzen.hartMinCent)} (Selbstkosten).`
            : "Erst rechnen lassen, dann geht der Preis."
          : ergebnis.ok
            ? `${gleich ? "Das ist schon der Preis. " : ""}${ergebnis.abweichend ? `Genau so geht es nicht, nächster Preis ${euro(ergebnis.preisCent)}. ` : ergebnis.aufgerundet ? `Aufgerundet auf ${euro(ergebnis.preisCent)}. ` : ""}Ergibt ${PROZENT.format(ergebnis.prozent)} % Marge, Gewinn ${euro(ergebnis.gewinnCent)}.`
            : ergebnis.meldung}
      </p>
      {ergebnis?.ok && ergebnis.warnung ? (
        <p className="kalk-marge-warnung" role="status">
          {ergebnis.warnung} Übernehmen geht trotzdem.
        </p>
      ) : null}
    </form>
  );
}
