"use client";

import "@/styles/neu-einsatz.css";

import type { TagesRasterZelle } from "@/lib/angebot-wahl";
import { tagKurz } from "@/lib/anzeige";
import { planTitel, WOCHENTAGE_KURZ } from "@/lib/plan-heute";
import {
  betragKurz,
  gruendeText,
  istVergangen,
  monatErlaubt,
  monatPlus,
  monatsWochen,
  punkteText,
  zellenText,
  type AuswahlTag,
} from "./termin-logik";

/** Ladezustand eines Monats im Raster. */
export type MonatsStand = { art: "laedt" } | { art: "fertig" } | { art: "fehler"; message: string };

/**
 * Monatsraster des Termin-Dialogs (Entscheidung 12): je Tag der Kundenpreis
 * (empfohlenes Paket, sonst Hauptpreis), die Margenpunkte für Wochentag,
 * Feiertag und Eile, die Zahl der Aufträge (Klick: Namen) und der
 * Wunschtermin. Vergangene Tage sind gesperrt, Tage des Nachbarmonats leer.
 * Kapazität je Tag (Plan 12a): „N frei“ nach festen Umzügen und Abwesenheiten,
 * Klick zeigt die Namen; ohne aktive Mitarbeiter fehlt der Chip. Ein Klick auf
 * einen Tag wählt ihn an oder ab.
 */
export function TerminRaster({
  monat,
  heute,
  zellen,
  stand,
  auswahl,
  wunsch,
  offenerTag,
  gesperrt,
  onMonat,
  onTag,
  onAuftraege,
  onNeuLaden,
}: {
  monat: string;
  heute: string;
  zellen: Readonly<Record<string, TagesRasterZelle>>;
  stand: MonatsStand | undefined;
  auswahl: readonly AuswahlTag[];
  wunsch: { datum: string | null; weitere: string[] };
  offenerTag: string | null;
  gesperrt: boolean;
  onMonat: (monat: string) => void;
  onTag: (datum: string) => void;
  onAuftraege: (datum: string | null) => void;
  onNeuLaden: () => void;
}) {
  const vor = monatPlus(monat, -1);
  const nach = monatPlus(monat, 1);
  const laedt = stand?.art === "laedt";
  const gewaehlt = new Map(auswahl.map((t) => [t.datum, t]));
  const wuensche = new Set([wunsch.datum, ...wunsch.weitere].filter((d): d is string => !!d));
  const offen = offenerTag ? zellen[offenerTag] : undefined;

  return (
    <section className="termin-raster" aria-label="Monatsraster">
      <div className="termin-raster-kopf">
        <button
          type="button"
          className="termin-pfeil"
          aria-label="Vorheriger Monat"
          disabled={gesperrt || !monatErlaubt(vor, heute)}
          onClick={() => onMonat(vor)}
        >
          <Pfeil richtung="links" />
        </button>
        <h3 className="termin-raster-titel" aria-live="polite">
          {planTitel("monat", `${monat}-01`)}
        </h3>
        <button
          type="button"
          className="termin-pfeil"
          aria-label="Nächster Monat"
          disabled={gesperrt || !monatErlaubt(nach, heute)}
          onClick={() => onMonat(nach)}
        >
          <Pfeil richtung="rechts" />
        </button>
      </div>

      {stand?.art === "fehler" ? (
        <div className="termin-band" data-ton="rose" role="alert">
          <span>Preise für diesen Monat fehlen: {stand.message}</span>
          <button type="button" className="termin-kleinknopf" onClick={onNeuLaden}>
            Erneut laden
          </button>
        </div>
      ) : null}

      <div className="termin-gitter" role="group" aria-busy={laedt || undefined} aria-label={planTitel("monat", `${monat}-01`)}>
        <div className="termin-woche termin-wochentage" aria-hidden>
          {WOCHENTAGE_KURZ.map((w) => (
            <span key={w} className="termin-wochentag">
              {w}
            </span>
          ))}
        </div>
        {monatsWochen(monat).map((woche, i) => (
          <div key={i} className="termin-woche">
            {woche.map((datum, j) => {
              if (datum === null) return <span key={`leer-${j}`} className="termin-zelle" data-leer="" />;
              const zelle = zellen[datum];
              const vergangen = istVergangen(datum, heute) || zelle?.vergangen === true;
              const wahl = gewaehlt.get(datum);
              const istWunsch = wuensche.has(datum);
              const anzahl = zelle?.auftraege.length ?? 0;
              const punkte = zelle && !vergangen ? punkteText(zelle.gruende) : null;
              const titel = zelle && !vergangen ? gruendeText(zelle.gruende) : "";
              return (
                <div
                  key={datum}
                  className="termin-zelle"
                  data-vergangen={vergangen || undefined}
                  data-gewaehlt={wahl ? "" : undefined}
                  data-wunsch={istWunsch || undefined}
                  data-feiertag={zelle?.feiertag || undefined}
                >
                  <button
                    type="button"
                    className="termin-tag"
                    aria-pressed={!!wahl}
                    aria-label={zellenText(datum, zelle, { gewaehlt: !!wahl, empfohlen: !!wahl?.empfohlen, wunsch: istWunsch, vergangen })}
                    title={titel || undefined}
                    disabled={vergangen || gesperrt}
                    onClick={() => onTag(datum)}
                  >
                    <span className="termin-tag-nr">
                      {Number(datum.slice(8))}
                      {wahl?.empfohlen ? <Stern /> : null}
                    </span>
                    {vergangen ? null : zelle ? (
                      <span className="termin-tag-preis">
                        {zelle.preisCent !== null ? (
                          <>
                            {betragKurz(zelle.preisCent)}
                            <span className="termin-euro"> €</span>
                          </>
                        ) : (
                          "kein Preis"
                        )}
                      </span>
                    ) : laedt ? (
                      <span className="termin-tag-preis lg-skeleton" aria-hidden />
                    ) : null}
                    <span className="termin-tag-fuss">
                      {zelle?.feiertag && !vergangen ? <span className="termin-tag-feiertag">Feiertag</span> : null}
                      {punkte ? <span className="termin-tag-punkte">{punkte}</span> : null}
                      {istWunsch ? <span className="termin-tag-wunsch">Wunsch</span> : null}
                    </span>
                  </button>
                  {zelle?.kapazitaet && !vergangen ? (
                    <button
                      type="button"
                      className="termin-kapazitaet"
                      data-ton={zelle.kapazitaet.ton}
                      aria-expanded={offenerTag === datum}
                      aria-label={`${zelle.kapazitaet.text} am ${tagKurz(datum)}, Namen zeigen`}
                      onClick={() => onAuftraege(offenerTag === datum ? null : datum)}
                    >
                      <i aria-hidden="true" />
                      {zelle.kapazitaet.text.replace(" frei", "")}
                      <span className="termin-kapazitaet-wort"> frei</span>
                    </button>
                  ) : null}
                  {anzahl > 0 ? (
                    <button
                      type="button"
                      className="termin-auftraege"
                      aria-expanded={offenerTag === datum}
                      aria-label={`${anzahl === 1 ? "1 Auftrag" : `${anzahl} Aufträge`} am ${tagKurz(datum)} zeigen`}
                      onClick={() => onAuftraege(offenerTag === datum ? null : datum)}
                    >
                      {anzahl}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {offen && offenerTag ? (
        <div className="termin-auftrag-liste" role="region" aria-label={`Aufträge am ${tagKurz(offenerTag)}`}>
          <div className="termin-auftrag-kopf">
            <b>Aufträge am {tagKurz(offenerTag)}</b>
            <button type="button" className="termin-kleinknopf" onClick={() => onAuftraege(null)}>
              Schließen
            </button>
          </div>
          {offen.auftraege.length > 0 ? (
            <ul>
              {offen.auftraege.map((a) => (
                <li key={a.dealId}>
                  <a href={`/app/leads/${encodeURIComponent(a.dealId)}`} target="_blank" rel="noreferrer">
                    {a.name}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="termin-kapazitaet-namen">Keine festen Aufträge.</p>
          )}
          {offen.kapazitaet ? (
            <p className="termin-kapazitaet-namen">
              <b>{offen.kapazitaet.text}:</b> {offen.kapazitaet.frei.length > 0 ? offen.kapazitaet.frei.join(", ") : "niemand"}
            </p>
          ) : null}
        </div>
      ) : null}

      <ul className="termin-legende" aria-label="Legende">
        <li>
          <i data-art="wunsch" aria-hidden /> Wunschtermin
        </li>
        <li>
          <i data-art="gewaehlt" aria-hidden /> angeboten
        </li>
        <li>
          <Stern /> empfohlen
        </li>
        <li>
          <b className="termin-legende-punkte">+5 %</b> Aufschlag der Marge
        </li>
        <li>
          <b className="termin-legende-zahl">2</b> feste Aufträge am Tag
        </li>
        {Object.values(zellen).some((z) => z.kapazitaet) ? (
          <li>
            <span className="termin-kapazitaet termin-kapazitaet-legende" data-ton="gruen">
              <i aria-hidden="true" />3 frei
            </span>{" "}
            Personen ohne festen Umzug und ohne Abwesenheit
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function Pfeil({ richtung }: { richtung: "links" | "rechts" }) {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
      <path
        d={richtung === "links" ? "M12.5 4.5L7 10l5.5 5.5" : "M7.5 4.5L13 10l-5.5 5.5"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Stern() {
  return (
    <svg className="termin-stern" viewBox="0 0 20 20" width="11" height="11" aria-hidden>
      <path d="M10 1.8l2.5 5.2 5.7.8-4.1 4 1 5.6L10 14.7l-5.1 2.7 1-5.6-4.1-4 5.7-.8z" fill="currentColor" />
    </svg>
  );
}
