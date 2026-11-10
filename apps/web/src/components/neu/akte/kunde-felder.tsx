"use client";

import "@/styles/neu-akte-kunde.css";

import { useId, useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import type { AdressTeile, DealKunde, KundeVorschlag } from "@/lib/deal-kunde";
import { feldLeer, vorschlagEinsetzen, vorschlagHinweis, type KundeEntwurf, type KundeFeld } from "@/lib/kunde-entwurf";
import { apiAufruf } from "./api";

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

  return (
    <div className="kunde-felder">
      {felder.map((f) =>
        f === "auszug" || f === "einzug" ? (
          <fieldset key={f} className="kunde-adresse" data-fehlt={pflicht.includes(f) && feldLeer(entwurf, f) ? "" : undefined} disabled={gesperrt}>
            <legend>
              {titel(f)} {marke(f)}
            </legend>
            <label className="akte-dialog-feld kunde-strasse" htmlFor={`${id}-${f}-s`}>
              Straße und Hausnummer
              <input
                id={`${id}-${f}-s`}
                className="lg-input"
                value={entwurf[f].strasse}
                onChange={(e) => adresse(f, "strasse", e.target.value)}
                autoComplete="off"
                placeholder="Hauptstraße 5"
              />
            </label>
            <div className="kunde-plz-ort">
              <label className="akte-dialog-feld" htmlFor={`${id}-${f}-p`}>
                PLZ
                <input
                  id={`${id}-${f}-p`}
                  className="lg-input"
                  value={entwurf[f].plz}
                  onChange={(e) => adresse(f, "plz", e.target.value.replace(/\D/g, "").slice(0, 5))}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="70372"
                />
              </label>
              <label className="akte-dialog-feld" htmlFor={`${id}-${f}-o`}>
                Ort
                <input
                  id={`${id}-${f}-o`}
                  className="lg-input"
                  value={entwurf[f].ort}
                  onChange={(e) => adresse(f, "ort", e.target.value)}
                  autoComplete="off"
                  placeholder="Stuttgart"
                />
              </label>
            </div>
          </fieldset>
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
              placeholder={f === "name" ? "Vorname Nachname" : f === "telefon" ? "0171 2345678" : f === "email" ? "name@beispiel.de" : undefined}
            />
          </label>
        )
      )}
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

  async function holen() {
    setLaeuft(true);
    setHinweis(null);
    const r = await apiAufruf<KundeVorschlag>(`/api/v1/deals/${encodeURIComponent(dealId)}/kunde/vorschlag`, { method: "POST" });
    setLaeuft(false);
    if (!r.ok) return setHinweis({ text: r.message, fehler: true });
    const { entwurf: neu, gesetzt } = vorschlagEinsetzen(entwurf, r.data, felder);
    onVorschlag(neu, gesetzt);
    setHinweis({ text: vorschlagHinweis(r.data, gesetzt), fehler: false });
  }

  return (
    <div className="kunde-chat">
      <GlassButton type="button" variant="ghost" size="sm" onClick={() => void holen()} disabled={disabled || laeuft} aria-busy={laeuft || undefined}>
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
  if (f === "auszug" || f === "einzug") {
    const a = k[f];
    if (!a) return null;
    const ort = [a.plz, a.ort].filter(Boolean).join(" ");
    return [a.strasse, ort].filter(Boolean).join(", ") || null;
  }
  if (f === "datum") {
    if (!k.datum) return null;
    const [y, m, d] = k.datum.split("-");
    return `${d}.${m}.${y}`;
  }
  return k[f] || null;
}
