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
import type { GrundlageAnsichtZeile } from "@/lib/kalkulations-ansicht";
import { eingabenAus, geaenderteFelder } from "./eingabe-felder";
import type { KalkKontext } from "./kalk-seite";

const AUFZUG = [
  { wert: "keiner", label: "kein Aufzug" },
  { wert: "klein", label: "kleiner Aufzug" },
  { wert: "gross", label: "großer Aufzug" },
] as const;

/**
 * Eingabe-Dialog einer Grundlage-Zeile: alle `felder` der Zeile, ein
 * Pflichtgrund; je geändertem Feld eine Übersteuerung `art: "eingabe"`. Die
 * Felder werden mit den Regeln des Servers geprüft, bevor etwas gesendet wird
 * (M5); ein leeres Feld ohne alten Wert zählt als unverändert (I1). `zeile`
 * ist immer die aktuelle Zeile der Ansicht, auch nach einem teilweisen
 * Speichern. An einer gesperrten Version steht der Hinweis, dass die Änderung
 * einen neuen Entwurf anlegt (Review Focus 2).
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
  const [eingaben, setEingaben] = useState(() => eingabenAus(zeile.felder));
  const [grund, setGrund] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [speichert, setSpeichert] = useState(false);
  const beschaeftigt = speichert || kontext.laeuft !== null;

  const setzeText = (key: string, text: string) => setEingaben((e) => ({ ...e, texte: { ...e.texte, [key]: text } }));
  const setzeSchalter = (key: string, an: boolean) => setEingaben((e) => ({ ...e, schalter: { ...e.schalter, [key]: an } }));

  async function speichern(e: React.FormEvent) {
    e.preventDefault();
    const r = geaenderteFelder(zeile.felder, eingaben, grund);
    if (!r.ok) return setFehler(r.meldung);
    if (r.liste.length === 0) return setFehler("Nichts geändert.");
    setFehler(null);
    setSpeichert(true);
    const g = grund.trim();
    const ergebnis = await kontext.uebersteuern(r.liste.map((f) => ({ art: "eingabe" as const, key: f.key, wert: f.wert, grund: g })));
    setSpeichert(false);
    if (!ergebnis.ok) return setFehler(ergebnis.message);
    toast.success(r.liste.length === 1 ? "Eingabe gespeichert." : `${r.liste.length} Eingaben gespeichert.`);
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
                  <GlassSwitch size="sm" checked={eingaben.schalter[f.key] ?? false} onCheckedChange={(an) => setzeSchalter(f.key, an)} />
                </label>
              );
            }
            if (f.typ === "aufzug") {
              return (
                <label key={f.key} className="akte-dialog-feld kalk-dialog-feld" htmlFor={feldId}>
                  {f.label}
                  <select id={feldId} className="lg-input" value={eingaben.texte[f.key] ?? "keiner"} onChange={(e) => setzeText(f.key, e.target.value)}>
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
                  value={eingaben.texte[f.key] ?? ""}
                  onChange={(e) => setzeText(f.key, e.target.value)}
                  placeholder={f.wert === null || f.wert === undefined ? "Standard des Rechners" : undefined}
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
