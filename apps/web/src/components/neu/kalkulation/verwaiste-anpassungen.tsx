"use client";

import { useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import type { AnpassungAnsicht, VerwaistAnsicht } from "@/lib/kalkulations-ansicht";
import type { KalkKontext } from "./kalk-seite";
import { uebertragbar, uebertragenEingaben, verwaistHinweis, verwerfenEingaben } from "./verwaist-logik";

type Frage = { art: "uebertragen" | "verwerfen"; v: VerwaistAnsicht };

/**
 * Verwaiste Fahrzeug-Anpassungen (Entscheidung 5a-9): je Anpassung eine
 * goldene Zeile mit „Übertragen“ (nur bei genau einem Kandidaten) und
 * „Verwerfen“, beides erst nach einer Rückfrage. Solange eine steht, lehnt
 * das Sperren ab (`UEBERSTEUERUNG_VERWAIST`).
 */
export function VerwaisteAnpassungen({
  verwaist,
  anpassungen,
  kontext,
  beschaeftigt,
  portalZiel,
}: {
  verwaist: VerwaistAnsicht[];
  anpassungen: AnpassungAnsicht[];
  kontext: Pick<KalkKontext, "uebersteuern" | "bearbeitbar">;
  beschaeftigt: boolean;
  portalZiel: HTMLElement | undefined;
}) {
  const [frage, setFrage] = useState<Frage | null>(null);
  const [schreibt, setSchreibt] = useState(false);
  if (verwaist.length === 0 || !kontext.bearbeitbar) return null;
  const anpassung = (v: VerwaistAnsicht) => anpassungen.find((a) => a.id === v.id);

  async function bestaetigen() {
    if (!frage) return;
    const liste = frage.art === "uebertragen" ? uebertragenEingaben(frage.v) : verwerfenEingaben(frage.v);
    if (liste.length === 0) return;
    setSchreibt(true);
    const r = await kontext.uebersteuern(liste);
    setSchreibt(false);
    if (!r.ok) {
      toast.error(frage.art === "uebertragen" ? "Übertragen fehlgeschlagen." : "Verwerfen fehlgeschlagen.", { description: r.message });
      return;
    }
    toast.success(frage.art === "uebertragen" ? "Anpassung übertragen." : "Anpassung verworfen.");
    setFrage(null);
  }

  return (
    <>
      <div className="kalk-panel-kopf" data-klein="">
        <div>
          <h3 className="kalk-panel-titel">Anpassung wirkt nicht mehr</h3>
          <p className="kalk-panel-unter">Vor dem Sperren übertragen oder verwerfen.</p>
        </div>
      </div>
      <ul className="kalk-notizen kalk-verwaist-liste" aria-label="Verwaiste Anpassungen">
        {verwaist.map((v) => {
          const a = anpassung(v);
          return (
            <li key={v.id} className="kalk-verwaist" data-ton="gold">
              <p className="kalk-verwaist-t">{v.text}</p>
              {a ? (
                <small className="kalk-verwaist-f">
                  {a.von} · {a.am} · „{a.grund}“
                </small>
              ) : null}
              <p className="kalk-verwaist-h">{verwaistHinweis(v)}</p>
              <div className="kalk-verwaist-k">
                {uebertragbar(v) ? (
                  <button type="button" className="kalk-kleinknopf" disabled={beschaeftigt} onClick={() => setFrage({ art: "uebertragen", v })}>
                    Übertragen
                  </button>
                ) : null}
                <button type="button" className="kalk-kleinknopf" data-ton="grau" disabled={beschaeftigt} onClick={() => setFrage({ art: "verwerfen", v })}>
                  Verwerfen
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {frage ? (
        <GlassDialog open onOpenChange={(offen) => !offen && !schreibt && setFrage(null)}>
          <GlassDialogContent container={portalZiel} closeLabel="Schließen">
            <GlassDialogTitle className="akte-dialog-titel">
              {frage.art === "uebertragen" ? "Anpassung übertragen?" : "Anpassung verwerfen?"}
            </GlassDialogTitle>
            <GlassDialogDescription className="akte-dialog-text">
              {frage.art === "uebertragen"
                ? `„${frage.v.text}“ gilt dann für ${frage.v.kandidatenText[0] ?? "die neue Zeile"}, mit dem Grund „übertragen von früherer Station“. Die alte Anpassung wird gelöscht.`
                : `„${frage.v.text}“ wird gelöscht. Der Rechner rechnet die Zeile dann mit seinen Regeln.`}
            </GlassDialogDescription>
            <div className="akte-dialog-knoepfe">
              <GlassButton type="button" variant="ghost" onClick={() => setFrage(null)} disabled={schreibt}>
                Abbrechen
              </GlassButton>
              <GlassButton type="button" onClick={() => void bestaetigen()} disabled={schreibt}>
                {schreibt ? "Speichert …" : frage.art === "uebertragen" ? "Übertragen" : "Verwerfen"}
              </GlassButton>
            </div>
          </GlassDialogContent>
        </GlassDialog>
      ) : null}
    </>
  );
}
