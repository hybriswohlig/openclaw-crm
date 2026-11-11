"use client";

import "@/styles/neu-akte-gespraech.css";

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { GlassSegmentedControl, GlassSegmentedControlItem } from "@/components/glassyui/glass-segmented-control";
import { TranskriptDialog, type TranskriptVorschau } from "@/components/neu/anrufe/transkript-dialog";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import type { GespraechEintrag, GespraechKanalArt } from "@/lib/gespraech";
import type { Gespraech } from "@/services/gespraech";
import { DokumenteAnsicht } from "./dokumente-ansicht";
import { Eingabe } from "./eingabe";
import { EntwurfKarte } from "./entwurf-karte";
import { FotosAnsicht, FotoVollbild, type Foto } from "./fotos-ansicht";
import { fensterZu } from "./gespraech-texte";
import { GespraechVerlauf, KANAL_LABEL } from "./gespraech-verlauf";
import { NotizenAnsicht } from "./notizen-ansicht";

type Ansicht = "chat" | "fotos" | "dokumente" | "notizen";

const ANSICHTEN: { wert: Ansicht; label: string }[] = [
  { wert: "chat", label: "Chat" },
  { wert: "fotos", label: "Fotos" },
  { wert: "dokumente", label: "Dokumente" },
  { wert: "notizen", label: "Notizen" },
];

const KANAL_REIHE: GespraechKanalArt[] = ["whatsapp", "email", "sms"];

type Anruf = Extract<GespraechEintrag, { art: "anruf" }>;

/** Was der Transkript-Dialog aus dem Verlaufseintrag schon weiß; der Name steht im Kopf der Akte. */
function vorschauAus(a: Anruf, kundeName: string): TranskriptVorschau {
  return {
    id: a.id,
    zeit: a.zeit,
    leitung: a.leitung,
    angenommenVon: a.angenommenVon,
    dauerSek: a.dauerSek,
    anruferName: kundeName,
    nummer: a.nummer,
    zusammenfassung: a.zusammenfassung,
    stichworte: [],
    dealRecordId: null,
  };
}

/** Griff für die Inbox (Plan 6): Text ins Eingabefeld hängen, Feld fokussieren. */
export interface GespraechPanelGriff {
  /** Hängt `text` mit Leerzeile an den vorhandenen Text an, wechselt auf „Chat“ und fokussiert das Feld. */
  einfuegen: (text: string) => void;
  fokussieren: () => void;
  /** Gespräch im Eingabefeld wählen (kv-danach: nach „WhatsApp starten“ genau das neue). */
  waehlen: (gespraechId: string) => void;
}

/** Vorhandener Text plus Baustein, mit Leerzeile dazwischen (wie `onInsert` der alten Inbox). */
export function textAnhaengen(alt: string, neu: string): string {
  return alt.trim() ? `${alt.trimEnd()}\n\n${neu}` : neu;
}

/**
 * Das Gespräch-Panel der Akte (Spec 3.3): Kopf mit Kanal-Chips und
 * Ansichtswahl, dann Verlauf mit Entwurf-Karte und Eingabefeld, oder Fotos,
 * Dokumente, Notizen. Das Dock (Task 14) bekommt unten Platz. Nach jedem
 * Senden oder Freigeben lädt `onNeuLaden` die Akte neu. `onVorlage` öffnet den
 * Vorlage-Dialog der Akte aus dem gesperrten Eingabefeld (Fenster zu).
 *
 * Die Inbox (Plan 6, Entscheidung 8) nutzt dasselbe Panel mit eigenem Kopf
 * (`titel`, `unterzeile`, `kopfRechts`), ohne Ansichtswahl (`ohneAnsichten`),
 * ohne Platz fürs Dock (`ohneDock`), mit Schnellaktionen zwischen Entwurf und
 * Eingabefeld und mit `dealId` null für Gespräche ohne Deal. Ohne diese Props
 * sieht die Akte aus wie zuvor.
 */
export function GespraechPanel({
  dealId,
  gespraech,
  kundeName,
  onNeuLaden,
  onVorlage,
  titel = "Gespräch",
  unterzeile = "Alle Kanäle in einem Verlauf.",
  kopfRechts,
  ohneAnsichten = false,
  ohneDock = false,
  schnellaktionen,
  griff,
}: {
  /** Null für ein Gespräch ohne Deal: keine Ansichten, kein „WhatsApp starten“. */
  dealId: string | null;
  gespraech: Gespraech;
  kundeName: string;
  /** Lädt die Akte neu und liefert das frische Gespräch (null bei Fehler). */
  onNeuLaden: () => Promise<Gespraech | null>;
  onVorlage?: () => void;
  titel?: string;
  unterzeile?: string;
  /** Rechts im Kopf, etwa „Akte öffnen“ in der Inbox. */
  kopfRechts?: ReactNode;
  /** Keine Umschaltung Chat, Fotos, Dokumente, Notizen. */
  ohneAnsichten?: boolean;
  /** Kein 84-px-Platz unten fürs Dock der Akte. */
  ohneDock?: boolean;
  /** Zwischen Entwurf-Karte und Eingabefeld, nur in der Ansicht „Chat“. */
  schnellaktionen?: ReactNode;
  griff?: Ref<GespraechPanelGriff>;
}) {
  const nurChat = ohneAnsichten || dealId === null;
  const [ansicht, setAnsicht] = useState<Ansicht>("chat");
  const [gewaehltId, setGewaehltId] = useState<string | null>(gespraech.vorauswahl);
  const [text, setText] = useState("");
  const [foto, setFoto] = useState<Foto | null>(null);
  const [transkript, setTranskript] = useState<Anruf | null>(null);
  // Zählt eigene Aktionen (Senden, Freigeben): danach springt der Verlauf ans Ende.
  const [sprung, setSprung] = useState(0);
  const portalZiel = usePortalZiel();
  const feldRef = useRef<HTMLTextAreaElement | null>(null);

  // Fällt das gewählte Gespräch nach einem Neuladen weg (oder kam das erste
  // sendefähige gerade erst dazu), greift wieder die Vorauswahl.
  useEffect(() => {
    setGewaehltId((aktuell) =>
      aktuell && gespraech.kanaele.some((k) => k.gespraechId === aktuell && k.kannSenden) ? aktuell : gespraech.vorauswahl
    );
  }, [gespraech]);

  const chips = useMemo(() => {
    const vorhanden = new Set(gespraech.kanaele.map((k) => k.kanal));
    const liste: { key: string; kanal: string; label: string }[] = KANAL_REIHE.filter((k) => vorhanden.has(k)).map(
      (k) => ({ key: k, kanal: k, label: KANAL_LABEL[k] })
    );
    const anrufe = gespraech.eintraege.filter((e) => e.art === "anruf").length;
    if (anrufe > 0) liste.push({ key: "anruf", kanal: "anruf", label: anrufe === 1 ? "1 Anruf" : `${anrufe} Anrufe` });
    return liste;
  }, [gespraech]);

  const fokussieren = useCallback(() => {
    window.requestAnimationFrame(() => feldRef.current?.focus());
  }, []);

  function uebernehmen(entwurf: string) {
    setText(entwurf);
    setAnsicht("chat");
    fokussieren();
  }

  useImperativeHandle(
    griff,
    () => ({
      einfuegen: (baustein: string) => {
        setText((alt) => textAnhaengen(alt, baustein));
        setAnsicht("chat");
        fokussieren();
      },
      fokussieren,
      waehlen: (gespraechId: string) => setGewaehltId(gespraechId),
    }),
    [fokussieren]
  );

  /** Nach Senden oder Freigeben: Verlauf ans Ende, dann neu laden. */
  const nachEigenerAktion = useCallback(() => {
    setSprung((s) => s + 1);
    return onNeuLaden();
  }, [onNeuLaden]);

  const chat = nurChat || ansicht === "chat";

  return (
    <GlassPanel variant="panel" className="akte-panel akte-gespraech-panel" data-ohne-dock={ohneDock || undefined}>
      <div className="akte-panel-kopf akte-gespraech-kopf">
        <div className="akte-gespraech-kopf-text">
          <h2 className="akte-panel-titel">{titel}</h2>
          {unterzeile ? <p className="akte-panel-unter">{unterzeile}</p> : null}
        </div>
        <div className="akte-gespraech-chips">
          {chips.map((c) => (
            <span key={c.key} className="akte-gespraech-chip">
              <i className="akte-gespraech-punkt" data-kanal={c.kanal} aria-hidden="true" />
              {c.label}
            </span>
          ))}
          {nurChat ? null : (
            <GlassSegmentedControl
              value={ansicht}
              onValueChange={(w) => setAnsicht(w as Ansicht)}
              aria-label="Ansicht"
              className="akte-gespraech-seg"
            >
              {ANSICHTEN.map((a) => (
                <GlassSegmentedControlItem key={a.wert} value={a.wert}>
                  {a.label}
                </GlassSegmentedControlItem>
              ))}
            </GlassSegmentedControl>
          )}
          {kopfRechts}
        </div>
      </div>

      {chat ? (
        <>
          <GespraechVerlauf
            eintraege={gespraech.eintraege}
            kanaele={gespraech.kanaele}
            sprung={sprung}
            onFoto={setFoto}
            onTranskript={setTranskript}
          />
          <div className="akte-gespraech-fuss">
            <EntwurfKarte
              gespraechId={gewaehltId}
              aktualisierung={gespraech}
              fensterZu={fensterZu(gespraech.kanaele.find((k) => k.gespraechId === gewaehltId))}
              onUebernehmen={uebernehmen}
              onGesendet={nachEigenerAktion}
            />
            {schnellaktionen}
            <Eingabe
              dealId={dealId}
              kanaele={gespraech.kanaele}
              gewaehltId={gewaehltId}
              onWaehlen={setGewaehltId}
              kundeName={kundeName}
              text={text}
              onText={setText}
              feldRef={feldRef}
              onGesendet={nachEigenerAktion}
              onVorlage={onVorlage}
            />
          </div>
          <FotoVollbild foto={foto} onClose={() => setFoto(null)} />
          {transkript ? (
            <TranskriptDialog
              anruf={vorschauAus(transkript, kundeName)}
              portalZiel={portalZiel}
              akteLink={false}
              onSchliessen={() => setTranskript(null)}
            />
          ) : null}
        </>
      ) : null}
      {!chat && dealId && ansicht === "fotos" ? <FotosAnsicht dealId={dealId} /> : null}
      {!chat && dealId && ansicht === "dokumente" ? <DokumenteAnsicht dealId={dealId} /> : null}
      {!chat && dealId && ansicht === "notizen" ? <NotizenAnsicht dealId={dealId} /> : null}
    </GlassPanel>
  );
}
