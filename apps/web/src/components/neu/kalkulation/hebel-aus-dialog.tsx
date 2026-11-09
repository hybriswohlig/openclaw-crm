"use client";

import "@/styles/neu-kalk-p15.css";

import { useId, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassDialog, GlassDialogContent, GlassDialogDescription, GlassDialogTitle } from "@/components/glassyui/glass-dialog";
import { grundAusKurzgrund, KURZGRUENDE, type Kurzgrund } from "@/lib/kalkulation-p15";
import type { HebelArt } from "@/services/rechner/kv-posten";
import type { KalkKontext } from "./kalk-seite";
import { HEBEL_AUS_TEXT, hebelAusUebersteuerungen } from "./kv-posten-logik";

/**
 * „×“ an einem Hebel-Posten (Plan 15, Bauteil 6): setzt die zugehörige Eingabe
 * aus, mit Kurzgrund und Freitext. Der Rechner rechnet danach neu; ein fester
 * Kundenpreis ohne Marge entsteht nicht.
 */
export function HebelAusDialog({
  hebel,
  posten,
  kontext,
  portalZiel,
  onSchliessen,
}: {
  hebel: HebelArt;
  posten: string;
  kontext: KalkKontext;
  portalZiel: HTMLElement | undefined;
  onSchliessen: () => void;
}) {
  const id = useId();
  const [kurz, setKurz] = useState<Kurzgrund | null>(null);
  const [frei, setFrei] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const beschaeftigt = laeuft || kontext.laeuft !== null;

  async function speichern(e: React.FormEvent) {
    e.preventDefault();
    if (!kurz) return setFehler("Bitte einen Grund wählen.");
    setLaeuft(true);
    const r = await kontext.uebersteuern(hebelAusUebersteuerungen(hebel, grundAusKurzgrund(kurz, frei)));
    setLaeuft(false);
    if (!r.ok) return setFehler(r.message);
    toast.success("Posten herausgenommen.", { description: "Der Rechner hat neu gerechnet." });
    onSchliessen();
  }

  return (
    <GlassDialog open onOpenChange={(offen) => !offen && !beschaeftigt && onSchliessen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen">
        <GlassDialogTitle className="akte-dialog-titel">Posten herausnehmen</GlassDialogTitle>
        <GlassDialogDescription className="akte-dialog-text">
          „{posten}“: {HEBEL_AUS_TEXT[hebel]}. Der Preis wird neu gerechnet, mit derselben Marge.
        </GlassDialogDescription>
        {!kontext.bearbeitbar ? <p className="kalk-dialog-hinweis">Die Änderung legt einen neuen Entwurf an.</p> : null}
        <form onSubmit={(e) => void speichern(e)}>
          <div className="kalk-kurzgruende" role="group" aria-label="Grund">
            {KURZGRUENDE.map((k) => (
              <button key={k} type="button" className="kalk-kleinknopf kalk-kurzgrund" aria-pressed={kurz === k} onClick={() => setKurz(k)}>
                {k}
              </button>
            ))}
          </div>
          <label className="akte-dialog-feld" htmlFor={`${id}-f`}>
            Ergänzung (optional)
            <input id={`${id}-f`} className="lg-input" value={frei} onChange={(e) => setFrei(e.target.value)} placeholder="Etwa: Kundin hat das Halteverbot selbst beantragt" />
          </label>
          {fehler ? <p className="akte-dialog-fehler">{fehler}</p> : null}
          <div className="akte-dialog-knoepfe">
            <GlassButton type="button" variant="ghost" onClick={onSchliessen} disabled={beschaeftigt}>
              Abbrechen
            </GlassButton>
            <GlassButton type="submit" disabled={beschaeftigt || !kurz}>
              {laeuft ? "Rechnet …" : "Herausnehmen"}
            </GlassButton>
          </div>
        </form>
      </GlassDialogContent>
    </GlassDialog>
  );
}
