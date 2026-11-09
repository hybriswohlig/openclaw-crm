"use client";

import "@/styles/neu-kalk-p15.css";

import { useId, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassDialog, GlassDialogContent, GlassDialogDescription, GlassDialogTitle } from "@/components/glassyui/glass-dialog";
import { apiAufruf, jsonAufruf } from "@/components/neu/akte/api";
import type { AdressInfo } from "@/lib/kalkulation-annahmen";
import type { KalkKontext } from "./kalk-seite";

type Seite = "beladen" | "entladen";

/** Zeile unter Beladen und Entladen: Adresse mit Herkunft und den Knöpfen (Plan 15, Bauteile 2 und 8). */
export function AdressZeile({
  seite,
  info,
  beschaeftigt,
  onOeffnen,
}: {
  seite: Seite;
  info: AdressInfo & { amText: string | null };
  beschaeftigt: boolean;
  onOeffnen: (art: "uebernehmen" | "aendern") => void;
}) {
  const wort = seite === "beladen" ? "Beladeadresse" : "Entladeadresse";
  return (
    <div className="kalk-adresse">
      {info.quelle === "fehlt" ? (
        <span>{wort} fehlt, Fahrzeiten geschätzt.</span>
      ) : (
        <span>
          <b>{info.text}</b>
          {info.quelle === "chat" ? " · aus dem Chat, unbestätigt" : info.gesetzt ? ` · in der Kalkulation gesetzt von ${info.gesetzt.von}, ${info.amText ?? ""}` : ""}
          {!info.genau ? " · ohne Straße, Fahrzeiten ungefähr" : ""}
        </span>
      )}
      {info.quelle === "chat" ? (
        <button type="button" className="kalk-kleinknopf" disabled={beschaeftigt} onClick={() => onOeffnen("uebernehmen")}>
          Ins Lead übernehmen
        </button>
      ) : null}
      <button type="button" className="kalk-kleinknopf" disabled={beschaeftigt} onClick={() => onOeffnen("aendern")}>
        {info.quelle === "fehlt" ? "Adresse eintragen" : "Adresse ändern"}
      </button>
    </div>
  );
}

/**
 * Adresse ins Lead schreiben, mit Rückfrage, weil es die Lead-Daten ändert
 * (Akte, Portal, Route). Danach rechnet der Entwurf neu; an einer gesperrten
 * Version legt die Seite einen neuen Entwurf an.
 */
export function AdressDialog({
  seite,
  info,
  art,
  kontext,
  portalZiel,
  onSchliessen,
}: {
  seite: Seite;
  info: AdressInfo;
  art: "uebernehmen" | "aendern";
  kontext: KalkKontext;
  portalZiel: HTMLElement | undefined;
  onSchliessen: () => void;
}) {
  const id = useId();
  const [text, setText] = useState(info.text ?? "");
  const [bestaetigt, setBestaetigt] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const beschaeftigt = laeuft || kontext.laeuft !== null;
  const wort = seite === "beladen" ? "Beladeadresse" : "Entladeadresse";

  async function speichern(e: React.FormEvent) {
    e.preventDefault();
    if (text.trim().length < 4) return setFehler("Bitte mindestens PLZ oder Ort angeben.");
    if (!bestaetigt) return setFehler("Bitte bestätigen, dass die Lead-Daten geändert werden.");
    setLaeuft(true);
    setFehler(null);
    const r = await apiAufruf<unknown>(
      `/api/v1/deals/${encodeURIComponent(kontext.dealId)}/calculation/adresse`,
      jsonAufruf("PUT", { seite, adresse: text.trim(), quelle: art === "uebernehmen" && text.trim() === info.text ? "chat" : "kalkulation", version: kontext.versionNr })
    );
    setLaeuft(false);
    if (!r.ok) return setFehler(r.message);
    toast.success(`${wort} im Lead gespeichert.`);
    onSchliessen();
    if (kontext.bearbeitbar) await kontext.neuRechnen();
    else await kontext.neueVersion();
  }

  return (
    <GlassDialog open onOpenChange={(offen) => !offen && !beschaeftigt && onSchliessen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen">
        <GlassDialogTitle className="akte-dialog-titel">{art === "uebernehmen" ? `${wort} ins Lead übernehmen` : `${wort} ändern`}</GlassDialogTitle>
        <GlassDialogDescription className="akte-dialog-text">
          {art === "uebernehmen"
            ? "Die Angabe stammt aus dem Chat und ist unbestätigt. Mit Straße und Hausnummer rechnet der Rechner genauer."
            : "Straße, Hausnummer, PLZ und Ort. PLZ und Ort allein reichen für ungefähre Fahrzeiten."}
        </GlassDialogDescription>
        <form onSubmit={(e) => void speichern(e)}>
          <label className="akte-dialog-feld" htmlFor={`${id}-a`}>
            {wort}
            <input id={`${id}-a`} className="lg-input" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" placeholder="Hauptstraße 5, 70372 Stuttgart" />
          </label>
          <label className="kalk-dialog-schalter">
            <input type="checkbox" checked={bestaetigt} onChange={(e) => setBestaetigt(e.target.checked)} />
            <span>Ja, die Adresse im Lead ändern (Akte, Portal und Route nutzen sie).</span>
          </label>
          {!kontext.bearbeitbar ? <p className="kalk-dialog-hinweis">Diese Version ist gesperrt: danach entsteht ein neuer Entwurf.</p> : null}
          {fehler ? <p className="akte-dialog-fehler">{fehler}</p> : null}
          <div className="akte-dialog-knoepfe">
            <GlassButton type="button" variant="ghost" onClick={onSchliessen} disabled={beschaeftigt}>
              Abbrechen
            </GlassButton>
            <GlassButton type="submit" disabled={beschaeftigt || !bestaetigt}>
              {laeuft ? "Speichert" : "Ins Lead schreiben"}
            </GlassButton>
          </div>
        </form>
      </GlassDialogContent>
    </GlassDialog>
  );
}
