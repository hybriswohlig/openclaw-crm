"use client";

import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import { apiAufruf, jsonAufruf } from "@/components/neu/akte/api";
import type { InventarListeZeile } from "@/lib/kalkulation-inventar";
import { MONTAGE_KEY } from "@/lib/kalkulation-versionen";
import {
  MONTAGE_GRUND,
  WER_LABEL,
  alleAuf,
  geaenderteKeys,
  leadAenderungen,
  montageWert,
  relevant,
  startWahl,
  waehlbar,
  type MontageWahl,
  type Wer,
} from "@/lib/montage-wahl";
import type { KalkKontext } from "./kalk-seite";

const WERTE: Wer[] = ["wir", "kunde", "nicht_noetig"];

function Seite({
  name,
  label,
  wert,
  gesperrt,
  onWahl,
}: {
  name: string;
  label: string;
  wert: Wer;
  gesperrt: boolean;
  onWahl: (w: Wer) => void;
}) {
  return (
    <div className="kalk-mw-seite" role="group" aria-label={`${label}: ${name}`}>
      <span className="kalk-mw-label">{label}</span>
      {WERTE.map((w) => (
        <button key={w} type="button" className="kalk-mw-knopf" aria-pressed={wert === w} disabled={gesperrt} onClick={() => onWahl(w)}>
          {WER_LABEL[w]}
        </button>
      ))}
    </div>
  );
}

/**
 * „Demontage/Montage wählen“ im Inventar (Inhaber-Wunsch 10.11.): je Möbel getrennt
 * für Abbau und Aufbau „wir“, „Kunde“ oder „nicht nötig“, mit Schnellwahl. Vorbelegt
 * mit dem, was die Kalkulation gerade annimmt. Speichert als Übersteuerung `montage`
 * der Version (an einer gesperrten Version im Entwurf); der Entwurf rechnet neu.
 * Danach auf Nachfrage auch ins Lead, damit neue Entwürfe dieselbe Wahl haben.
 */
export function MontageWahlListe({
  zeilen,
  kontext,
  onFertig,
}: {
  zeilen: InventarListeZeile[];
  kontext: KalkKontext;
  onFertig: () => void;
}) {
  const id = useId();
  const start = useMemo(() => startWahl(zeilen), [zeilen]);
  const [wahl, setWahl] = useState<MontageWahl>(start);
  const [alleZeigen, setAlleZeigen] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const gesperrt = laeuft || kontext.laeuft !== null;

  const liste = waehlbar(zeilen);
  const oben = liste.filter(relevant);
  const weitere = liste.filter((z) => !relevant(z));
  const sichtbar = alleZeigen ? [...oben, ...weitere] : oben;
  const anzahl = geaenderteKeys(start, wahl).length;
  const setze = (key: string, seite: "abbau" | "aufbau", w: Wer) => setWahl((alt) => ({ ...alt, [key]: { ...alt[key], [seite]: w } }));

  async function speichern() {
    const wert = montageWert(zeilen, start, wahl);
    if (!wert) return onFertig();
    setLaeuft(true);
    setFehler(null);
    const r = await kontext.uebersteuern([{ art: "montage", key: MONTAGE_KEY, wert, grund: MONTAGE_GRUND }]);
    if (!r.ok) {
      setLaeuft(false);
      return setFehler(r.message);
    }
    const lead = leadAenderungen(zeilen, start, wahl);
    if (
      lead.length > 0 &&
      window.confirm(
        `Auch im Lead speichern (${lead.length} ${lead.length === 1 ? "Möbel" : "Möbel"})? Dann haben neue Entwürfe dieselbe Wahl. „Nicht nötig“ steht im Lead als „ohne Angabe“.`
      )
    ) {
      const basis = `/api/v1/deals/${encodeURIComponent(kontext.dealId)}/inventory`;
      let fehlgeschlagen = 0;
      for (const a of lead) {
        const p = await apiAufruf<unknown>(
          `${basis}/${encodeURIComponent(a.id)}`,
          jsonAufruf("PATCH", { dismantlingOwner: a.dismantlingOwner, assemblyOwner: a.assemblyOwner })
        );
        if (!p.ok) fehlgeschlagen++;
      }
      if (fehlgeschlagen > 0) toast.error(`${fehlgeschlagen} von ${lead.length} Möbeln nicht im Lead gespeichert.`);
      await kontext.neuLaden();
    }
    setLaeuft(false);
    toast.success("Demontage und Montage gespeichert.", { description: "Der Entwurf rechnet neu." });
    onFertig();
  }

  return (
    <section className="kalk-mw" aria-labelledby={`${id}-t`}>
      <div className="kalk-mw-kopf">
        <h3 id={`${id}-t`} className="kalk-mw-titel">
          Demontage und Montage je Möbel
        </h3>
        <div className="kalk-mw-schnell" role="group" aria-label="Schnellwahl für die Möbel oben">
          <GlassButton type="button" variant="ghost" size="sm" disabled={gesperrt || oben.length === 0} onClick={() => setWahl((w) => alleAuf(w, oben.map((z) => z.key), "wir"))}>
            Alle: wir
          </GlassButton>
          <GlassButton type="button" variant="ghost" size="sm" disabled={gesperrt || oben.length === 0} onClick={() => setWahl((w) => alleAuf(w, oben.map((z) => z.key), "kunde"))}>
            Alle: Kunde
          </GlassButton>
        </div>
      </div>
      <p className="kalk-dialog-hinweis">
        Vorbelegt mit dem, was die Kalkulation gerade annimmt. Baut der Kunde selbst oder ist es nicht nötig, rechnen wir keine Minuten. Im KV stehen nur Möbel, die wir übernehmen.
      </p>
      {oben.length === 0 ? <p className="kalk-dialog-hinweis">Laut Kalkulation wird gerade nichts zerlegt.</p> : null}
      <ul className="kalk-inventar" aria-label="Demontage und Montage je Möbel">
        {sichtbar.map((z) => {
          const w = wahl[z.key] ?? { abbau: z.demontage.wer, aufbau: z.montage.wer };
          return (
            <li key={z.id ?? z.key} className="kalk-mw-zeile" data-geaendert={start[z.key]?.abbau !== w.abbau || start[z.key]?.aufbau !== w.aufbau ? "" : undefined}>
              <span className="kalk-inv-name">
                {z.menge > 1 ? `${z.menge} × ` : ""}
                {z.name}
              </span>
              <Seite name={z.name} label="Abbau" wert={w.abbau} gesperrt={gesperrt} onWahl={(x) => setze(z.key, "abbau", x)} />
              <Seite name={z.name} label="Aufbau" wert={w.aufbau} gesperrt={gesperrt} onWahl={(x) => setze(z.key, "aufbau", x)} />
            </li>
          );
        })}
      </ul>
      {weitere.length > 0 ? (
        <button type="button" className="kalk-mw-mehr" onClick={() => setAlleZeigen((a) => !a)} aria-expanded={alleZeigen}>
          {alleZeigen ? "Nur Möbel mit Demontage zeigen" : `Weitere ${weitere.length} Teile zeigen`}
        </button>
      ) : null}
      {fehler ? <p className="akte-dialog-fehler">{fehler}</p> : null}
      <div className="akte-dialog-knoepfe">
        <GlassButton type="button" variant="ghost" disabled={gesperrt} onClick={onFertig}>
          Abbrechen
        </GlassButton>
        <GlassButton type="button" disabled={gesperrt || anzahl === 0} aria-busy={laeuft || undefined} onClick={() => void speichern()}>
          {laeuft ? "Speichert …" : anzahl === 0 ? "Keine Änderung" : `Speichern (${anzahl} ${anzahl === 1 ? "Möbel" : "Möbel"})`}
        </GlassButton>
      </div>
    </section>
  );
}
