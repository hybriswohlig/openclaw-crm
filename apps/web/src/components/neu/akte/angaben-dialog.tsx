"use client";

import "@/styles/neu-akte-kunde.css";

import { useEffect, useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import type { DealKunde } from "@/lib/deal-kunde";
import { aenderungen, entwurfAus, feldAusPflicht, feldLeer, type KundeEntwurf, type KundeFeld } from "@/lib/kunde-entwurf";
import type { DokumentArt as VorpruefungArt, Vorpruefung } from "@/lib/kv-vorpruefung";
import { apiAufruf, jsonAufruf } from "./api";
import { AusDemChatKnopf, KundeFelder } from "./kunde-felder";

const DOK: Record<VorpruefungArt, { name: string; knopf: string }> = {
  KV: { name: "den Kostenvoranschlag", knopf: "KV" },
  AB: { name: "die Auftragsbestätigung", knopf: "AB" },
  RE: { name: "die Rechnung", knopf: "Rechnung" },
};

/**
 * Fenster „Es fehlen noch Angaben“ vor KV, AB und Rechnung in der neuen
 * Oberfläche. Zeigt genau die Pflichtfelder, ohne die die Vorlage abbricht,
 * mit „Aus dem Chat übernehmen“. Speichern schreibt ins Lead bzw. an die Person
 * (PUT …/kunde, wie die Akte) und geht direkt weiter zum Dokument.
 */
export function AngabenDialog({
  dealId,
  art,
  pruefung,
  portalZiel,
  onWeiter,
  onSchliessen,
}: {
  dealId: string;
  art: VorpruefungArt;
  pruefung: Vorpruefung;
  portalZiel: HTMLElement | undefined;
  /** Nach dem Speichern: neu prüfen und das Dokument öffnen. */
  onWeiter: () => void;
  onSchliessen: () => void;
}) {
  const felder: KundeFeld[] = pruefung.felder.filter((f) => f.fehlt).map((f) => feldAusPflicht(f.feld));
  const [kunde, setKunde] = useState<DealKunde | null>(null);
  const [entwurf, setEntwurf] = useState<KundeEntwurf>(entwurfAus(null));
  const [vorgeschlagen, setVorgeschlagen] = useState<KundeFeld[]>([]);
  const [laden, setLaden] = useState(true);
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    let aktuell = true;
    void apiAufruf<DealKunde>(`/api/v1/deals/${encodeURIComponent(dealId)}/kunde`).then((r) => {
      if (!aktuell) return;
      setLaden(false);
      if (!r.ok) return setFehler(r.message);
      setKunde(r.data);
      setEntwurf(entwurfAus(r.data));
    });
    return () => {
      aktuell = false;
    };
  }, [dealId]);

  const bereit = !laden && felder.every((f) => !feldLeer(entwurf, f));

  async function speichern(e: React.FormEvent) {
    e.preventDefault();
    if (!bereit || speichert) return;
    setSpeichert(true);
    setFehler(null);
    const body = { ...aenderungen(entwurf, kunde, felder), quelle: vorgeschlagen.length > 0 ? "chat" : "vorpruefung" };
    const r = await apiAufruf<DealKunde>(`/api/v1/deals/${encodeURIComponent(dealId)}/kunde`, jsonAufruf("PUT", body));
    setSpeichert(false);
    if (!r.ok) return setFehler(r.message);
    onWeiter();
  }

  return (
    <GlassDialog open onOpenChange={(offen) => !offen && !speichert && onSchliessen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen">
        <GlassDialogTitle className="akte-dialog-titel">Es fehlen noch Angaben</GlassDialogTitle>
        <GlassDialogDescription className="akte-dialog-text">
          Ohne diese Angaben entsteht {DOK[art].name} nicht. Trag sie hier ein; sie werden am Lead gespeichert, danach geht es direkt weiter.
        </GlassDialogDescription>
        <form onSubmit={(e) => void speichern(e)}>
          {laden ? <p className="kunde-hinweis">Lädt die Kundendaten …</p> : null}
          <KundeFelder
            felder={felder}
            entwurf={entwurf}
            pflicht={felder}
            vorgeschlagen={vorgeschlagen}
            gesperrt={laden || speichert}
            onAendern={(neu, feld) => {
              setEntwurf(neu);
              setVorgeschlagen((v) => v.filter((f) => f !== feld));
            }}
          />
          <AusDemChatKnopf
            dealId={dealId}
            entwurf={entwurf}
            felder={felder}
            disabled={laden || speichert}
            onVorschlag={(neu, gesetzt) => {
              setEntwurf(neu);
              setVorgeschlagen(gesetzt);
            }}
          />
          {pruefung.hinweise.length > 0 ? (
            <ul className="kunde-hinweise" aria-label="Hinweise, blockieren nicht">
              {pruefung.hinweise.map((h) => (
                <li key={h.art + h.text}>{h.text}</li>
              ))}
            </ul>
          ) : null}
          {fehler ? <p className="akte-dialog-fehler">{fehler}</p> : null}
          <div className="akte-dialog-knoepfe">
            <GlassButton type="button" variant="ghost" onClick={onSchliessen} disabled={speichert}>
              Abbrechen
            </GlassButton>
            <GlassButton type="submit" disabled={!bereit || speichert} aria-busy={speichert || undefined}>
              {speichert ? "Speichert …" : `Speichern und ${DOK[art].knopf} erstellen`}
            </GlassButton>
          </div>
        </form>
      </GlassDialogContent>
    </GlassDialog>
  );
}
