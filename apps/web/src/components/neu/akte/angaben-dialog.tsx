"use client";

import "@/styles/neu-akte-kunde.css";

import { useEffect, useRef, useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import { gleicheAdresse } from "@/lib/adresse";
import { ortAusTeilen, type DealKunde, type KundeEingabe } from "@/lib/deal-kunde";
import { aenderungen, entwurfAus, feldAusPflicht, feldLeer, type KundeEntwurf, type KundeFeld } from "@/lib/kunde-entwurf";
import { EINZUG_GLEICH_TEXT, type DokumentArt as VorpruefungArt, type Vorpruefung } from "@/lib/kv-vorpruefung";
import { apiAufruf } from "./api";
import { AusDemChatKnopf, KundeFelder, PersonFrage, kundeSpeichern, type PersonKandidat } from "./kunde-felder";

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
  const [frage, setFrage] = useState<{ kandidaten: PersonKandidat[]; body: KundeEingabe } | null>(null);

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

  // KV-Meldung 10.11.: Einzug gleich Auszug zählt wie fehlend.
  const einzugGleich = felder.includes("einzug") && gleicheAdresse(ortAusTeilen(entwurf.auszug), ortAusTeilen(entwurf.einzug));
  const gruende = pruefung.felder.filter((f) => f.fehlt && f.grund).map((f) => f.grund!);
  const bereit = !laden && felder.every((f) => !feldLeer(entwurf, f)) && !einzugGleich;

  const laeuftRef = useRef(false);

  async function senden(body: KundeEingabe) {
    if (laeuftRef.current) return;
    laeuftRef.current = true;
    setSpeichert(true);
    setFehler(null);
    const r = await kundeSpeichern(dealId, body);
    laeuftRef.current = false;
    setSpeichert(false);
    if (r.art === "frage") return setFrage({ kandidaten: r.kandidaten, body });
    setFrage(null);
    if (r.art === "fehler") return setFehler(r.text);
    onWeiter();
  }

  async function speichern(e: React.FormEvent) {
    e.preventDefault();
    if (!bereit || speichert) return;
    await senden({ ...aenderungen(entwurf, kunde, felder), quelle: vorgeschlagen.length > 0 ? "chat" : "vorpruefung" });
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
          {einzugGleich || gruende.length > 0 ? (
            <p className="kunde-hinweis" role="status">
              {einzugGleich ? EINZUG_GLEICH_TEXT : gruende.join(" ")}
            </p>
          ) : null}
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
          {frage ? (
            <PersonFrage
              kandidaten={frage.kandidaten}
              name={entwurf.name}
              disabled={speichert}
              onWahl={(personWahl) => void senden({ ...frage.body, personWahl })}
            />
          ) : null}
          <div className="akte-dialog-knoepfe" hidden={!!frage}>
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
