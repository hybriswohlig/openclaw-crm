"use client";

import "@/styles/neu-akte-kunde.css";

import { useEffect, useId, useRef, useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import type { AdressTeile, DealKunde, KundeEingabe, KundeVorschlag } from "@/lib/deal-kunde";
import { feldLeer, vorschlagEinsetzen, vorschlagHinweis, type KundeEntwurf, type KundeFeld } from "@/lib/kunde-entwurf";
import { apiAufruf, jsonAufruf } from "./api";

/** Browser-Event nach dem Speichern von Kundendaten; `detail` ist die Deal-ID. */
export const KUNDE_GEAENDERT_EVENT = "crm-deal-kunde-geaendert";

const LABEL: Record<KundeFeld, string> = {
  name: "Name",
  telefon: "Telefon",
  email: "E-Mail",
  auszug: "Kundenanschrift (Auszug)",
  einzug: "Einzug",
  datum: "Umzugsdatum",
};

/**
 * Eingabefelder für Kunde und Adressen (Akte und „Es fehlen noch Angaben“).
 * Gesteuert: Werte und Änderungen kommen von außen. Fehlende Pflichtfelder
 * stehen mit „fehlt“, Felder aus dem Chat mit „aus dem Chat, bitte prüfen“.
 */
export function KundeFelder({
  felder,
  entwurf,
  onAendern,
  pflicht = [],
  vorgeschlagen = [],
  labels,
  gesperrt = false,
}: {
  felder: readonly KundeFeld[];
  entwurf: KundeEntwurf;
  onAendern: (e: KundeEntwurf, feld: KundeFeld) => void;
  /** Felder, ohne die das Dokument nicht entsteht. */
  pflicht?: readonly KundeFeld[];
  vorgeschlagen?: readonly KundeFeld[];
  labels?: Partial<Record<KundeFeld, string>>;
  gesperrt?: boolean;
}) {
  const id = useId();
  const marke = (f: KundeFeld) =>
    vorgeschlagen.includes(f) ? (
      <span className="kunde-marke" data-ton="blau">aus dem Chat, bitte prüfen</span>
    ) : pflicht.includes(f) && feldLeer(entwurf, f) ? (
      <span className="kunde-marke" data-ton="rose">fehlt</span>
    ) : null;
  const titel = (f: KundeFeld) => labels?.[f] ?? LABEL[f];

  function adresse(f: "auszug" | "einzug", teil: keyof AdressTeile, wert: string) {
    onAendern({ ...entwurf, [f]: { ...entwurf[f], [teil]: wert } }, f);
  }

  /** Kontaktfelder in einer Reihe, die Adressen nebeneinander darunter. */
  const gruppe = (ist: (f: KundeFeld) => boolean, klasse: string) =>
    felder.some(ist) ? (
      <div className={klasse}>
        {felder.filter(ist).map((f) =>
          f === "auszug" || f === "einzug" ? (
            <div
              key={f}
              role="group"
              aria-labelledby={`${id}-${f}-titel`}
              className="kunde-adresse"
              data-fehlt={pflicht.includes(f) && feldLeer(entwurf, f) ? "" : undefined}
            >
              <span className="kunde-adresse-titel" id={`${id}-${f}-titel`}>
                {titel(f)} {marke(f)}
              </span>
              {f === "einzug" ? (
                <label className="kunde-offen" htmlFor={`${id}-einzug-offen`}>
                  <input
                    id={`${id}-einzug-offen`}
                    type="checkbox"
                    checked={entwurf.einzugOffen}
                    disabled={gesperrt}
                    onChange={(e) => onAendern({ ...entwurf, einzugOffen: e.target.checked }, "einzug")}
                  />
                  Einzug noch offen (im KV steht „wird noch abgestimmt“)
                </label>
              ) : null}
              <label className="akte-dialog-feld kunde-strasse" htmlFor={`${id}-${f}-s`}>
                {f === "einzug" ? "Straße und Hausnummer (wenn bekannt)" : "Straße und Hausnummer"}
                <input
                  id={`${id}-${f}-s`}
                  className="lg-input"
                  value={entwurf[f].strasse}
                  disabled={gesperrt || (f === "einzug" && entwurf.einzugOffen)}
                  onChange={(e) => adresse(f, "strasse", e.target.value)}
                  autoComplete="off"
                  placeholder="z. B. Hauptstraße 5"
                />
              </label>
              <div className="kunde-plz-ort">
                <label className="akte-dialog-feld" htmlFor={`${id}-${f}-p`}>
                  PLZ
                  <input
                    id={`${id}-${f}-p`}
                    className="lg-input"
                    value={entwurf[f].plz}
                    disabled={gesperrt || (f === "einzug" && entwurf.einzugOffen)}
                  onChange={(e) => adresse(f, "plz", e.target.value.replace(/\D/g, "").slice(0, 5))}
                    inputMode="numeric"
                    autoComplete="off"
                    />
                </label>
                <label className="akte-dialog-feld" htmlFor={`${id}-${f}-o`}>
                  Ort
                  <input
                    id={`${id}-${f}-o`}
                    className="lg-input"
                    value={entwurf[f].ort}
                    disabled={gesperrt || (f === "einzug" && entwurf.einzugOffen)}
                  onChange={(e) => adresse(f, "ort", e.target.value)}
                    autoComplete="off"
                    placeholder="z. B. Stuttgart"
                  />
                </label>
              </div>
            </div>
          ) : (
            <label key={f} className="akte-dialog-feld" htmlFor={`${id}-${f}`} data-fehlt={pflicht.includes(f) && feldLeer(entwurf, f) ? "" : undefined}>
              <span className="kunde-feld-kopf">
                {titel(f)} {marke(f)}
              </span>
              <input
                id={`${id}-${f}`}
                className="lg-input"
                type={f === "datum" ? "date" : f === "email" ? "email" : f === "telefon" ? "tel" : "text"}
                value={entwurf[f]}
                disabled={gesperrt}
                onChange={(e) => onAendern({ ...entwurf, [f]: e.target.value }, f)}
                autoComplete="off"
                placeholder={f === "name" ? "Vorname Nachname" : f === "telefon" ? "z. B. 0171 2345678" : f === "email" ? "z. B. name@beispiel.de" : undefined}
              />
            </label>
          )
        )}
      </div>
    ) : null;

  return (
    <div className="kunde-felder">
      {gruppe((f) => f !== "auszug" && f !== "einzug", "kunde-felder-kontakt")}
      {gruppe((f) => f === "auszug" || f === "einzug", "kunde-felder-adressen")}
    </div>
  );
}

/**
 * Knopf „Aus dem Chat übernehmen“: holt Vorschläge (POST …/kunde/vorschlag) und
 * setzt sie in den Entwurf. Gespeichert wird erst mit dem Speichern-Knopf daneben.
 */
export function AusDemChatKnopf({
  dealId,
  entwurf,
  felder,
  disabled = false,
  onVorschlag,
}: {
  dealId: string;
  entwurf: KundeEntwurf;
  felder: readonly KundeFeld[];
  disabled?: boolean;
  onVorschlag: (e: KundeEntwurf, gesetzt: KundeFeld[]) => void;
}) {
  const [laeuft, setLaeuft] = useState(false);
  const [hinweis, setHinweis] = useState<{ text: string; fehler: boolean } | null>(null);
  // Die KI braucht bis zu einer Minute: Vorschläge kommen auf den Entwurf von jetzt, nicht vom Klick,
  // und nie in einen anderen Deal, falls inzwischen gewechselt wurde.
  const stand = useRef({ entwurf, dealId });
  stand.current = { entwurf, dealId };
  useEffect(() => {
    setHinweis(null);
    setLaeuft(false);
  }, [dealId]);

  async function holen() {
    const fuer = dealId;
    setLaeuft(true);
    setHinweis(null);
    const r = await apiAufruf<KundeVorschlag>(`/api/v1/deals/${encodeURIComponent(fuer)}/kunde/vorschlag`, { method: "POST" });
    if (stand.current.dealId !== fuer) return;
    setLaeuft(false);
    if (!r.ok) return setHinweis({ text: r.message, fehler: true });
    const { entwurf: neu, gesetzt } = vorschlagEinsetzen(stand.current.entwurf, r.data, felder);
    onVorschlag(neu, gesetzt);
    setHinweis({ text: vorschlagHinweis(r.data, gesetzt), fehler: false });
  }

  return (
    <div className="kunde-chat">
      <GlassButton type="button" variant="soft" size="sm" onClick={() => void holen()} disabled={disabled || laeuft} aria-busy={laeuft || undefined}>
        {laeuft ? "Liest den Chat …" : "Aus dem Chat übernehmen"}
      </GlassButton>
      {laeuft ? <p className="kunde-chat-hinweis" role="status">Die KI liest die Nachrichten, das dauert meist unter einer Minute.</p> : null}
      {hinweis ? (
        <p className={hinweis.fehler ? "akte-dialog-fehler" : "kunde-chat-hinweis"} role="status">
          {hinweis.text}
        </p>
      ) : null}
    </div>
  );
}

/** Eine Zeile der Ansicht: „Hauptstr. 1, 72218 Wildberg“ oder „fehlt“. */
export function kundeWert(k: DealKunde, f: KundeFeld): string | null {
  if (f === "einzug" && k.einzugOffen) return "noch offen (im KV: wird noch abgestimmt)";
  if (f === "auszug" || f === "einzug") {
    const a = k[f];
    if (!a) return null;
    const ort = [a.plz, a.ort].filter(Boolean).join(" ");
    return [a.strasse, a.zusatz, ort].filter(Boolean).join(", ") || null;
  }
  if (f === "datum") {
    if (!k.datum) return null;
    const [y, m, d] = k.datum.split("-");
    return `${d}.${m}.${y}`;
  }
  return k[f] || null;
}

export interface PersonKandidat {
  personId: string;
  name: string;
}

export type SpeicherErgebnis =
  | { art: "ok"; kunde: DealKunde }
  | { art: "frage"; kandidaten: PersonKandidat[] }
  | { art: "fehler"; text: string };

/** PUT …/kunde; 409 PERSON_GEFUNDEN wird zur Rückfrage „verknüpfen oder neue Person?“. */
export async function kundeSpeichern(dealId: string, body: KundeEingabe): Promise<SpeicherErgebnis> {
  const r = await apiAufruf<DealKunde>(`/api/v1/deals/${encodeURIComponent(dealId)}/kunde`, jsonAufruf("PUT", body));
  if (r.ok) {
    window.dispatchEvent(new CustomEvent(KUNDE_GEAENDERT_EVENT, { detail: dealId }));
    return { art: "ok", kunde: r.data };
  }
  const kandidaten = r.fehler?.kandidaten;
  if (r.code === "PERSON_GEFUNDEN" && Array.isArray(kandidaten) && kandidaten.length > 0) {
    return { art: "frage", kandidaten: kandidaten as PersonKandidat[] };
  }
  return { art: "fehler", text: r.message };
}

/**
 * Rückfrage, wenn Telefon oder E-Mail schon zu einer Person gehören (nie still verknüpfen).
 * „Neue Person anlegen“ ist der erste Knopf; verknüpft wird nur auf ausdrücklichen Klick.
 */
export function PersonFrage({
  kandidaten,
  name,
  disabled,
  onWahl,
}: {
  kandidaten: PersonKandidat[];
  /** Eingetragener Name (oder leer). */
  name: string;
  disabled: boolean;
  onWahl: (w: KundeEingabe["personWahl"]) => void;
}) {
  const erster = kandidaten[0]!;
  return (
    <div className="kunde-frage" role="alertdialog" aria-label="Person schon vorhanden">
      <p>
        Es gibt schon <b>{erster.name}</b> mit dieser Nummer. Verknüpfen oder neue Person anlegen?
      </p>
      <p className="kunde-hinweis">
        Verknüpfen: Der KV lautet dann auf {erster.name}
        {name.trim() && name.trim() !== erster.name ? `, „${name.trim()}“ bleibt als Lead-Name` : ""}.
      </p>
      <div className="akte-dialog-knoepfe">
        <GlassButton type="button" onClick={() => onWahl("neu")} disabled={disabled}>
          {name.trim() ? `Neue Person „${name.trim()}“ anlegen` : "Neue Person anlegen"}
        </GlassButton>
        {kandidaten.map((k) => (
          <GlassButton key={k.personId} type="button" variant="ghost" onClick={() => onWahl({ verknuepfen: k.personId })} disabled={disabled}>
            Mit {k.name} verknüpfen
          </GlassButton>
        ))}
      </div>
    </div>
  );
}
