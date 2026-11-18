"use client";

import { useState } from "react";
import type { KvFeld, KvStandKopf } from "@/lib/kv-editor";
import { schluesselTitel, standAbzeichen, verlaufZeilen } from "./kv-editor-logik";
import { wertText } from "./kv-formular-logik";
import { SymbolSchliessen } from "./kv-symbole";

/**
 * Verlauf (Spec 10): Stände neueste oben mit Zeit, Person, „KI im Auftrag von …“,
 * Herkunft und Push; Änderungen aufklappbar; „Ansehen“, „PDF öffnen“ und
 * „Als neuen Entwurf verwenden“ (legt einen Entwurf mit dessen Liste an).
 */
export function KvVerlauf({
  staende,
  gewaehltId,
  felder,
  firma,
  jetzt,
  pdfUrl,
  beschaeftigt,
  onAnsehen,
  onAlsEntwurf,
  onSchliessen,
}: {
  staende: KvStandKopf[];
  gewaehltId: string | null;
  /** Katalog des neuesten Stands (Feldtitel). */
  felder: readonly KvFeld[];
  firma: string | null;
  jetzt: Date;
  pdfUrl: (standId: string) => string | null;
  beschaeftigt: boolean;
  onAnsehen: (standId: string) => void;
  onAlsEntwurf: (standId: string) => void;
  onSchliessen: () => void;
}) {
  const neuesterId = staende[0]?.id ?? null;
  return (
    <aside id="kve-verlauf" className="kve-seite kve-verlauf" data-seite="links" aria-label="Verlauf">
      <div className="kve-seite-kopf">
        <h2>Verlauf</h2>
        <button type="button" className="kve-zu" aria-label="Verlauf schließen" onClick={onSchliessen}>
          <SymbolSchliessen />
        </button>
      </div>
      <ol className="kve-staende">
        {staende.map((s) => (
          <StandEintrag
            key={s.id}
            s={s}
            gewaehlt={s.id === gewaehltId}
            neuester={s.id === neuesterId}
            felder={felder}
            firma={firma}
            jetzt={jetzt}
            pdf={s.status === "fertig" ? pdfUrl(s.id) : null}
            beschaeftigt={beschaeftigt}
            onAnsehen={() => onAnsehen(s.id)}
            onAlsEntwurf={() => onAlsEntwurf(s.id)}
          />
        ))}
      </ol>
    </aside>
  );
}

function StandEintrag({
  s,
  gewaehlt,
  neuester,
  felder,
  firma,
  jetzt,
  pdf,
  beschaeftigt,
  onAnsehen,
  onAlsEntwurf,
}: {
  s: KvStandKopf;
  gewaehlt: boolean;
  neuester: boolean;
  felder: readonly KvFeld[];
  firma: string | null;
  jetzt: Date;
  pdf: string | null;
  beschaeftigt: boolean;
  onAnsehen: () => void;
  onAlsEntwurf: () => void;
}) {
  const [offen, setOffen] = useState(false);
  const abz = standAbzeichen(s);
  const listeId = `kve-aenderungen-${s.id}`;
  return (
    <li className="kve-stand" aria-current={gewaehlt ? "true" : undefined}>
      <div className="kve-stand-kopf">
        <b>Stand {s.nummer}</b>
        <span className="kve-pille kve-pille-klein" data-ton={abz.ton}>
          <i className="kve-punkt" data-ton={abz.ton} aria-hidden="true" />
          {abz.text}
        </span>
      </div>
      <ul className="kve-stand-zeilen">
        {verlaufZeilen(s, jetzt).map((z) => (
          <li key={z}>{z}</li>
        ))}
      </ul>
      {s.aenderungen.length > 0 ? (
        <>
          <button type="button" className="kve-link" aria-expanded={offen} aria-controls={listeId} onClick={() => setOffen((x) => !x)}>
            {offen ? "Änderungen ausblenden" : `Änderungen zeigen (${s.aenderungen.length})`}
          </button>
          {offen ? (
            <ul id={listeId} className="kve-aenderungen">
              {s.aenderungen.map((a) => {
                const f = felder.find((x) => x.schluessel === a.schluessel) ?? null;
                return (
                  <li key={a.schluessel}>
                    <span className="kve-aenderung-titel">
                      {schluesselTitel(a.schluessel, felder, s.renderer)}
                      {a.quelle === "ki" ? <span className="kve-marke">KI</span> : null}
                    </span>
                    <span className="kve-aenderung-wert">
                      <s>{wertText(a.vorher, f?.art ?? null, firma)}</s> → {wertText(a.wert, f?.art ?? null, firma)}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </>
      ) : null}
      <div className="kve-stand-knoepfe">
        {!gewaehlt ? (
          <button type="button" className="kve-klein-knopf" onClick={onAnsehen}>
            Ansehen
          </button>
        ) : null}
        {pdf ? (
          <a className="kve-klein-knopf" href={pdf} target="_blank" rel="noopener noreferrer">
            PDF öffnen
          </a>
        ) : null}
        {!neuester ? (
          <button type="button" className="kve-klein-knopf" disabled={beschaeftigt} onClick={onAlsEntwurf}>
            Als neuen Entwurf verwenden
          </button>
        ) : null}
      </div>
    </li>
  );
}
