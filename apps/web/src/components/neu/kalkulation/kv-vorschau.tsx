"use client";

import type { KvErzeugung } from "@/lib/angebot-wahl";
import type { KalkulationsAnsicht } from "@/lib/kalkulations-ansicht";
import type { HebelArt } from "@/services/rechner/kv-posten";
import { euro } from "@/components/neu/akte/format";
import { kvMarke } from "./kv-erzeugung";
import "@/styles/neu-kalk-p15.css";

/** „4 Posten, Summe 2.480 €“, bei Vorschau und Spanne mit Zusatz. */
export function kvUnterzeile(kv: NonNullable<KalkulationsAnsicht["kv"]>): string {
  const teile = [`${kv.posten.length} ${kv.posten.length === 1 ? "Posten" : "Posten"}, Summe ${euro(kv.summeCent)}`];
  if (kv.obergrenze) teile.push("Obergrenze der Spanne");
  if (kv.vorschau) teile.push("Vorschau");
  return teile.join(" · ");
}

/**
 * „So steht es im KV“ (Spec 3.6): die Posten, wie sie der Kunde sieht, mit
 * Herkunft und Summe. Beim Entwurf eine Vorschau (so markiert), bei Spanne
 * mit „Obergrenze“; ohne Übernahme steht `kvFehler`. Bei Kottke (Plan 5a)
 * zeigt eine Marke rechts, wie weit das PDF ist.
 */
export function KvVorschau({
  kv,
  kvFehler,
  erzeugung,
  werkzeug,
}: {
  kv: KalkulationsAnsicht["kv"];
  kvFehler: string | null;
  erzeugung?: KvErzeugung;
  /** Plan 15 (Bauteil 6): „×“ an Hebel-Posten und „+ Posten“ */
  werkzeug?: { beschaeftigt: boolean; onAus: (hebel: HebelArt, text: string) => void; onPlus: (art: "zeitposten" | "material_frei") => void };
}) {
  const marke = erzeugung ? kvMarke(erzeugung) : null;
  return (
    <>
      <div className="kalk-panel-kopf" data-klein="">
        <div>
          <h3 className="kalk-panel-titel">So steht es im KV</h3>
          <p className="kalk-panel-unter">{kv ? kvUnterzeile(kv) : "Noch keine Posten."}</p>
        </div>
        {marke ? (
          <span className="kalk-marke kalk-kv-marke" data-ton={marke.ton}>
            {marke.text}
          </span>
        ) : null}
      </div>
      <div className="kalk-kv">
        {kv ? (
          kv.posten.map((p, i) => (
            <div key={`${p.text}-${i}`} className="kalk-kvl">
              <span className="kalk-kvl-t">{p.text}</span>
              <span className="kalk-kvl-a">
                {euro(p.betragCent)}
                {werkzeug && p.hebel ? (
                  <button
                    type="button"
                    className="kalk-kvl-x"
                    disabled={werkzeug.beschaeftigt}
                    onClick={() => werkzeug.onAus(p.hebel!, p.text)}
                    aria-label={`${p.text} herausnehmen`}
                    title="Herausnehmen"
                  >
                    ×
                  </button>
                ) : null}
              </span>
              {p.herkunft ? <span className="kalk-kvl-f">{p.herkunft}</span> : null}
            </div>
          ))
        ) : (
          <p className="kalk-kv-fehler" role="status">
            {kvFehler ?? "Der KV lässt sich aus dieser Version noch nicht bilden."}
          </p>
        )}
        {werkzeug ? (
          <div className="kalk-kurzgruende kalk-kv-plus">
            <button type="button" className="kalk-kleinknopf" disabled={werkzeug.beschaeftigt} onClick={() => werkzeug.onPlus("zeitposten")}>
              + Zeitposten
            </button>
            <button type="button" className="kalk-kleinknopf" disabled={werkzeug.beschaeftigt} onClick={() => werkzeug.onPlus("material_frei")}>
              + Material
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}

/**
 * Paketpreise nur zur Anzeige (Entscheidung 14): Liste mit Hinweis und Link
 * „Angebotsformular öffnen“. Gleiches Muster beim Stunden-KV.
 */
export function PaketeAnzeige({
  pakete,
  preisModus,
  link,
}: {
  pakete: KalkulationsAnsicht["pakete"];
  preisModus: KalkulationsAnsicht["version"]["preisModus"];
  link: string;
}) {
  const stunden = preisModus === "stunden";
  if (pakete.length === 0 && !stunden) return null;
  return (
    <>
      <div className="kalk-panel-kopf" data-klein="">
        <div>
          <h3 className="kalk-panel-titel">{stunden ? "Stunden-KV" : "Paketpreise"}</h3>
          <p className="kalk-panel-unter">{stunden ? "Dieses Angebot rechnet nach Stunden." : "Ein Preis je Paket aus derselben Kostenkette."}</p>
        </div>
      </div>
      {pakete.length > 0 ? (
        <ul className="kalk-pakete" aria-label="Paketpreise">
          {pakete.map((p) => (
            <li key={p.slug} className="kalk-paket">
              <span>{p.name}</span>
              <b>{p.preisCent === null ? "–" : euro(p.preisCent)}</b>
              {p.hinweis ? <small>{p.hinweis}</small> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="kalk-pakete-hinweis">
        {stunden
          ? "Sperren mit Stunden-KV kommt später. Bis dahin das Angebot über das Angebotsformular pflegen. "
          : "Sperren mit Paketpreisen kommt später. Bis dahin den Preis über die Paketpreise pflegen. "}
        <a href={link}>Angebotsformular öffnen</a>
      </p>
    </>
  );
}
