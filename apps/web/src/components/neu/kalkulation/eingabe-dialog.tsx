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
import type { GrundlageAnsichtZeile, GrundlageFeld } from "@/lib/kalkulations-ansicht";
import type { KalkKontext, UebersteuerungEingabe } from "./kalk-seite";

const AUFZUG = [
  { wert: "keiner", label: "kein Aufzug" },
  { wert: "klein", label: "kleiner Aufzug" },
  { wert: "gross", label: "großer Aufzug" },
] as const;

/** Anzeigewert eines Felds als Text fürs Formular. */
function textAus(f: GrundlageFeld): string {
  const w = f.wert;
  if (w === null || w === undefined) return f.typ === "aufzug" ? "keiner" : "";
  if (typeof w === "number") return String(w).replace(".", ",");
  if (typeof w === "boolean") return w ? "ja" : "nein";
  return String(w);
}

/** Formularwert → Übersteuerungswert; null = ungültig (Meldung). */
function wertAus(f: GrundlageFeld, text: string, schalter: boolean): { ok: true; wert: unknown } | { ok: false; meldung: string } {
  switch (f.typ) {
    case "ja_nein":
      return { ok: true, wert: schalter };
    case "aufzug":
      return { ok: true, wert: text };
    case "datum":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { ok: false, meldung: `${f.label}: bitte ein Datum wählen.` };
      return { ok: true, wert: text };
    case "ganzzahl": {
      const n = Number(text.trim().replace(",", "."));
      if (text.trim() === "" || !Number.isInteger(n)) return { ok: false, meldung: `${f.label}: bitte eine ganze Zahl eingeben.` };
      return { ok: true, wert: n };
    }
    case "zahl": {
      const n = Number(text.trim().replace(",", "."));
      if (text.trim() === "" || !Number.isFinite(n)) return { ok: false, meldung: `${f.label}: bitte eine Zahl eingeben.` };
      return { ok: true, wert: n };
    }
  }
}

/** Gleicher Wert wie vorher? (Zahlen als Zahl, Rest als Text.) */
function unveraendert(f: GrundlageFeld, neu: unknown): boolean {
  const alt = f.wert;
  if (typeof neu === "number") return typeof alt === "number" ? alt === neu : alt === null && Number.isNaN(neu);
  if (typeof neu === "boolean") return (alt ?? false) === neu;
  return (alt ?? (f.typ === "aufzug" ? "keiner" : "")) === neu;
}

/**
 * Eingabe-Dialog einer Grundlage-Zeile: alle `felder` der Zeile, ein
 * Pflichtgrund; je geändertem Feld eine Übersteuerung `art: "eingabe"`.
 * An einer gesperrten Version steht der Hinweis, dass die Änderung einen
 * neuen Entwurf anlegt (Review Focus 2).
 */
export function EingabeDialog({
  zeile,
  kontext,
  portalZiel,
  onSchliessen,
}: {
  zeile: GrundlageAnsichtZeile;
  kontext: KalkKontext;
  portalZiel: HTMLElement | undefined;
  onSchliessen: () => void;
}) {
  const id = useId();
  const [texte, setTexte] = useState<Record<string, string>>(() => Object.fromEntries(zeile.felder.map((f) => [f.key, textAus(f)])));
  const [schalter, setSchalter] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(zeile.felder.map((f) => [f.key, f.wert === true]))
  );
  const [grund, setGrund] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [speichert, setSpeichert] = useState(false);
  const beschaeftigt = speichert || kontext.laeuft !== null;

  async function speichern(e: React.FormEvent) {
    e.preventDefault();
    if (grund.trim() === "") return setFehler("Bitte einen Grund angeben.");
    const liste: UebersteuerungEingabe[] = [];
    for (const f of zeile.felder) {
      const r = wertAus(f, texte[f.key] ?? "", schalter[f.key] ?? false);
      if (!r.ok) return setFehler(r.meldung);
      if (unveraendert(f, r.wert)) continue;
      liste.push({ art: "eingabe", key: f.key, wert: r.wert, grund: grund.trim() });
    }
    if (liste.length === 0) return setFehler("Nichts geändert.");
    setFehler(null);
    setSpeichert(true);
    const r = await kontext.uebersteuern(liste);
    setSpeichert(false);
    if (!r.ok) return setFehler(r.message);
    toast.success(liste.length === 1 ? "Eingabe gespeichert." : `${liste.length} Eingaben gespeichert.`);
    onSchliessen();
  }

  return (
    <GlassDialog open onOpenChange={(offen) => !offen && !beschaeftigt && onSchliessen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen">
        <GlassDialogTitle className="akte-dialog-titel">{zeile.label} ändern</GlassDialogTitle>
        <GlassDialogDescription className="akte-dialog-text">
          Der Rechner rechnet mit dem neuen Wert neu. Die Zeile bleibt gold markiert und trägt Name, Zeit und Grund.
        </GlassDialogDescription>
        {!kontext.bearbeitbar ? <p className="kalk-dialog-hinweis">Die Änderung legt einen neuen Entwurf an.</p> : null}
        <form onSubmit={(e) => void speichern(e)}>
          {zeile.felder.map((f) => {
            const feldId = `${id}-${f.key}`;
            if (f.typ === "ja_nein") {
              return (
                <label key={f.key} className="kalk-dialog-schalter">
                  <span>{f.label}</span>
                  <GlassSwitch size="sm" checked={schalter[f.key] ?? false} onCheckedChange={(an) => setSchalter((s) => ({ ...s, [f.key]: an }))} />
                </label>
              );
            }
            if (f.typ === "aufzug") {
              return (
                <label key={f.key} className="akte-dialog-feld kalk-dialog-feld" htmlFor={feldId}>
                  {f.label}
                  <select id={feldId} className="lg-input" value={texte[f.key] ?? "keiner"} onChange={(e) => setTexte((t) => ({ ...t, [f.key]: e.target.value }))}>
                    {AUFZUG.map((a) => (
                      <option key={a.wert} value={a.wert}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </label>
              );
            }
            return (
              <label key={f.key} className="akte-dialog-feld kalk-dialog-feld" htmlFor={feldId}>
                {f.label}
                <input
                  id={feldId}
                  className="lg-input"
                  type={f.typ === "datum" ? "date" : "text"}
                  inputMode={f.typ === "datum" ? undefined : f.typ === "ganzzahl" ? "numeric" : "decimal"}
                  value={texte[f.key] ?? ""}
                  onChange={(e) => setTexte((t) => ({ ...t, [f.key]: e.target.value }))}
                  autoComplete="off"
                />
              </label>
            );
          })}
          <label className="akte-dialog-feld" htmlFor={`${id}-grund`}>
            Grund (Pflicht)
            <textarea
              id={`${id}-grund`}
              className="lg-input lg-textarea"
              rows={2}
              value={grund}
              onChange={(e) => setGrund(e.target.value)}
              placeholder="Warum weicht der Wert ab? Etwa: Kunde hat am Telefon 4 Zimmer genannt."
            />
          </label>
          {fehler ? <p className="akte-dialog-fehler">{fehler}</p> : null}
          <div className="akte-dialog-knoepfe">
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
