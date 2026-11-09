"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { apiAufruf } from "@/components/neu/akte/api";
import type {
  FahrzeugAnsicht,
  FirmaEinstellungenAnsicht,
  RechnerStammdaten,
  RechnerStammdatenAntwort,
  TarifAnsicht,
} from "@/lib/einstellungen-uebersicht";
import { datumText, euroText } from "./einstellungen-logik";
import { TEXT } from "./texte";

type Zustand = { art: "wartet" } | { art: "laden" } | { art: "fehler"; text: string } | { art: "fertig"; daten: RechnerStammdaten };

const EINHEIT = { pauschal: "pauschal", m3: "je m³", stueck: "je Stück" } as const;
const TAGE = [
  ["mo", "Mo"],
  ["di", "Di"],
  ["mi", "Mi"],
  ["do", "Do"],
  ["fr", "Fr"],
  ["sa", "Sa"],
  ["so", "So"],
] as const;

/** Tarif, den der Rechner für die Firma nimmt: eigene Marke, sonst der gemeinsame aktive. */
export function tarifFuerFirma(d: RechnerStammdaten, marke: FirmaEinstellungenAnsicht["marke"]): TarifAnsicht | null {
  if (marke) return d.tarif[marke];
  return d.versionen.find((t) => t.aktiv && t.marke === null) ?? null;
}

export function mieteText(f: FahrzeugAnsicht): string {
  if (f.mietpreisWochentage) return TAGE.map(([k, l]) => `${l} ${euroText(f.mietpreisWochentage![k])}`).join(", ");
  return f.mietpreisProTag == null ? "–" : `${euroText(f.mietpreisProTag)} je Tag`;
}

function TarifTabelle({ t }: { t: TarifAnsicht }) {
  const zeilen: [string, string][] = [
    ["Satz Arbeit (intern)", t.satzArbeit == null ? "–" : `${euroText(t.satzArbeit)} je Std.`],
    ["Satz Fahrt (intern)", t.satzFahrt == null ? "–" : `${euroText(t.satzFahrt)} je Std.`],
    ["Stundensatz intern", `${euroText(t.stundensatzIntern)} je Std.`],
    ["Verkaufssatz", `${euroText(t.stundensatzVerkauf)} je Std.`],
    ["Fahrzeugpauschale", `${euroText(t.fahrzeugpauschaleVerkaufProTag)} je Tag`],
    ["km-Satz", `${euroText(t.kmSatzVerkauf)} je km`],
    ["Gemeinkosten", t.gemeinkostenProzent == null ? "–" : `${t.gemeinkostenProzent.toLocaleString("de-DE")} %`],
    ["Versicherung", euroText(t.versicherungPauschal)],
    ["Rundung", `auf ${euroText(t.rundungEur)}`],
    ["Halteverbot", euroText(t.halteverbotVerkauf)],
    ["Entsorgung", `${euroText(t.entsorgungProCbmVerkauf)} je m³`],
    ...t.material.map((m): [string, string] => [m.bezeichnung, `${euroText(m.satz)} ${EINHEIT[m.einheit]}`]),
  ];
  return (
    <dl className="einst-werte">
      {zeilen.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function tarifKopf(t: TarifAnsicht): string {
  const teile = [`Tarif v${t.version}`];
  if (t.gueltigAb) teile.push(`gültig ab ${datumText(t.gueltigAb)}`);
  return teile.join(", ");
}

/**
 * Rechner-Stammdaten nur lesen (Entscheidung 9). Lädt erst, wenn der Abschnitt
 * sichtbar wird, damit die Seite nicht auf den Rechner wartet.
 */
export function RechnerAbschnitt({ firmen, rechnerUrl }: { firmen: FirmaEinstellungenAnsicht[]; rechnerUrl: string | null }) {
  const [z, setZ] = useState<Zustand>({ art: "wartet" });
  const ref = useRef<HTMLElement>(null);

  const laden = useCallback(async () => {
    setZ({ art: "laden" });
    const r = await apiAufruf<RechnerStammdatenAntwort>("/api/v1/einstellungen/rechner");
    if (!r.ok) setZ({ art: "fehler", text: r.message });
    else if (!r.data.ok) setZ({ art: "fehler", text: r.data.fehler });
    else setZ({ art: "fertig", daten: r.data.daten });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || z.art !== "wartet") return;
    if (typeof IntersectionObserver === "undefined") {
      void laden();
      return;
    }
    const beob = new IntersectionObserver((eintraege) => {
      if (eintraege.some((e) => e.isIntersecting)) {
        beob.disconnect();
        void laden();
      }
    });
    beob.observe(el);
    return () => beob.disconnect();
  }, [laden, z.art]);

  return (
    <section className="einst-bereich" id="rechner" ref={ref} aria-labelledby="einst-rechner" aria-busy={z.art === "laden" || undefined}>
      <div className="einst-bereich-kopf">
        <h2 className="einst-bereich-titel" id="einst-rechner">
          {TEXT.abschnittRechner}
        </h2>
        <p className="einst-satz">
          {TEXT.rechnerSatz}{" "}
          {rechnerUrl ? (
            <a href={rechnerUrl} target="_blank" rel="noopener noreferrer">
              {TEXT.rechnerOeffnen}
            </a>
          ) : null}
        </p>
      </div>

      {z.art === "wartet" || z.art === "laden" ? (
        <span className="lg-skeleton einst-skelett" aria-label={TEXT.rechnerLaden} />
      ) : null}

      {z.art === "fehler" ? (
        <GlassPanel variant="panel" className="einst-karte" role="alert">
          <p className="einst-fehler">{z.text}</p>
          <div>
            <GlassButton type="button" size="sm" onClick={() => void laden()}>
              {TEXT.rechnerErneut}
            </GlassButton>
          </div>
        </GlassPanel>
      ) : null}

      {z.art === "fertig" ? (
        <>
          <div className="einst-rechner-tarife">
            {firmen.map((f) => {
              const t = tarifFuerFirma(z.daten, f.marke);
              return (
                <GlassPanel key={f.id} variant="panel" className="einst-karte">
                  <h3>{f.name}</h3>
                  {t ? (
                    <>
                      <p className="einst-tarif-kopf">{tarifKopf(t)}</p>
                      {t.kommentar ? <p className="einst-satz">{t.kommentar}</p> : null}
                      <TarifTabelle t={t} />
                    </>
                  ) : (
                    <p className="einst-leer">{TEXT.rechnerKeinTarif}</p>
                  )}
                </GlassPanel>
              );
            })}
          </div>

          {z.daten.versionen.length > 0 ? (
            <details className="einst-details">
              <summary>
                {TEXT.rechnerFrueher} ({z.daten.versionen.length})
              </summary>
              <div className="einst-tabelle-huelle">
                <table className="einst-tabelle">
                  <thead>
                    <tr>
                      <th scope="col">Version</th>
                      <th scope="col">Marke</th>
                      <th scope="col">Gültig ab</th>
                      <th scope="col">Verkaufssatz</th>
                      <th scope="col">Status</th>
                      <th scope="col">Kommentar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {z.daten.versionen.map((t) => (
                      <tr key={t.id}>
                        <td>v{t.version}</td>
                        <td>{t.marke === "kottke" ? "Kottke" : t.marke === "ceylan" ? "Ceylan" : "gemeinsam"}</td>
                        <td>{datumText(t.gueltigAb)}</td>
                        <td>{euroText(t.stundensatzVerkauf)}</td>
                        <td>{t.aktiv ? "aktiv" : "alt"}</td>
                        <td>{t.kommentar ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}

          <GlassPanel variant="panel" className="einst-karte">
            <h3>{TEXT.rechnerStationen}</h3>
            <div className="einst-tabelle-huelle">
              <table className="einst-tabelle">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Anbieter</th>
                    <th scope="col">Adresse</th>
                    <th scope="col">Wegezeit</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {z.daten.stationen.map((s) => (
                    <tr key={s.id} data-aus={!s.aktiv || undefined}>
                      <td>
                        {s.name}
                        {s.istDepot ? <span className="einst-marke">Depot</span> : null}
                      </td>
                      <td>{s.anbieter ?? "–"}</td>
                      <td>{s.adresse}</td>
                      <td>{s.wegezeitPersonalMin} Min.</td>
                      <td>{s.aktiv ? "aktiv" : "aus"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GlassPanel>

          <GlassPanel variant="panel" className="einst-karte">
            <h3>{TEXT.rechnerFahrzeuge}</h3>
            <div className="einst-tabelle-huelle">
              <table className="einst-tabelle">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Typ</th>
                    <th scope="col">Station</th>
                    <th scope="col">Laderaum</th>
                    <th scope="col">Miete</th>
                    <th scope="col">inkl. km</th>
                    <th scope="col">Mehr-km</th>
                    <th scope="col">Pauschale</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {z.daten.fahrzeuge.map((f) => (
                    <tr key={f.id} data-aus={!f.aktiv || undefined}>
                      <td>{f.name}</td>
                      <td>{f.typ || "–"}</td>
                      <td>{f.stationName ?? "–"}</td>
                      <td>{f.laderaumCbm.toLocaleString("de-DE")} m³</td>
                      <td>{mieteText(f)}</td>
                      <td>{f.inklusivKmProTag == null ? "–" : `${f.inklusivKmProTag} je Tag`}</td>
                      <td>{f.mehrkilometerPreis == null ? "–" : `${euroText(f.mehrkilometerPreis)} je km`}</td>
                      <td>{euroText(f.tagespauschale)}</td>
                      <td>{f.aktiv ? "aktiv" : "aus"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GlassPanel>
          <p className="einst-satz">Stand {datumText(z.daten.stand)}, {new Date(z.daten.stand).toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" })} Uhr.</p>
        </>
      ) : null}
    </section>
  );
}
