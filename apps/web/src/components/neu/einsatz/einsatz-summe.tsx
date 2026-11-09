"use client";

import { kuerzelAus } from "@/lib/akte";
import { euroText } from "@/lib/anzeige";
import type { EinsatzKostenZeile, LohnVergleich } from "@/lib/einsatz";
import type { AuswahlEintrag } from "./einsatz-logik";

/**
 * Team und Lohn (Mockup rechts oben): Team-Kürzel mit Entfernen, Kostenzeilen
 * aus `einsatzKosten`, Summe und `lohnVergleich` (gold nach `ton`). Nimmt nur
 * Props, damit 12c sie neben der Karte zeigt. „Anfahrt Team“ lässt sich als
 * Übersteuerung in die Kalkulation übernehmen (E7).
 */
export function EinsatzSumme({
  team,
  namen,
  kosten,
  vergleich,
  festpreisEur,
  anfahrtUebernommenEur,
  anfahrtLaeuft,
  onEntfernen,
  onLeitung,
  onAnfahrtUebernehmen,
  laengsteAnfahrt,
  leerText = "Noch niemand. Haken in der Liste setzen.",
}: {
  team: AuswahlEintrag[];
  namen: Record<string, string>;
  kosten: EinsatzKostenZeile[];
  vergleich: LohnVergleich;
  festpreisEur: number | null;
  anfahrtUebernommenEur: number | null;
  anfahrtLaeuft?: boolean;
  onEntfernen: (id: string) => void;
  onLeitung: (id: string) => void;
  onAnfahrtUebernehmen?: (euro: number) => void;
  /** 12c: „Längste Anfahrt: 31 min, A. Keller“ unter dem Team. */
  laengsteAnfahrt?: string | null;
  leerText?: string;
}) {
  const anfahrt = kosten.find((k) => k.key === "anfahrt_team");
  const lohn = kosten.filter((k) => k.key !== "anfahrt_team");
  const uebernommen = anfahrt && anfahrtUebernommenEur !== null && Math.round(anfahrtUebernommenEur * 100) === anfahrt.betragCent;
  return (
    <section className="ez-karte" aria-labelledby="ez-summe-titel">
      <div className="ez-karte-kopf">
        <h3 id="ez-summe-titel">Team und Lohn</h3>
        <p>rechnet bei jeder Änderung neu</p>
      </div>
      {/* 12c: Ablageziel der Karte (`data-ablage`), hervorgehoben über `data-heiss`. */}
      <div className="ez-team" aria-label="Team" data-ablage="team">
        {team.length === 0 ? <span className="ez-team-leer">{leerText}</span> : null}
        {team.map((t) => {
          const name = namen[t.employeeId] ?? "Unbekannt";
          return (
            <span key={t.employeeId} className="ez-team-person" data-lead={t.role === "lead" || undefined}>
              <span className="ez-avatar ez-avatar-klein" aria-hidden="true">
                {kuerzelAus(name)}
              </span>
              {name.split(" ")[0]}
              {t.role === "lead" ? (
                <span className="ez-leitet">leitet</span>
              ) : (
                <button type="button" className="ez-mini" onClick={() => onLeitung(t.employeeId)} aria-label={`${name} leitet`}>
                  leiten
                </button>
              )}
              <button type="button" className="ez-weg" onClick={() => onEntfernen(t.employeeId)} aria-label={`${name} entfernen`}>
                ×
              </button>
            </span>
          );
        })}
      </div>
      {laengsteAnfahrt ? <p className="ez-laengste">{laengsteAnfahrt}</p> : null}
      <div className="ez-kette">
        {lohn.map((k) => (
          <div key={k.key} className="ez-zeile">
            <span className="ez-zeile-text">{k.text}</span>
            <span className="ez-zeile-betrag">{euroText(k.betragCent)}</span>
            <span className="ez-zeile-formel">{k.formel}</span>
          </div>
        ))}
        {anfahrt ? (
          <div className="ez-zeile" data-anzeige="">
            <span className="ez-zeile-text">Anfahrt Team</span>
            <span className="ez-zeile-betrag">{euroText(anfahrt.betragCent)}</span>
            <span className="ez-zeile-formel">{anfahrt.formel} · nur eigener PKW, An- und Abfahrt</span>
            {onAnfahrtUebernehmen ? (
              <span className="ez-zeile-aktion">
                {uebernommen ? (
                  <span className="ez-ok">in der Kalkulation</span>
                ) : (
                  <button
                    type="button"
                    className="ez-link"
                    disabled={anfahrtLaeuft}
                    aria-busy={anfahrtLaeuft || undefined}
                    onClick={() => onAnfahrtUebernehmen(anfahrt.betragCent / 100)}
                  >
                    {anfahrtLaeuft ? "Wird übernommen …" : "In Kalkulation übernehmen"}
                  </button>
                )}
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="ez-summe">
          <span>{anfahrt ? "Lohn und Anfahrt" : "Lohn"}</span>
          <span>{euroText(vergleich.summeCent)}</span>
        </div>
        {vergleich.kalkulationCent !== null ? (
          <div className="ez-kalk">
            <span>Kalkulation (Personal, Anfahrtsgeld)</span>
            <span>{euroText(vergleich.kalkulationCent)}</span>
          </div>
        ) : null}
        {vergleich.text ? (
          <div className="ez-vergleich" data-ton={vergleich.ton}>
            {vergleich.text}
            <small>
              {festpreisEur !== null ? `Preis bleibt ${euroText(Math.round(festpreisEur * 100))}. ` : ""}Die Marge ist nur eine Anzeige.
            </small>
          </div>
        ) : (
          <div className="ez-vergleich">
            Kein Vergleich
            <small>Ohne Kalkulation fehlt die Annahme für Personal.</small>
          </div>
        )}
      </div>
    </section>
  );
}
