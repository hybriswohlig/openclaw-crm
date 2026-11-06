"use client";

import { useId, useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import type { KalkulationsAnsicht } from "@/lib/kalkulations-ansicht";
import { euro } from "@/components/neu/akte/format";
import { kvUnterzeile } from "./kv-vorschau";

/** Texte für `POST …/kv` (`copy`), nur gefüllte Felder. */
export interface KvTexte {
  intro?: string;
  remarks?: string;
}

/**
 * KV-Dialog (Entscheidung 6): Anschreiben und Bemerkung optional als
 * Klartext, dann sperren (Entwurf) und den KV erstellen. Bei einer schon
 * gesperrten Version ohne KV-Dokument nur „KV erstellen“. Für Kottke
 * (`renderer: "vps"`) erzeugt der nächste Dialog das PDF und nimmt die Texte
 * dort entgegen; hier gibt es dann keine Textfelder (M1).
 */
export function KvDialog({
  version,
  kv,
  laeuft,
  portalZiel,
  onSchliessen,
  onBestaetigen,
}: {
  version: KalkulationsAnsicht["version"];
  kv: KalkulationsAnsicht["kv"];
  laeuft: boolean;
  portalZiel: HTMLElement | undefined;
  onSchliessen: () => void;
  onBestaetigen: (texte: KvTexte) => Promise<void>;
}) {
  const id = useId();
  const [intro, setIntro] = useState("");
  const [remarks, setRemarks] = useState("");
  const nurKv = version.status === "gesperrt";
  const kottke = version.renderer === "vps";
  const titel = nurKv ? `KV zu Version v${version.nummer} erstellen` : `Version v${version.nummer} sperren und KV erstellen`;

  async function bestaetigen(e: React.FormEvent) {
    e.preventDefault();
    const texte: KvTexte = {};
    if (!kottke && intro.trim()) texte.intro = intro.trim();
    if (!kottke && remarks.trim()) texte.remarks = remarks.trim();
    await onBestaetigen(texte);
  }

  return (
    <GlassDialog open onOpenChange={(offen) => !offen && !laeuft && onSchliessen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen">
        <GlassDialogTitle className="akte-dialog-titel">{titel}</GlassDialogTitle>
        <GlassDialogDescription className="akte-dialog-text">
          {nurKv
            ? "Der KV wird aus den gesperrten Posten dieser Version erzeugt. Nichts geht an den Kunden."
            : "Der Preis wird beim Sperren noch einmal geprüft. Danach ist die Version fest; Änderungen landen in einem neuen Entwurf. Nichts geht an den Kunden."}
        </GlassDialogDescription>
        {kv ? (
          <p className="kalk-kv-dialog-summe">
            {euro(kv.summeCent)}
            <small>{kvUnterzeile(kv)}</small>
          </p>
        ) : null}
        <form onSubmit={(e) => void bestaetigen(e)}>
          {kottke ? (
            <p className="kalk-dialog-hinweis">Anschreiben und Bemerkung gibst du im nächsten Dialog ein.</p>
          ) : (
            <>
              <label className="akte-dialog-feld" htmlFor={`${id}-intro`}>
                Anschreiben (optional)
                <textarea
                  id={`${id}-intro`}
                  className="lg-input lg-textarea"
                  rows={3}
                  value={intro}
                  onChange={(e) => setIntro(e.target.value)}
                  placeholder="Guten Tag, vielen Dank für Ihre Anfrage. Anbei unser Angebot für Ihren Umzug."
                />
              </label>
              <label className="akte-dialog-feld" htmlFor={`${id}-remarks`}>
                Bemerkung (optional)
                <textarea
                  id={`${id}-remarks`}
                  className="lg-input lg-textarea"
                  rows={2}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Etwa: Halteverbot beantragen wir für beide Seiten."
                />
              </label>
              <p className="kalk-dialog-aktuell">Sätze mit Beträgen fallen aus den Texten; der Preis steht in den Posten.</p>
            </>
          )}
          <div className="akte-dialog-knoepfe">
            <GlassButton type="button" variant="ghost" onClick={onSchliessen} disabled={laeuft}>
              Abbrechen
            </GlassButton>
            <GlassButton type="submit" disabled={laeuft}>
              {laeuft ? "Läuft …" : nurKv ? "KV erstellen" : "Sperren und KV erstellen"}
            </GlassButton>
          </div>
        </form>
      </GlassDialogContent>
    </GlassDialog>
  );
}
