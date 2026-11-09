"use client";

import "@/styles/neu-kalk-p15.css";

import { useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassDialog, GlassDialogContent, GlassDialogDescription, GlassDialogTitle } from "@/components/glassyui/glass-dialog";
import { apiAufruf, jsonAufruf } from "@/components/neu/akte/api";
import type { PaketSchalterAnsicht } from "@/lib/kalkulations-ansicht";
import type { KalkKontext } from "./kalk-seite";

type Wert = "standard" | "an" | "aus";

/** Hinweis, wenn Pakete wirken sollen, die Firma aber keine (oder keine Basis) hat. */
export function paketHinweis(s: PaketSchalterAnsicht): string | null {
  if (!s.wirksam) return null;
  if (s.pakete.aktiv === 0) return "Bitte zuerst Pakete in den Einstellungen anlegen (Basis fehlt).";
  if (!s.pakete.basis) return "Bitte zuerst Pakete in den Einstellungen anlegen (Basis fehlt).";
  return null;
}

/**
 * „Pakete anbieten“ je Deal (Plan 15, Bauteil 15): Firmenstandard, an oder aus.
 * Einschalten fragt nach, weil der Kunde danach Paketkarten im Portal sieht.
 * An einer gesperrten Version wirkt es erst ab dem nächsten Entwurf.
 */
export function PaketeSchalter({ schalter, kontext, portalZiel }: { schalter: PaketSchalterAnsicht; kontext: KalkKontext; portalZiel: HTMLElement | undefined }) {
  const [frage, setFrage] = useState<Wert | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const aktuell: Wert = schalter.deal ?? "standard";
  const beschaeftigt = laeuft || kontext.laeuft !== null;

  async function setzen(wert: Wert) {
    setLaeuft(true);
    const r = await apiAufruf<unknown>(`/api/v1/deals/${encodeURIComponent(kontext.dealId)}/calculation/pakete`, jsonAufruf("PUT", { wert }));
    setLaeuft(false);
    setFrage(null);
    if (!r.ok) {
      toast.error("Pakete konnten nicht umgestellt werden.", { description: r.message });
      return;
    }
    toast.success("Pakete umgestellt.", { description: kontext.bearbeitbar ? "Der Entwurf rechnet neu." : "Gilt ab dem nächsten Entwurf." });
    if (kontext.bearbeitbar) await kontext.neuRechnen();
    else await kontext.neuLaden();
  }

  function waehlen(wert: Wert) {
    if (wert === aktuell) return;
    const wirdAn = wert === "an" || (wert === "standard" && schalter.firma);
    if (wirdAn && !schalter.wirksam) setFrage(wert);
    else void setzen(wert);
  }

  const hinweis = paketHinweis(schalter);
  return (
    <div className="kalk-pakete-schalter">
      <label className="kalk-dialog-schalter">
        <span>Pakete anbieten</span>
        <select className="lg-input" value={aktuell} disabled={beschaeftigt} onChange={(e) => waehlen(e.target.value as Wert)}>
          <option value="standard">Firmenstandard ({schalter.firma ? "an" : "aus"})</option>
          <option value="an">an</option>
          <option value="aus">aus</option>
        </select>
      </label>
      {!kontext.bearbeitbar ? <p className="kalk-hinweis-klein">Diese Version ist gesperrt: die Änderung wirkt ab dem nächsten Entwurf.</p> : null}
      {hinweis ? (
        <p className="kalk-hinweis-klein">
          {hinweis} <a href="/settings/customer-portal">Pakete anlegen</a>
        </p>
      ) : null}
      {!schalter.wirksam && !schalter.firma ? (
        <p className="kalk-hinweis-klein">
          Pakete (Basis, Komfort, Premium) sind für diese Firma aus. <a href="/app/einstellungen#einst-firmen">Einstellungen, Kundenportal</a>
        </p>
      ) : null}
      {frage !== null ? (
        <GlassDialog open onOpenChange={(offen) => !offen && !laeuft && setFrage(null)}>
          <GlassDialogContent container={portalZiel} closeLabel="Schließen">
            <GlassDialogTitle className="akte-dialog-titel">Pakete für diesen Deal anbieten?</GlassDialogTitle>
            <GlassDialogDescription className="akte-dialog-text">
              Der Kunde sieht danach Paketkarten (Basis, Komfort, Premium) im Portal. Die Kalkulation rechnet je Paket einen Preis.
            </GlassDialogDescription>
            <div className="akte-dialog-knoepfe">
              <GlassButton type="button" variant="ghost" onClick={() => setFrage(null)} disabled={laeuft}>
                Abbrechen
              </GlassButton>
              <GlassButton type="button" onClick={() => void setzen(frage)} disabled={laeuft}>
                {laeuft ? "Schaltet …" : "Ja, Pakete anbieten"}
              </GlassButton>
            </div>
          </GlassDialogContent>
        </GlassDialog>
      ) : null}
    </div>
  );
}
