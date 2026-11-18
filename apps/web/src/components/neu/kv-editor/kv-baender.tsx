"use client";

import Link from "next/link";
import { KvDanachKnoepfe } from "@/components/neu/kv-danach/kv-danach-knoepfe";
import {
  KV_HINWEIS_KEIN_KV,
  KV_HINWEIS_QUELLE_OHNE_STAND,
  KV_HINWEIS_REKONSTRUIERT,
  type KvEditorAnsicht,
  type KvFeld,
  type KvStandKopf,
} from "@/lib/kv-editor";
import { konfliktText, offeneKonflikte, schluesselTitel } from "./kv-editor-logik";
import { wertText } from "./kv-formular-logik";

/**
 * Hinweise oben im Editor (Spec 7.4): Ausgangs-KV rekonstruiert, aktueller KV nicht aus dem
 * Editor (mit „Änderungen aus Stand N übertragen“). „Kein KV“ zeigt die Seite selbst.
 */
export function KvHinweis({
  ansicht,
  beschaeftigt,
  onUebertragen,
}: {
  ansicht: KvEditorAnsicht;
  beschaeftigt: boolean;
  onUebertragen: (standId: string) => void;
}) {
  if (ansicht.hinweis === "rekonstruiert") {
    return (
      <p className="kve-band" data-ton="blau" role="status">
        <span>{KV_HINWEIS_REKONSTRUIERT}</span>
      </p>
    );
  }
  if (ansicht.hinweis === "quelle_ohne_stand") {
    const quelle = ansicht.staende.find((s) => s.aenderungen.length > 0) ?? ansicht.staende[0] ?? null;
    return (
      <p className="kve-band" data-ton="gold" role="status">
        <span>{KV_HINWEIS_QUELLE_OHNE_STAND}</span>
        {quelle ? (
          <button type="button" className="kve-klein-knopf" disabled={beschaeftigt} onClick={() => onUebertragen(quelle.id)}>
            Änderungen aus Stand {quelle.nummer} übertragen
          </button>
        ) : null}
      </p>
    );
  }
  return null;
}

/** Ganze Seite ohne KV: Hinweis mit Link zur Kalkulation. */
export function KvKeinKv({ kalkulationUrl }: { kalkulationUrl: string }) {
  return (
    <div className="kve-leer" role="status">
      <h1>KV</h1>
      <p>{KV_HINWEIS_KEIN_KV}</p>
      <Link className="kve-knopf" href={kalkulationUrl}>
        Zur Kalkulation
      </Link>
    </div>
  );
}

/** Band „Kalkulation neuer“ (409 `KALKULATION_NEU`) mit „Auf den neuen KV übertragen“. */
export function KvKalkulationNeu({
  text,
  beschaeftigt,
  onUebertragen,
}: {
  text: string;
  beschaeftigt: boolean;
  onUebertragen: () => void;
}) {
  return (
    <p className="kve-band" data-ton="gold" role="alert">
      <span>{text}</span>
      <button type="button" className="kve-klein-knopf" disabled={beschaeftigt} onClick={onUebertragen}>
        Auf den neuen KV übertragen
      </button>
    </p>
  );
}

/**
 * Gelber Streifen bei offenen Konflikten (Spec 7.6 Schritt 5): je Änderung, die nicht mehr
 * passt, „übernehmen“ nur bei `basis_geaendert` (legt einen Entwurf an), sonst nur „verwerfen“.
 */
export function KvKonflikte({
  stand,
  felder,
  firma,
  beschaeftigt,
  onEntscheiden,
}: {
  stand: KvStandKopf;
  felder: readonly KvFeld[];
  firma: string | null;
  beschaeftigt: boolean;
  onEntscheiden: (schluessel: string, aktion: "uebernehmen" | "verwerfen") => void;
}) {
  const offen = offeneKonflikte(stand);
  if (offen.length === 0) return null;
  return (
    <section className="kve-band kve-konflikte" data-ton="gold" aria-label="Offene Änderungen">
      <span>
        <b>{offen.length === 1 ? "1 Änderung passt nicht mehr" : `${offen.length} Änderungen passen nicht mehr`}</b> zum neuen KV aus Kalkulation v{stand.kalkulationVersion ?? "?"}. Bitte
        entscheiden.
      </span>
      <ul>
        {offen.map((k) => {
          const f = felder.find((x) => x.schluessel === k.aenderung.schluessel) ?? null;
          return (
            <li key={k.aenderung.schluessel}>
              <span className="kve-konflikt-text">
                <b>{schluesselTitel(k.aenderung.schluessel, felder, stand.renderer)}</b>
                <span>{konfliktText(k)}</span>
                <span className="kve-klein">
                  Deine Änderung: {wertText(k.aenderung.wert, f?.art ?? null, firma)}
                  {k.basisJetzt !== null ? ` · Im neuen KV: ${wertText(k.basisJetzt, f?.art ?? null, firma)}` : ""}
                </span>
              </span>
              <span className="kve-konflikt-knoepfe">
                {k.art === "basis_geaendert" ? (
                  <button type="button" className="kve-klein-knopf" disabled={beschaeftigt} onClick={() => onEntscheiden(k.aenderung.schluessel, "uebernehmen")}>
                    übernehmen
                  </button>
                ) : null}
                <button type="button" className="kve-klein-knopf" disabled={beschaeftigt} onClick={() => onEntscheiden(k.aenderung.schluessel, "verwerfen")}>
                  verwerfen
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Meldung nach dem Push (Spec 7.5, 10). 6b: `KvDanachKnoepfe` bekommt nach Aufgabe 7
 * zusätzlich `art: "angepasst"` und `neuAnnehmen` (= `annahmeAufgehoben`).
 */
export function KvGepusht({
  dealId,
  nummer,
  annahmeAufgehoben,
  onSchliessen,
}: {
  dealId: string;
  nummer: number;
  annahmeAufgehoben: boolean;
  onSchliessen: () => void;
}) {
  return (
    <section className="kve-band kve-gepusht" data-ton="jade" role="status" aria-label="Gepusht">
      <span>
        <b>Stand {nummer} ist jetzt der aktuelle KV.</b> Portal, Statuslink und Akte zeigen ihn.
        {annahmeAufgehoben ? " Die Annahme ist aufgehoben; der Kunde nimmt den neuen KV neu an." : ""} Nachricht an den Kunden geht erst, wenn du sie im Chat sendest.
      </span>
      <KvDanachKnoepfe dealId={dealId} klasse="kve-klein-knopf" gruppeKlasse="kve-danach" />
      <button type="button" className="kve-link" onClick={onSchliessen}>
        Ausblenden
      </button>
    </section>
  );
}
