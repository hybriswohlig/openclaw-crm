"use client";

import { kuerzelAus } from "@/lib/akte";
import { anfahrtText, ortText, type Anfahrt } from "@/lib/einsatz";
import type { EinsatzPersonLage } from "@/lib/einsatz-ansicht";
import type { AuswahlEintrag } from "./einsatz-logik";

const ABWESEND_WORT = { urlaub: "Urlaub", krank: "krank", gesperrt: "gesperrt" } as const;

function satzText(cent: number): string {
  const e = cent / 100;
  return `${e.toLocaleString("de-DE", { minimumFractionDigits: Number.isInteger(e) ? 0 : 2, maximumFractionDigits: 2 })} €`;
}

function minutenText(min: number | null): string {
  if (min === null) return "–";
  return `${(min / 60).toLocaleString("de-DE", { maximumFractionDigits: 1 })} h`;
}

/**
 * Liste der Personen (12a Entscheidung 12): Haken, Name mit PLZ und Ort,
 * Lage am Tag, Anfahrt und Abfahrt, Sätze; Vorschlag gold markiert. Für
 * Ausgewählte darunter Minuten Fahrt und Arbeit, von Hand änderbar.
 */
export function EinsatzListe({
  personen,
  anfahrten,
  team,
  vorschlag,
  onUmschalten,
  onMinuten,
}: {
  personen: EinsatzPersonLage[];
  anfahrten: Anfahrt[];
  team: AuswahlEintrag[];
  vorschlag: string[];
  onUmschalten: (p: EinsatzPersonLage) => void;
  onMinuten: (id: string, teil: "fahrt" | "arbeit", wert: number | null) => void;
}) {
  if (personen.length === 0) {
    return <p className="ez-leer">Noch keine aktiven Mitarbeiter. Anlegen unter Mitarbeiter.</p>;
  }
  const reihenfolge = { frei: 0, belegt: 1, abwesend: 2 } as const;
  const sortiert = [...personen].sort(
    (a, b) =>
      Number(team.some((t) => t.employeeId === b.id)) - Number(team.some((t) => t.employeeId === a.id)) ||
      Number(vorschlag.includes(b.id)) - Number(vorschlag.includes(a.id)) ||
      reihenfolge[a.lage] - reihenfolge[b.lage] ||
      a.name.localeCompare(b.name, "de"),
  );
  return (
    <div className="ez-liste" role="list">
      <div className="ez-liste-kopf" aria-hidden="true">
        <span />
        <span>Person, Wohnort</span>
        <span>Am Tag</span>
        <span>Anfahrt, Abfahrt</span>
        <span>Satz je h</span>
      </div>
      {sortiert.map((p) => {
        const eintrag = team.find((t) => t.employeeId === p.id) ?? null;
        const an = anfahrten.find((a) => a.employeeId === p.id) ?? null;
        const ort = ortText(p);
        const kann = [p.kannSprinter ? "Sprinter" : null, p.eigenerPkw ? "eigener PKW" : "fährt mit"].filter(Boolean).join(" · ");
        return (
          <div key={p.id} role="listitem" className="ez-person" data-an={eintrag ? "" : undefined} data-lage={p.lage}>
            <button
              type="button"
              role="checkbox"
              aria-checked={eintrag !== null}
              className="ez-haken"
              onClick={() => onUmschalten(p)}
              aria-label={`${p.name} ${eintrag ? "aus dem Team nehmen" : "ins Team"}`}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </button>
            <div className="ez-wer">
              <span className="ez-avatar" aria-hidden="true">
                {p.kuerzel || kuerzelAus(p.name)}
              </span>
              <div className="ez-wer-text">
                <b>{p.name}</b>
                <small>{ort ?? "Ort fehlt"}</small>
                <small>{kann}</small>
                <span className="ez-marken">
                  {vorschlag.includes(p.id) ? <span className="ez-marke" data-art="vorschlag">Vorschlag</span> : null}
                  {eintrag?.role === "lead" ? <span className="ez-marke" data-art="lead">leitet</span> : null}
                  {!p.aktiv ? <span className="ez-marke">deaktiviert</span> : null}
                  {p.stempeltGerade ? <span className="ez-marke" data-art="stempel">eingestempelt</span> : null}
                </span>
              </div>
            </div>
            <div className="ez-lage-zelle">
              <span className="ez-lage" data-lage={p.lage}>
                {p.lage === "frei" ? "frei" : p.lage === "belegt" ? "belegt" : p.abwesend ? ABWESEND_WORT[p.abwesend] : "abwesend"}
                {p.lage === "belegt" && p.belegtMit.length > 0 ? <small>{p.belegtMit.map((d) => d.titel).join(", ")}</small> : null}
              </span>
            </div>
            <div className="ez-zahl ez-anfahrt">
              {p.lage === "abwesend" ? (
                <>
                  nicht abgefragt<small>am Tag abwesend</small>
                </>
              ) : !ort || !an ? (
                <>
                  {ort ? "unbekannt" : "Ort fehlt"}
                  <small>{ort ? "keine Fahrzeit" : "PLZ und Ort unter Mitarbeiter eintragen"}</small>
                </>
              ) : (
                <>
                  {anfahrtText(an.anKm, an.anMin, an.anMinQuelle)}
                  <small>zurück {anfahrtText(an.abKm, an.abMin, "geschaetzt")}</small>
                </>
              )}
            </div>
            <div className="ez-zahl ez-satz">
              Arbeit {satzText(p.satzArbeitCent)}
              <small>Fahrt {satzText(p.satzFahrtCent)}</small>
            </div>
            {eintrag ? (
              <div className="ez-minuten">
                <MinutenFeld
                  label="Fahrt"
                  wert={eintrag.fahrtMin}
                  vonHand={eintrag.vonHand.fahrt}
                  name={p.name}
                  onWert={(w) => onMinuten(p.id, "fahrt", w)}
                />
                <MinutenFeld
                  label="Arbeit"
                  wert={eintrag.arbeitMin}
                  vonHand={eintrag.vonHand.arbeit}
                  name={p.name}
                  onWert={(w) => onMinuten(p.id, "arbeit", w)}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function MinutenFeld({
  label,
  wert,
  vonHand,
  name,
  onWert,
}: {
  label: string;
  wert: number | null;
  vonHand: boolean;
  name: string;
  onWert: (w: number | null) => void;
}) {
  return (
    <label className="ez-minuten-feld" data-hand={vonHand || undefined}>
      <span>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={1440}
        step={5}
        value={wert ?? ""}
        aria-label={`${label} in Minuten für ${name}`}
        onChange={(e) => {
          const t = e.target.value.trim();
          const n = Number(t);
          onWert(t === "" ? null : Number.isFinite(n) ? Math.max(0, Math.min(1440, Math.round(n))) : null);
        }}
      />
      <span className="ez-minuten-einheit">min · {minutenText(wert)}</span>
      {vonHand ? (
        <button type="button" className="ez-mini" onClick={() => onWert(null)} aria-label={`${label} für ${name} wieder aus der Kalkulation`}>
          zurück
        </button>
      ) : null}
    </label>
  );
}
