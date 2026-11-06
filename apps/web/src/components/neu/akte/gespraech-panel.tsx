"use client";

import "@/styles/neu-akte-gespraech.css";

import { useEffect, useMemo, useRef, useState } from "react";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { GlassSegmentedControl, GlassSegmentedControlItem } from "@/components/glassyui/glass-segmented-control";
import type { GespraechKanalArt } from "@/lib/gespraech";
import type { Gespraech } from "@/services/gespraech";
import { DokumenteAnsicht } from "./dokumente-ansicht";
import { Eingabe } from "./eingabe";
import { EntwurfKarte } from "./entwurf-karte";
import { FotosAnsicht, FotoVollbild, type Foto } from "./fotos-ansicht";
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

/**
 * Das Gespräch-Panel der Akte (Spec 3.3): Kopf mit Kanal-Chips und
 * Ansichtswahl, dann Verlauf mit Entwurf-Karte und Eingabefeld, oder Fotos,
 * Dokumente, Notizen. Das Dock (Task 14) bekommt unten Platz. Nach jedem
 * Senden oder Freigeben lädt `onNeuLaden` die Akte neu.
 */
export function GespraechPanel({
  dealId,
  gespraech,
  kundeName,
  onNeuLaden,
}: {
  dealId: string;
  gespraech: Gespraech;
  kundeName: string;
  onNeuLaden: () => Promise<void> | void;
}) {
  const [ansicht, setAnsicht] = useState<Ansicht>("chat");
  const [gewaehltId, setGewaehltId] = useState<string | null>(gespraech.vorauswahl);
  const [text, setText] = useState("");
  const [foto, setFoto] = useState<Foto | null>(null);
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

  function uebernehmen(entwurf: string) {
    setText(entwurf);
    setAnsicht("chat");
    window.requestAnimationFrame(() => feldRef.current?.focus());
  }

  return (
    <GlassPanel variant="panel" className="akte-panel akte-gespraech-panel">
      <div className="akte-panel-kopf akte-gespraech-kopf">
        <div>
          <h2 className="akte-panel-titel">Gespräch</h2>
          <p className="akte-panel-unter">Alle Kanäle in einem Verlauf.</p>
        </div>
        <div className="akte-gespraech-chips">
          {chips.map((c) => (
            <span key={c.key} className="akte-gespraech-chip">
              <i className="akte-gespraech-punkt" data-kanal={c.kanal} aria-hidden="true" />
              {c.label}
            </span>
          ))}
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
        </div>
      </div>

      {ansicht === "chat" ? (
        <>
          <GespraechVerlauf eintraege={gespraech.eintraege} kanaele={gespraech.kanaele} onFoto={setFoto} />
          <div className="akte-gespraech-fuss">
            <EntwurfKarte
              gespraechId={gewaehltId}
              aktualisierung={gespraech}
              onUebernehmen={uebernehmen}
              onGesendet={onNeuLaden}
            />
            <Eingabe
              dealId={dealId}
              kanaele={gespraech.kanaele}
              gewaehltId={gewaehltId}
              onWaehlen={setGewaehltId}
              kundeName={kundeName}
              text={text}
              onText={setText}
              feldRef={feldRef}
              onGesendet={onNeuLaden}
            />
          </div>
          <FotoVollbild foto={foto} onClose={() => setFoto(null)} />
        </>
      ) : null}
      {ansicht === "fotos" ? <FotosAnsicht dealId={dealId} /> : null}
      {ansicht === "dokumente" ? <DokumenteAnsicht dealId={dealId} /> : null}
      {ansicht === "notizen" ? <NotizenAnsicht dealId={dealId} /> : null}
    </GlassPanel>
  );
}
