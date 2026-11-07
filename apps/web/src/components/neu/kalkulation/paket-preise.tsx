"use client";

import { paketOhneHebelSperrt, type PreisModus } from "@/lib/angebot-wahl";
import type { KalkulationsAnsicht, PaketAnsicht, TagAnsicht } from "@/lib/kalkulations-ansicht";
import { euro } from "@/components/neu/akte/format";
import { hebelText, modusName, type PreisStart } from "./preis-logik";

/**
 * Preismodus der Version (Plan 5b, Entscheidung 7): Festpreis oder
 * Stunden-KV. Der Wechsel ist eine Anpassung mit Grund (`preismodus`), der
 * Klick öffnet daher den Preis-Dialog.
 */
export function PreismodusWahl({
  modus,
  beschaeftigt,
  onPreis,
}: {
  modus: PreisModus;
  beschaeftigt: boolean;
  onPreis: (start: PreisStart) => void;
}) {
  return (
    <div className="kalk-modus" role="group" aria-label="Preismodus">
      <span className="kalk-modus-label">Preismodus</span>
      <div className="kalk-modus-wahl">
        {(["fest", "stunden"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className="kalk-modus-knopf"
            aria-pressed={modus === m}
            disabled={beschaeftigt}
            onClick={() => (modus === m ? undefined : onPreis({ art: "preismodus", modus: m }))}
          >
            {modusName(m)}
          </button>
        ))}
      </div>
    </div>
  );
}

function PaketZeile({
  paket,
  beschaeftigt,
  onPreis,
}: {
  paket: PaketAnsicht;
  beschaeftigt: boolean;
  onPreis: (start: PreisStart) => void;
}) {
  const ohnePreis = paket.preisCent === null;
  const leistungen = hebelText(paket.hebel);
  const ohneHebel = paket.hebel !== undefined && paketOhneHebelSperrt({ slug: paket.slug, hebel: paket.hebel });
  const kernKlein = paket.kern?.art === "klein" ? Math.round(paket.kern.anteil * 100) : null;
  return (
    <li className="kalk-pz" data-uebersteuert={paket.uebersteuert ? "" : undefined} data-ohne-preis={ohnePreis ? "" : undefined}>
      <div className="kalk-pz-kopf">
        <span className="kalk-pz-name">{paket.name}</span>
        <b className="kalk-pz-preis">{ohnePreis ? "kein Preis" : euro(paket.preisCent as number)}</b>
        <button
          type="button"
          className="kalk-kleinknopf"
          disabled={beschaeftigt}
          aria-label={`${paket.name}: Preis ${ohnePreis ? "eintragen" : "anpassen"}`}
          onClick={() =>
            onPreis({
              art: "paketpreis",
              slug: paket.slug,
              betrag: paket.uebersteuert ? paket.uebersteuert.betragCent / 100 : undefined,
            })
          }
        >
          {ohnePreis ? "Eintragen" : "Anpassen"}
        </button>
      </div>
      {leistungen ? <p className="kalk-pz-info">{leistungen}</p> : null}
      {paket.uebersteuert ? (
        <p className="kalk-pz-anp">
          {paket.rechnerPreisCent != null ? `Rechner ${euro(paket.rechnerPreisCent)}, ` : ""}angepasst: „{paket.uebersteuert.grund}“
        </p>
      ) : null}
      {paket.hinweis ? <p className="kalk-pz-info">{paket.hinweis}</p> : null}
      {kernKlein !== null ? <p className="kalk-pz-warn">Erster Posten nur {kernKlein} % des Preises</p> : null}
      {paket.kern?.art === "negativ" ? <p className="kalk-pz-warn" data-ton="rose">Hebel größer als der Preis</p> : null}
      {ohneHebel ? <p className="kalk-pz-warn" data-ton="rose">Keine Leistungen hinterlegt (Portal-Einstellungen, Pakete)</p> : null}
    </li>
  );
}

/**
 * Paketpreise aus der Kalkulation (Plan 5b, F5 bis F7): je Paket der
 * wirksame Preis, die Leistungen (Hebel), eine Anpassung gold mit Rechnerwert
 * und Grund; „Anpassen“ öffnet den Preis-Dialog. Paket ohne Preis
 * (Einzeltransport, frei angelegt): „Eintragen“.
 */
export function PaketPreise({
  pakete,
  beschaeftigt,
  onPreis,
}: {
  pakete: KalkulationsAnsicht["pakete"];
  beschaeftigt: boolean;
  onPreis: (start: PreisStart) => void;
}) {
  if (pakete.length === 0) return null;
  return (
    <>
      <div className="kalk-panel-kopf" data-klein="">
        <div>
          <h3 className="kalk-panel-titel">Paketpreise</h3>
          <p className="kalk-panel-unter">Kern plus die Leistungen des Pakets, aus derselben Kostenkette.</p>
        </div>
      </div>
      <ul className="kalk-pzl" aria-label="Paketpreise">
        {pakete.map((p) => (
          <PaketZeile key={p.slug} paket={p} beschaeftigt={beschaeftigt} onPreis={onPreis} />
        ))}
      </ul>
    </>
  );
}

function TagZeile({ tag }: { tag: TagAnsicht }) {
  return (
    <li className="kalk-pz" data-uebersteuert={tag.uebersteuert ? "" : undefined}>
      <div className="kalk-pz-kopf" data-ohne-knopf="">
        <span className="kalk-pz-name">
          {tag.text}
          {tag.empfohlen ? (
            <span className="kalk-marke" data-ton="jade">
              empfohlen
            </span>
          ) : null}
          {tag.feiertag ? (
            <span className="kalk-marke" data-ton="gold">
              Feiertag
            </span>
          ) : null}
        </span>
        <b className="kalk-pz-preis">{tag.preisCent === null ? "kein Preis" : euro(tag.preisCent)}</b>
      </div>
      {tag.uebersteuert ? (
        <p className="kalk-pz-anp">
          {tag.rechnerPreisCent != null ? `Rechner ${euro(tag.rechnerPreisCent)}, ` : ""}angepasst: „{tag.uebersteuert.grund}“
        </p>
      ) : null}
      {tag.slots.length > 0 || tag.note ? (
        <p className="kalk-pz-info">{[...tag.slots.map((s) => s.label), tag.note].filter(Boolean).join(" · ")}</p>
      ) : null}
    </li>
  );
}

/** Angebotene Tage der Version (aus dem Termin-Dialog); geändert wird dort. */
export function TagePreise({ tage }: { tage: KalkulationsAnsicht["tage"] }) {
  if (tage.length === 0) return null;
  return (
    <>
      <div className="kalk-panel-kopf" data-klein="">
        <div>
          <h3 className="kalk-panel-titel">Angebotene Tage</h3>
          <p className="kalk-panel-unter">Preis je Tag; ändern im Termin-Dialog.</p>
        </div>
      </div>
      <ul className="kalk-pzl" aria-label="Angebotene Tage">
        {tage.map((t) => (
          <TagZeile key={t.datum} tag={t} />
        ))}
      </ul>
    </>
  );
}
