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
import { GlassSwitch } from "@/components/glassyui/glass-switch";
import type { AnpassungAnsicht, GrundlageFeld } from "@/lib/kalkulations-ansicht";
import type { UebersteuerungsArt } from "@/lib/kalkulation-versionen";
import type { AnpassungStart } from "./anpassung-start";
import { textAus } from "./eingabe-felder";
import type { KalkKontext, UebersteuerungEingabe } from "./kalk-seite";

export type { AnpassungStart } from "./anpassung-start";

/** Zahl als Formulartext („18,5“), leer ohne Wert. */
const zahlText = (n: number | undefined): string => (n === undefined ? "" : String(n).replace(".", ","));

/** Vorbelegung des Eingabe-Felds: der Wert der bestehenden Anpassung, sonst der aktuelle Wert der Grundlage (M6). */
function feldVorbelegung(feld: GrundlageFeld | null, wert: number | string | boolean | undefined): { text: string; schalter: boolean } {
  if (wert !== undefined) {
    return { text: typeof wert === "boolean" ? "" : typeof wert === "number" ? zahlText(wert) : wert, schalter: wert === true };
  }
  if (!feld) return { text: "", schalter: false };
  return { text: feld.typ === "ja_nein" ? "" : textAus(feld), schalter: feld.wert === true };
}

/** Auswahl im Dialog; Satz Arbeit und Satz Fahrt sind zwei Knöpfe derselben Art. */
type Wahl = "zeile" | "satz_arbeit" | "satz_fahrt" | "zeitposten" | "material_frei" | "eingabe" | "marge";

const WAHL_LABEL: Record<Wahl, string> = {
  zeile: "Kostenzeile",
  satz_arbeit: "Satz Arbeit",
  satz_fahrt: "Satz Fahrt",
  zeitposten: "Zeitposten",
  material_frei: "Material",
  eingabe: "Eingabe",
  marge: "Marge",
};

const AUFZUG = [
  { wert: "keiner", label: "kein Aufzug" },
  { wert: "klein", label: "kleiner Aufzug" },
  { wert: "gross", label: "großer Aufzug" },
] as const;

/** Schlüssel eines freien Postens aus der Bezeichnung („frei.wandschrank-abbau“). */
export function freierSchluessel(bezeichnung: string): string {
  const slug = bezeichnung
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `frei.${slug || "posten"}`;
}

function wahlAus(start: AnpassungStart): Wahl {
  if (start.art === "wahl") return "zeile";
  if (start.art === "satz") return start.key === "arbeit" ? "satz_arbeit" : "satz_fahrt";
  return start.art;
}

function zahlAus(text: string): number | null {
  const n = Number(text.trim().replace(",", "."));
  return text.trim() === "" || !Number.isFinite(n) ? null : n;
}

/**
 * Anpassungs-Dialog (Entscheidung 13): Art wählbar (Kostenzeile, Satz
 * Arbeit/Fahrt, Zeitposten, Material, Eingabe), Wert, Pflichtgrund. Besteht
 * zu Art und Schlüssel schon eine Anpassung, gibt es „Zurücknehmen“
 * (`wert: null`). An einer gesperrten Version landet alles im Entwurf.
 */
export function AnpassungDialog({
  start,
  zeilen,
  felder,
  anpassungen,
  kontext,
  portalZiel,
  onSchliessen,
}: {
  start: AnpassungStart;
  /** Übersteuerbare Kostenzeilen (Schlüssel des Rechners) mit Anzeigename. */
  zeilen: { key: string; label: string }[];
  /** Alle Felder der Grundlage für die Art „Eingabe“. */
  felder: GrundlageFeld[];
  anpassungen: AnpassungAnsicht[];
  kontext: KalkKontext;
  portalZiel: HTMLElement | undefined;
  onSchliessen: () => void;
}) {
  const id = useId();
  const [wahl, setWahl] = useState<Wahl>(() => wahlAus(start));
  const [zeileKey, setZeileKey] = useState(() => (start.art === "zeile" ? start.key : (zeilen[0]?.key ?? "")));
  const [betrag, setBetrag] = useState(() => (start.art === "zeile" ? zahlText(start.betrag) : ""));
  const [satz, setSatz] = useState(() => (start.art === "satz" ? zahlText(start.satz) : ""));
  const [bezeichnung, setBezeichnung] = useState(() => ("bezeichnung" in start ? (start.bezeichnung ?? "") : ""));
  const [minuten, setMinuten] = useState(() => (start.art === "zeitposten" && start.minuten ? String(start.minuten) : ""));
  const [materialBetrag, setMaterialBetrag] = useState(() => (start.art === "material_frei" ? zahlText(start.betrag) : ""));
  const startFeldKey = start.art === "eingabe" && start.key ? start.key : (felder[0]?.key ?? "");
  const [feldKey, setFeldKey] = useState(startFeldKey);
  const [feldText, setFeldText] = useState(
    () => feldVorbelegung(felder.find((f) => f.key === startFeldKey) ?? null, start.art === "eingabe" ? start.wert : undefined).text
  );
  const [feldSchalter, setFeldSchalter] = useState(
    () => feldVorbelegung(felder.find((f) => f.key === startFeldKey) ?? null, start.art === "eingabe" ? start.wert : undefined).schalter
  );
  const [margeText, setMargeText] = useState(() => (start.art === "marge" ? zahlText(start.prozent) : ""));
  const [grund, setGrund] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [speichert, setSpeichert] = useState(false);
  const beschaeftigt = speichert || kontext.laeuft !== null;

  const art: UebersteuerungsArt = wahl === "satz_arbeit" || wahl === "satz_fahrt" ? "satz" : wahl;
  const feld = felder.find((f) => f.key === feldKey) ?? null;
  const festerKey = "key" in start && start.key && start.art === wahl ? start.key : null;

  /** Schlüssel, den die Übersteuerung bekommt (bei freien Posten aus der Bezeichnung). */
  function schluessel(): string {
    switch (wahl) {
      case "zeile":
        return zeileKey;
      case "satz_arbeit":
        return "arbeit";
      case "satz_fahrt":
        return "fahrt";
      case "zeitposten":
      case "material_frei":
        return festerKey ?? freierSchluessel(bezeichnung);
      case "eingabe":
        return feldKey;
      case "marge":
        return "marge";
    }
  }
  const bestehende = anpassungen.find((a) => a.art === art && a.key === schluessel()) ?? null;

  function wert(): { ok: true; wert: unknown } | { ok: false; meldung: string } {
    switch (wahl) {
      case "zeile": {
        if (zeileKey === "") return { ok: false, meldung: "Bitte eine Kostenzeile wählen." };
        const n = zahlAus(betrag);
        if (n === null || n < 0) return { ok: false, meldung: "Bitte einen Betrag in Euro eingeben (ab 0)." };
        return { ok: true, wert: n };
      }
      case "satz_arbeit":
      case "satz_fahrt": {
        const n = zahlAus(satz);
        if (n === null || n <= 0) return { ok: false, meldung: "Bitte einen Satz in Euro je Stunde eingeben (größer 0)." };
        return { ok: true, wert: n };
      }
      case "zeitposten": {
        const b = bezeichnung.trim();
        if (b.length < 1 || b.length > 80) return { ok: false, meldung: "Bezeichnung: 1 bis 80 Zeichen." };
        const n = zahlAus(minuten);
        if (n === null || !Number.isInteger(n) || n < 1 || n > 600) return { ok: false, meldung: "Zeit: ganze Minuten von 1 bis 600." };
        return { ok: true, wert: { bezeichnung: b, minuten: n } };
      }
      case "material_frei": {
        const b = bezeichnung.trim();
        if (b.length < 1 || b.length > 80) return { ok: false, meldung: "Bezeichnung: 1 bis 80 Zeichen." };
        const n = zahlAus(materialBetrag);
        if (n === null || n < 0) return { ok: false, meldung: "Betrag: Euro ab 0." };
        return { ok: true, wert: { bezeichnung: b, betrag: n } };
      }
      case "eingabe": {
        if (!feld) return { ok: false, meldung: "Bitte ein Feld wählen." };
        if (feld.typ === "ja_nein") return { ok: true, wert: feldSchalter };
        if (feld.typ === "aufzug") return { ok: true, wert: feldText || "keiner" };
        if (feld.typ === "datum") {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(feldText)) return { ok: false, meldung: `${feld.label}: bitte ein Datum wählen.` };
          return { ok: true, wert: feldText };
        }
        const n = zahlAus(feldText);
        if (n === null || (feld.typ === "ganzzahl" && !Number.isInteger(n))) {
          return { ok: false, meldung: `${feld.label}: bitte eine ${feld.typ === "ganzzahl" ? "ganze " : ""}Zahl eingeben.` };
        }
        return { ok: true, wert: n };
      }
      case "marge": {
        const n = zahlAus(margeText);
        if (n === null || n < 30 || n > 60) return { ok: false, meldung: "Marge zwischen 30 und 60 %." };
        return { ok: true, wert: n };
      }
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
    await senden({ art, key: schluessel(), wert: w.wert, grund: grund.trim() }, "Anpassung gespeichert.");
  }

  async function zuruecknehmen() {
    if (!bestehende) return;
    const g = grund.trim() || "Anpassung zurückgenommen";
    await senden({ art, key: bestehende.key, wert: null, grund: g }, "Anpassung zurückgenommen.");
  }

  const titel = start.art === "zeile" ? `${start.label} anpassen` : start.art === "wahl" ? "Anpassung" : `${WAHL_LABEL[wahl]} anpassen`;

  return (
    <GlassDialog open onOpenChange={(offen) => !offen && !beschaeftigt && onSchliessen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen">
        <GlassDialogTitle className="akte-dialog-titel">{titel}</GlassDialogTitle>
        <GlassDialogDescription className="akte-dialog-text">
          Der Rechner rechnet mit dem neuen Wert neu. Die Anpassung bleibt gold markiert und fließt in die Kalibrierung des Rechners.
        </GlassDialogDescription>
        {!kontext.bearbeitbar ? <p className="kalk-dialog-hinweis">Die Änderung legt einen neuen Entwurf an.</p> : null}

        {start.art === "wahl" || start.art === "zeile" ? (
          <div className="kalk-arten" role="group" aria-label="Art der Anpassung">
            {(Object.keys(WAHL_LABEL) as Wahl[]).map((w) => (
              <button key={w} type="button" className="kalk-art" aria-pressed={wahl === w} disabled={beschaeftigt} onClick={() => setWahl(w)}>
                {WAHL_LABEL[w]}
              </button>
            ))}
          </div>
        ) : null}

        <form onSubmit={(e) => void speichern(e)}>
          {wahl === "zeile" ? (
            <>
              {start.art === "zeile" && start.aktuell ? <p className="kalk-dialog-aktuell">Rechner: {start.aktuell}</p> : null}
              <label className="akte-dialog-feld kalk-dialog-feld" htmlFor={`${id}-zeile`}>
                Kostenzeile
                <select id={`${id}-zeile`} className="lg-input" value={zeileKey} onChange={(e) => setZeileKey(e.target.value)}>
                  {zeilen.map((z) => (
                    <option key={z.key} value={z.key}>
                      {z.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="akte-dialog-feld" htmlFor={`${id}-betrag`}>
                Neuer Betrag in Euro
                <input id={`${id}-betrag`} className="lg-input" type="text" inputMode="decimal" value={betrag} onChange={(e) => setBetrag(e.target.value)} placeholder="0,00" autoComplete="off" />
              </label>
            </>
          ) : null}

          {wahl === "satz_arbeit" || wahl === "satz_fahrt" ? (
            <label className="akte-dialog-feld" htmlFor={`${id}-satz`}>
              {wahl === "satz_arbeit" ? "Arbeitssatz in Euro je Stunde" : "Fahrtsatz in Euro je Stunde"}
              <input id={`${id}-satz`} className="lg-input" type="text" inputMode="decimal" value={satz} onChange={(e) => setSatz(e.target.value)} placeholder={wahl === "satz_arbeit" ? "20,00" : "15,00"} autoComplete="off" />
            </label>
          ) : null}

          {wahl === "zeitposten" || wahl === "material_frei" ? (
            <div className="akte-dialog-zeile">
              <label className="akte-dialog-feld" htmlFor={`${id}-bez`}>
                Bezeichnung
                <input id={`${id}-bez`} className="lg-input" type="text" value={bezeichnung} onChange={(e) => setBezeichnung(e.target.value)} maxLength={80} placeholder={wahl === "zeitposten" ? "Klavier, 2. OG" : "Spezialkarton Kleider"} autoComplete="off" />
              </label>
              {wahl === "zeitposten" ? (
                <label className="akte-dialog-feld" htmlFor={`${id}-min`}>
                  Zeit in Minuten
                  <input id={`${id}-min`} className="lg-input" type="text" inputMode="numeric" value={minuten} onChange={(e) => setMinuten(e.target.value)} placeholder="60" autoComplete="off" />
                </label>
              ) : (
                <label className="akte-dialog-feld" htmlFor={`${id}-mat`}>
                  Betrag in Euro
                  <input id={`${id}-mat`} className="lg-input" type="text" inputMode="decimal" value={materialBetrag} onChange={(e) => setMaterialBetrag(e.target.value)} placeholder="0,00" autoComplete="off" />
                </label>
              )}
            </div>
          ) : null}

          {wahl === "marge" ? (
            <label className="akte-dialog-feld" htmlFor={`${id}-marge`}>
              Marge in Prozent (30 bis 60)
              <input id={`${id}-marge`} className="lg-input" type="text" inputMode="numeric" value={margeText} onChange={(e) => setMargeText(e.target.value)} placeholder="38" autoComplete="off" />
            </label>
          ) : null}

          {wahl === "eingabe" ? (
            <>
              <label className="akte-dialog-feld kalk-dialog-feld" htmlFor={`${id}-feld`}>
                Feld
                <select
                  id={`${id}-feld`}
                  className="lg-input"
                  value={feldKey}
                  onChange={(e) => {
                    // Beim Feldwechsel den aktuellen Wert der Grundlage vorbelegen (M6).
                    const v = feldVorbelegung(felder.find((f) => f.key === e.target.value) ?? null, undefined);
                    setFeldKey(e.target.value);
                    setFeldText(v.text);
                    setFeldSchalter(v.schalter);
                  }}
                >
                  {felder.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
              {feld?.typ === "ja_nein" ? (
                <label className="kalk-dialog-schalter">
                  <span>{feld.label}</span>
                  <GlassSwitch size="sm" checked={feldSchalter} onCheckedChange={setFeldSchalter} />
                </label>
              ) : feld?.typ === "aufzug" ? (
                <label className="akte-dialog-feld kalk-dialog-feld" htmlFor={`${id}-wert`}>
                  Neuer Wert
                  <select id={`${id}-wert`} className="lg-input" value={feldText || "keiner"} onChange={(e) => setFeldText(e.target.value)}>
                    {AUFZUG.map((a) => (
                      <option key={a.wert} value={a.wert}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : feld ? (
                <label className="akte-dialog-feld" htmlFor={`${id}-wert`}>
                  Neuer Wert
                  <input id={`${id}-wert`} className="lg-input" type={feld.typ === "datum" ? "date" : "text"} inputMode={feld.typ === "datum" ? undefined : "decimal"} value={feldText} onChange={(e) => setFeldText(e.target.value)} autoComplete="off" />
                </label>
              ) : null}
            </>
          ) : null}

          <label className="akte-dialog-feld" htmlFor={`${id}-grund`}>
            Grund (Pflicht)
            <textarea id={`${id}-grund`} className="lg-input lg-textarea" rows={2} value={grund} onChange={(e) => setGrund(e.target.value)} placeholder="Warum weicht der Wert vom Rechner ab?" />
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
