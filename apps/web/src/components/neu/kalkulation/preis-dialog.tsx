"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import type { PreisModus } from "@/lib/angebot-wahl";
import type { AnpassungAnsicht, KalkulationsAnsicht } from "@/lib/kalkulations-ansicht";
import { euro } from "@/components/neu/akte/format";
import type { KalkKontext, UebersteuerungEingabe } from "./kalk-seite";
import { betragText, modusName, paketpreisPruefen, type PreisArt, type PreisStart } from "./preis-logik";

const ART_LABEL: Record<PreisArt, string> = {
  paketpreis: "Paketpreis",
  preismodus: "Preismodus",
  kv_darstellung: "KV-Darstellung",
};

const MODUS_TEXT: Record<PreisModus, string> = {
  fest: "Ein fester Preis aus der Kostenkette. Pakete und Tagespreise sind möglich.",
  stunden:
    "Abgerechnet nach Aufwand: Helfer und Transporter je Stunde, mit Mindeststunden. Ohne Tagespreise; sperren kann nur ein Mensch.",
};

/** Bestehende wirksame Anpassung zu Art und Schlüssel (für „Zurücknehmen“). */
export function bestehendeAnpassung(anpassungen: AnpassungAnsicht[], art: PreisArt, key: string): AnpassungAnsicht | null {
  return anpassungen.find((a) => (a.art as string) === art && a.key === key) ?? null;
}

/** Schlüssel der Anpassung: Slug beim Paketpreis, sonst fest (Vertrag 5b). */
export function preisSchluessel(art: PreisArt, slug: string): string {
  return art === "paketpreis" ? slug : art === "preismodus" ? "modus" : "kv";
}

/**
 * Preis-Dialog (Plan 5b, Task U1; Muster Anpassungs-Dialog aus Plan 4):
 * Paketpreis mit Untergrenze bei 30 % Marge (vorab geprüft, endgültig im
 * Dienst), Preismodus Festpreis oder Stunden-KV, KV-Darstellung „ein Posten“
 * oder „Posten einzeln“. Immer mit Pflichtgrund; an einer gesperrten Version
 * landet die Änderung im Entwurf. Bestehende Anpassung: „Zurücknehmen“.
 */
export function PreisDialog({
  start,
  ansicht,
  kontext,
  portalZiel,
  onSchliessen,
}: {
  start: PreisStart;
  ansicht: Pick<KalkulationsAnsicht, "pakete" | "anpassungen" | "kvDarstellung"> & { version: Pick<KalkulationsAnsicht["version"], "preisModus"> };
  kontext: KalkKontext;
  portalZiel: HTMLElement | undefined;
  onSchliessen: () => void;
}) {
  const id = useId();
  const { pakete, anpassungen } = ansicht;
  const [art, setArt] = useState<PreisArt>(start.art);
  const [slug, setSlug] = useState(() => (start.art === "paketpreis" && start.slug ? start.slug : (pakete[0]?.slug ?? "")));
  const [betrag, setBetrag] = useState(() => (start.art === "paketpreis" ? betragText(start.betrag) : ""));
  const [modus, setModus] = useState<PreisModus>(() =>
    start.art === "preismodus" && start.modus ? start.modus : ansicht.version.preisModus === "stunden" ? "fest" : "stunden"
  );
  const [darstellung, setDarstellung] = useState<"ein_posten" | "posten">(() =>
    start.art === "kv_darstellung" && start.wert ? start.wert : ansicht.kvDarstellung === "ein_posten" ? "posten" : "ein_posten"
  );
  const [grund, setGrund] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [speichert, setSpeichert] = useState(false);
  const beschaeftigt = speichert || kontext.laeuft !== null;

  const paket = pakete.find((p) => p.slug === slug) ?? null;
  const key = preisSchluessel(art, slug);
  const bestehende = bestehendeAnpassung(anpassungen, art, key);
  const pruefung = art === "paketpreis" && betrag.trim() !== "" ? paketpreisPruefen(betrag, paket) : null;

  function wert(): { ok: true; wert: unknown } | { ok: false; meldung: string } {
    switch (art) {
      case "paketpreis":
        return paketpreisPruefen(betrag, paket);
      case "preismodus":
        if (modus === ansicht.version.preisModus && !bestehende) return { ok: false, meldung: `Die Version ist schon ${modusName(modus)}.` };
        return { ok: true, wert: modus };
      case "kv_darstellung":
        if (darstellung === ansicht.kvDarstellung && !bestehende) return { ok: false, meldung: "So zeigt der KV die Posten schon." };
        return { ok: true, wert: darstellung };
    }
  }

  async function senden(eingabe: UebersteuerungEingabe, erfolg: string) {
    setFehler(null);
    setSpeichert(true);
    const r = await kontext.uebersteuern([eingabe]);
    setSpeichert(false);
    if (!r.ok) return setFehler(r.message);
    toast.success(erfolg);
    onSchliessen();
  }

  async function speichern(e: React.FormEvent) {
    e.preventDefault();
    if (grund.trim() === "") return setFehler("Bitte einen Grund angeben.");
    const w = wert();
    if (!w.ok) return setFehler(w.meldung);
    await senden({ art, key, wert: w.wert, grund: grund.trim() }, "Anpassung gespeichert.");
  }

  async function zuruecknehmen() {
    if (!bestehende) return;
    await senden({ art, key, wert: null, grund: grund.trim() || "Anpassung zurückgenommen" }, "Anpassung zurückgenommen.");
  }

  const arten = (Object.keys(ART_LABEL) as PreisArt[]).filter((a) => a !== "paketpreis" || pakete.length > 0);

  return (
    <GlassDialog open onOpenChange={(offen) => !offen && !beschaeftigt && onSchliessen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen">
        <GlassDialogTitle className="akte-dialog-titel">{ART_LABEL[art]} anpassen</GlassDialogTitle>
        <GlassDialogDescription className="akte-dialog-text">
          Die Anpassung gilt für diese Version, bleibt gold markiert und trägt Name, Zeit und Grund.
        </GlassDialogDescription>
        {!kontext.bearbeitbar ? <p className="kalk-dialog-hinweis">Die Änderung legt einen neuen Entwurf an.</p> : null}

        <div className="kalk-arten" role="group" aria-label="Art der Anpassung">
          {arten.map((a) => (
            <button key={a} type="button" className="kalk-art" aria-pressed={art === a} disabled={beschaeftigt} onClick={() => { setArt(a); setFehler(null); }}>
              {ART_LABEL[a]}
            </button>
          ))}
        </div>

        <form onSubmit={(e) => void speichern(e)}>
          {art === "paketpreis" ? (
            <>
              <label className="akte-dialog-feld kalk-dialog-feld" htmlFor={`${id}-paket`}>
                Paket
                <select id={`${id}-paket`} className="lg-input" value={slug} onChange={(e) => setSlug(e.target.value)}>
                  {pakete.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              {paket ? (
                <dl className="kalk-preisdialog-zahlen">
                  <div>
                    <dt>Rechner</dt>
                    <dd>{paket.rechnerPreisCent != null ? euro(paket.rechnerPreisCent) : "kein Preis"}</dd>
                  </div>
                  <div>
                    <dt>Untergrenze bei 30 % Marge</dt>
                    <dd>{paket.untergrenzeCent != null ? euro(paket.untergrenzeCent) : "prüft der Server"}</dd>
                  </div>
                </dl>
              ) : null}
              <label className="akte-dialog-feld" htmlFor={`${id}-betrag`}>
                Neuer Paketpreis in Euro
                <input
                  id={`${id}-betrag`}
                  className="lg-input"
                  type="text"
                  inputMode="decimal"
                  value={betrag}
                  onChange={(e) => setBetrag(e.target.value)}
                  placeholder={paket?.preisCent != null ? String(paket.preisCent / 100) : "0"}
                  autoComplete="off"
                  aria-invalid={pruefung && !pruefung.ok ? true : undefined}
                />
              </label>
              {pruefung && !pruefung.ok ? <p className="kalk-preisdialog-warn">{pruefung.meldung}</p> : null}
            </>
          ) : null}

          {art === "preismodus" ? (
            <>
              <div className="kalk-arten" role="radiogroup" aria-label="Preismodus">
                {(["fest", "stunden"] as const).map((m) => (
                  <button key={m} type="button" role="radio" className="kalk-art" aria-checked={modus === m} aria-pressed={modus === m} disabled={beschaeftigt} onClick={() => setModus(m)}>
                    {modusName(m)}
                  </button>
                ))}
              </div>
              <p className="kalk-dialog-aktuell">{MODUS_TEXT[modus]}</p>
              <p className="kalk-dialog-aktuell">Jetzt: {modusName(ansicht.version.preisModus)}. Der Rechner rechnet die Version danach neu.</p>
            </>
          ) : null}

          {art === "kv_darstellung" ? (
            <>
              <div className="kalk-arten" role="radiogroup" aria-label="KV-Darstellung">
                {(["ein_posten", "posten"] as const).map((d) => (
                  <button key={d} type="button" role="radio" className="kalk-art" aria-checked={darstellung === d} aria-pressed={darstellung === d} disabled={beschaeftigt} onClick={() => setDarstellung(d)}>
                    {d === "ein_posten" ? "Als ein Posten" : "Posten einzeln"}
                  </button>
                ))}
              </div>
              <p className="kalk-dialog-aktuell">
                {darstellung === "ein_posten"
                  ? "Der KV zeigt einen Posten mit dem Sammeltext. Nur, wenn die einzelnen Posten den Kunden mehr verwirren als helfen."
                  : "Der KV zeigt den Kern und jeden Hebel als eigenen Posten (Standard)."}
              </p>
            </>
          ) : null}

          <label className="akte-dialog-feld" htmlFor={`${id}-grund`}>
            Grund (Pflicht)
            <textarea
              id={`${id}-grund`}
              className="lg-input lg-textarea"
              rows={2}
              value={grund}
              onChange={(e) => setGrund(e.target.value)}
              placeholder={art === "paketpreis" ? "Warum weicht der Paketpreis vom Rechner ab?" : "Warum diese Änderung?"}
            />
          </label>
          {bestehende ? (
            <p className="kalk-dialog-aktuell">
              Bestehende Anpassung: {bestehende.text} · {bestehende.von} · {bestehende.am}
            </p>
          ) : null}
          {fehler ? <p className="akte-dialog-fehler">{fehler}</p> : null}
          <div className="akte-dialog-knoepfe">
            {bestehende ? (
              <GlassButton type="button" variant="ghost" className="kalk-dialog-zuruecknehmen" onClick={() => void zuruecknehmen()} disabled={beschaeftigt}>
                Zurücknehmen
              </GlassButton>
            ) : null}
            <GlassButton type="button" variant="ghost" onClick={onSchliessen} disabled={beschaeftigt}>
              Abbrechen
            </GlassButton>
            <GlassButton type="submit" disabled={beschaeftigt}>
              {speichert ? "Speichert" : "Speichern"}
            </GlassButton>
          </div>
        </form>
      </GlassDialogContent>
    </GlassDialog>
  );
}

/**
 * Rückfrage vor dem Sperren (Entscheidung 5b-5): die Quotation ist ein
 * Stunden-KV und würde ein Festpreis. Der Text kommt vom Dienst; erst nach
 * „Ja“ sperrt die Seite mit `modusWechselBestaetigt`.
 */
export function ModuswechselDialog({
  meldung,
  laeuft,
  portalZiel,
  onAbbrechen,
  onBestaetigen,
}: {
  meldung: string;
  laeuft: boolean;
  portalZiel: HTMLElement | undefined;
  onAbbrechen: () => void;
  onBestaetigen: () => void;
}) {
  return (
    <GlassDialog open onOpenChange={(offen) => !offen && !laeuft && onAbbrechen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen">
        <GlassDialogTitle className="akte-dialog-titel">Stunden-KV wird Festpreis</GlassDialogTitle>
        <GlassDialogDescription className="akte-dialog-text">{meldung}</GlassDialogDescription>
        <p className="kalk-dialog-aktuell">Der Kunde sieht danach einen festen Preis statt der Abrechnung nach Aufwand.</p>
        <div className="akte-dialog-knoepfe">
          <GlassButton type="button" variant="ghost" onClick={onAbbrechen} disabled={laeuft}>
            Abbrechen
          </GlassButton>
          <GlassButton type="button" onClick={onBestaetigen} disabled={laeuft}>
            {laeuft ? "Sperrt …" : "Ja, als Festpreis sperren"}
          </GlassButton>
        </div>
      </GlassDialogContent>
    </GlassDialog>
  );
}
