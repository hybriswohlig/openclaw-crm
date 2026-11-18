"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { KV_EDITOR_TEXT, KV_HINWEIS_FELDER_GEPRUEFT, type KvAblehnung, type KvFeld, type KvStandDetail, type KvWert } from "@/lib/kv-editor";
import {
  anzahlAenderungen,
  fehlerJeFeld,
  formularAbschnitte,
  formularEingabe,
  lokalePruefung,
  standWert,
  zeichenRest,
  zustaendigOptionen,
} from "./kv-formular-logik";
import { SymbolSchliessen } from "./kv-symbole";

/** Nur lesend angezeigtes Umzugsgut ohne Lead-ID (Altbestand, MCP; Spec 6.1). */
export interface NurLesenZeile {
  name: string;
  raum: string | null;
}

/** Fehler vom Server zum letzten Speichern (400 `UNGUELTIG` oder ein Code mit Text). */
export interface FormularFehler {
  abgelehnt: { schluessel: string | null; grund: KvAblehnung }[];
  meldung: string | null;
}

/**
 * Formular „Bearbeiten“ (Spec 10): gegliedert wie der KV, Preisblock nur lesend mit
 * „Preis ändern“, Umzugsgut ohne Lead-ID nur lesend, Firma ausgegraut, wo nicht im
 * Preis. „Speichern“ legt einen neuen Stand als Entwurf an; die Werte bleiben stehen,
 * bis das Speichern geklappt hat.
 */
export function KvFormular({
  stand,
  firma,
  preis,
  nurLesen = [],
  bildUrl = () => null,
  fehler,
  speichert,
  onSpeichern,
  onSchliessen,
}: {
  stand: KvStandDetail;
  firma: string | null;
  preis: { text: string; kalkulationUrl: string };
  nurLesen?: NurLesenZeile[];
  /** Vorschaubild eines Anhangs (`/api/v1/deals/<id>/attachments/<anhangId>`); null: grauer Platzhalter. */
  bildUrl?: (anhangId: string) => string | null;
  fehler: FormularFehler | null;
  speichert: boolean;
  onSpeichern: (eingaben: Record<string, KvWert>) => void;
  onSchliessen: () => void;
}) {
  const [eingaben, setEingaben] = useState<Record<string, KvWert>>({});
  const wurzel = useRef<HTMLElement>(null);
  // Nach einer Ablehnung des Servers zum ersten markierten Feld springen.
  useEffect(() => {
    if (!fehler?.abgelehnt.length) return;
    const feld = wurzel.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-fehler] input');
    feld?.scrollIntoView?.({ block: "center" });
    feld?.focus({ preventScroll: true });
  }, [fehler]);
  const abschnitte = useMemo(() => formularAbschnitte(stand.basis), [stand.basis]);
  const eingabe = formularEingabe(stand.basis, stand.werte, eingaben, stand.id);
  const n = anzahlAenderungen(eingabe);
  const lokal = lokalePruefung(stand.basis, eingaben);
  const lokalFehler = Object.entries(lokal).map(([schluessel, grund]) => ({ schluessel, grund }));
  const server = fehlerJeFeld(fehler?.abgelehnt ?? [], stand.basis);
  const jeFeld = { ...server.jeFeld, ...fehlerJeFeld(lokalFehler, stand.basis).jeFeld };
  const umzugsgutDa = abschnitte.some((a) => a.abschnitt === "umzugsgut");

  function setze(f: KvFeld, w: KvWert) {
    setEingaben((alt) => ({ ...alt, [f.schluessel]: w }));
  }

  return (
    <aside ref={wurzel} className="kve-seite kve-formular" data-seite="rechts" aria-label="Bearbeiten">
      <div className="kve-seite-kopf">
        <h2>Bearbeiten</h2>
        <button type="button" className="kve-zu" aria-label="Bearbeiten schließen" onClick={onSchliessen}>
          <SymbolSchliessen />
        </button>
      </div>
      <form
        className="kve-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (n > 0 && lokalFehler.length === 0 && !speichert) onSpeichern(eingaben);
        }}
      >
        <div className="kve-form-rumpf">
          <section className="kve-abschnitt kve-preisblock" aria-label="Preis">
            <h3>Preis</h3>
            <p>{preis.text}</p>
            <p className="kve-klein">Der Preis kommt immer aus der Kalkulation und lässt sich hier nicht ändern.</p>
            <Link className="kve-klein-knopf" href={preis.kalkulationUrl}>
              Preis ändern
            </Link>
          </section>

          {stand.basis.felder.length === 0 ? (
            <p className="kve-band" data-ton="blau" role="status">
              <span>{KV_HINWEIS_FELDER_GEPRUEFT}</span>
            </p>
          ) : null}

          {abschnitte.map((a) => (
            <section key={a.abschnitt} className="kve-abschnitt" aria-label={a.titel}>
              <h3>{a.titel}</h3>
              {a.zeilen.map((z, i) => (
                <div key={`${z.gruppe ?? "ohne"}-${i}`} className="kve-zeile" data-gruppe={z.gruppe ? "" : undefined}>
                  {z.gruppe ? <h4>{z.gruppe}</h4> : null}
                  {z.felder.map((f) => (
                    <Feld
                      key={f.schluessel}
                      f={f}
                      firma={firma}
                      bild={f.anhangId ? bildUrl(f.anhangId) : null}
                      wert={f.schluessel in eingaben ? eingaben[f.schluessel] : standWert(f, stand.werte)}
                      geaendert={stand.aenderungen.some((x) => x.schluessel === f.schluessel)}
                      fehler={jeFeld[f.schluessel] ?? null}
                      gesperrt={speichert}
                      onWert={(w) => setze(f, w)}
                    />
                  ))}
                </div>
              ))}
              {a.abschnitt === "umzugsgut" ? <NurLesen zeilen={nurLesen} /> : null}
            </section>
          ))}
          {!umzugsgutDa && nurLesen.length > 0 ? (
            <section className="kve-abschnitt" aria-label="Umzugsgut">
              <h3>Umzugsgut</h3>
              <NurLesen zeilen={nurLesen} />
            </section>
          ) : null}
        </div>

        <div className="kve-form-fuss">
          {fehler?.meldung || server.allgemein.length > 0 ? (
            <div className="kve-meldung" data-ton="rose" role="alert">
              {fehler?.meldung ? <p>{fehler.meldung}</p> : null}
              {server.allgemein.map((t) => (
                <p key={t}>{t}</p>
              ))}
            </div>
          ) : null}
          <p className="kve-klein">
            {n === 0 ? "Noch nichts geändert." : n === 1 ? "1 Feld geändert." : `${n} Felder geändert.`} Speichern legt einen neuen Stand als Entwurf an; der Kunde sieht erst nach dem Pushen etwas.
          </p>
          <div className="kve-knoepfe">
            {n > 0 ? (
              <button type="button" className="kve-knopf" data-art="leise" disabled={speichert} onClick={() => setEingaben({})}>
                Verwerfen
              </button>
            ) : null}
            <button type="submit" className="kve-knopf" disabled={speichert || n === 0 || lokalFehler.length > 0}>
              {speichert ? "Speichert …" : "Speichern"}
            </button>
          </div>
        </div>
      </form>
    </aside>
  );
}

function NurLesen({ zeilen }: { zeilen: NurLesenZeile[] }) {
  if (zeilen.length === 0) return null;
  return (
    <div className="kve-nurlesen">
      <ul>
        {zeilen.map((z, i) => (
          <li key={`${z.name}-${i}`}>
            {z.name}
            {z.raum ? <span className="kve-klein"> · {z.raum}</span> : null}
          </li>
        ))}
      </ul>
      <p className="kve-klein">Umzugsgut in der Kalkulation ändern.</p>
    </div>
  );
}

function Feld({
  f,
  firma,
  bild,
  wert,
  geaendert,
  fehler,
  gesperrt,
  onWert,
}: {
  f: KvFeld;
  firma: string | null;
  bild: string | null;
  wert: KvWert;
  geaendert: boolean;
  fehler: string | null;
  gesperrt: boolean;
  onWert: (w: KvWert) => void;
}) {
  const id = useId();
  const fehlerId = `${id}-fehler`;
  const rest = zeichenRest(f, wert);
  const kopf = (
    <span className="kve-feld-kopf">
      <span>{f.label}</span>
      {geaendert ? <span className="kve-marke">geändert</span> : null}
      {rest ? <span className="kve-zaehler">{rest}</span> : null}
    </span>
  );
  const fehlerText = fehler ? (
    <span id={fehlerId} className="kve-feld-fehler">
      {fehler}
    </span>
  ) : null;

  if (f.art === "zeigen") {
    return (
      <label className="kve-feld kve-feld-zeigen" data-fehler={fehler ? "" : undefined}>
        {bild ? <img className="kve-bild" src={bild} alt="" loading="lazy" /> : f.anhangId ? <span className="kve-bild" aria-hidden="true" /> : null}
        <input type="checkbox" checked={wert === true} disabled={gesperrt} aria-describedby={fehler ? fehlerId : undefined} onChange={(e) => onWert(e.target.checked)} />
        {kopf}
        {fehlerText}
      </label>
    );
  }

  if (f.art === "zustaendig") {
    const optionen = zustaendigOptionen(f, firma);
    return (
      <fieldset className="kve-feld" data-fehler={fehler ? "" : undefined} aria-describedby={fehler ? fehlerId : undefined}>
        <legend>{kopf}</legend>
        <div className="kve-wahl">
          {optionen.map((o) => (
            <label key={o.wert} data-gesperrt={o.gesperrt || undefined} title={o.gesperrt ? KV_EDITOR_TEXT.FIRMA_GESPERRT : undefined}>
              <input type="radio" name={id} value={o.wert} checked={wert === o.wert} disabled={gesperrt || o.gesperrt} onChange={() => onWert(o.wert)} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
        {optionen.some((o) => o.gesperrt) ? <span className="kve-klein">{KV_EDITOR_TEXT.FIRMA_GESPERRT}</span> : null}
        {fehlerText}
      </fieldset>
    );
  }

  const text = typeof wert === "string" ? wert : "";
  return (
    <label className="kve-feld" data-fehler={fehler ? "" : undefined}>
      {kopf}
      {f.art === "langtext" ? (
        <textarea
          className="lg-input"
          value={text}
          rows={Math.min(6, Math.max(2, Math.ceil(text.length / 48)))}
          disabled={gesperrt}
          aria-invalid={fehler ? true : undefined}
          aria-describedby={fehler ? fehlerId : undefined}
          onChange={(e) => onWert(e.target.value)}
        />
      ) : (
        <input
          className="lg-input"
          type="text"
          value={text}
          disabled={gesperrt}
          aria-invalid={fehler ? true : undefined}
          aria-describedby={fehler ? fehlerId : undefined}
          onChange={(e) => onWert(e.target.value)}
        />
      )}
      {fehlerText}
    </label>
  );
}
