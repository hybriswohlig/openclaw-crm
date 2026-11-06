"use client";

import { useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import {
  GlassSelect,
  GlassSelectContent,
  GlassSelectItem,
  GlassSelectTrigger,
  GlassSelectValue,
} from "@/components/glassyui/glass-select";

export interface StufenZiel {
  id: string;
  label: string;
  kategorie: string | null;
}

export interface Verlustgrund {
  id: string;
  label: string;
}

/**
 * Rückfrage vor einem Stufenwechsel (Akte: Durchgeführt, Bezahlt, Verloren;
 * Board: Verloren); mit `grundNoetig` zusätzlich Pflichtgrund und Freitext wie
 * `LossReasonDialog` (Freitext Pflicht bei Sonstiges). Aus `stufen-menue.tsx`
 * ausgelagert, damit Akte und Leads-Board denselben Dialog zeigen.
 */
export function StufenDialog({
  portalZiel,
  von,
  ziel,
  grundNoetig,
  verlustGruende,
  speichert,
  onAbbrechen,
  onBestaetigen,
}: {
  portalZiel: HTMLElement | undefined;
  von: string;
  ziel: StufenZiel;
  grundNoetig: boolean;
  verlustGruende: Verlustgrund[];
  speichert: boolean;
  onAbbrechen: () => void;
  onBestaetigen: (verlust?: { grund: string; notiz: string }) => Promise<string | null>;
}) {
  const [grund, setGrund] = useState("");
  const [notiz, setNotiz] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const grundLabel = verlustGruende.find((g) => g.id === grund)?.label ?? "";
  const sonstiges = grundLabel.toLowerCase() === "sonstiges";
  const keineGruende = grundNoetig && verlustGruende.length === 0;

  const beschreibung = grundNoetig
    ? "Ein Lead auf Verloren braucht einen Grund."
    : ziel.kategorie === "lost"
      ? `Der Deal wechselt von „${von}“ auf „${ziel.label}“. Der gespeicherte Verlustgrund bleibt.`
      : `Der Deal wechselt von „${von}“ auf „${ziel.label}“.`;

  async function absenden(e: React.FormEvent) {
    e.preventDefault();
    if (grundNoetig) {
      if (!grund) return setFehler("Bitte einen Verlustgrund wählen.");
      if (sonstiges && !notiz.trim()) return setFehler("Bei Sonstiges ist ein Freitext Pflicht.");
    }
    setFehler(null);
    const problem = await onBestaetigen(grundNoetig ? { grund, notiz: notiz.trim() } : undefined);
    if (problem) setFehler(problem);
  }

  return (
    <GlassDialog open onOpenChange={(offen) => !offen && !speichert && onAbbrechen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen">
        <GlassDialogTitle className="akte-dialog-titel">
          {grundNoetig ? "Verlustgrund" : `Stufe auf „${ziel.label}“ setzen?`}
        </GlassDialogTitle>
        <GlassDialogDescription className="akte-dialog-text">{beschreibung}</GlassDialogDescription>
        <form onSubmit={(e) => void absenden(e)}>
          {grundNoetig ? (
            <>
              <label className="akte-dialog-feld">
                Grund
                <GlassSelect value={grund} onValueChange={setGrund} disabled={keineGruende}>
                  <GlassSelectTrigger aria-label="Verlustgrund">
                    <GlassSelectValue placeholder="Auswählen" />
                  </GlassSelectTrigger>
                  <GlassSelectContent>
                    {verlustGruende.map((g) => (
                      <GlassSelectItem key={g.id} value={g.id}>
                        {g.label}
                      </GlassSelectItem>
                    ))}
                  </GlassSelectContent>
                </GlassSelect>
              </label>
              {keineGruende ? (
                <p className="akte-dialog-fehler">Im Workspace sind keine Verlustgründe angelegt.</p>
              ) : null}
              <label className="akte-dialog-feld">
                Freitext
                <textarea
                  className="lg-input lg-textarea"
                  value={notiz}
                  onChange={(e) => setNotiz(e.target.value)}
                  placeholder={sonstiges ? "Pflicht bei Sonstiges" : "Optional"}
                  rows={3}
                />
              </label>
            </>
          ) : null}
          {fehler ? <p className="akte-dialog-fehler">{fehler}</p> : null}
          <div className="akte-dialog-knoepfe">
            <GlassButton type="button" variant="ghost" onClick={onAbbrechen} disabled={speichert}>
              Abbrechen
            </GlassButton>
            <GlassButton type="submit" disabled={speichert || keineGruende}>
              {speichert ? "Speichert" : grundNoetig ? "Als verloren markieren" : `Auf „${ziel.label}“ setzen`}
            </GlassButton>
          </div>
        </form>
      </GlassDialogContent>
    </GlassDialog>
  );
}
