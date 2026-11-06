"use client";

import "@/styles/neu-akte-dock.css";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import { BEWERTUNGSLINK_PLATZHALTER } from "@/lib/reviews/manuell";
import { apiAufruf, jsonAufruf } from "./api";
import { bewertungFehlerText } from "./dialog-texte";

interface Vorschau {
  text: string;
  kanal: string | null;
  einwilligung: boolean;
  sperre: string | null;
}

/** Sperrgründe der Vorschau (`GET /review-request`, `sperre`) als kurze deutsche Texte. */
export const BEWERTUNG_TEXT: Record<string, string> = {
  STUFE: "Erst ab Durchgeführt.",
  KEIN_LINK: "Für diese Firma ist kein Google-Bewertungslink hinterlegt.",
  SPERRE: "Der Kunde möchte keine Nachrichten mehr.",
  KEIN_KANAL: "Kein WhatsApp-Gespräch mit diesem Kunden.",
  FENSTER: "24-Stunden-Fenster zu.",
  RUHEZEIT: "Ruhezeit. Bitte Mo bis Sa zwischen 9 und 19 Uhr senden.",
  SCHON_GESENDET: "Schon angefragt.",
  EMPFAENGER: "Der WhatsApp-Kontakt ist keiner Person am Deal zugeordnet. Bitte den Kontakt im Posteingang mit der Person verknüpfen.",
  EINWILLIGUNG: "Keine verknüpfte Person am Deal. Bitte in der alten Akte eine Person verknüpfen.",
};

type Zustand = { art: "laden" } | { art: "fehler"; meldung: string } | { art: "fertig"; vorschau: Vorschau };

/**
 * Bewertung anfragen (Entscheidung 9): Vorschau-Text (änderbar, der
 * Platzhalter für den Link muss bleiben), Kanal, Sperrgrund je Code. Ohne
 * Einwilligung im Ledger ist das Feld „Wie und wann hat der Kunde zugestimmt?“
 * Pflicht; es wird mit Autor und heutigem Datum gespeichert. Senden über
 * `POST /review-request`; Fehler zeigen die deutsche Meldung des Servers
 * (`KONFIGURATION` ohne den Namen der Variable). `VERSAND_UNKLAR` und
 * `SCHON_GESENDET` laden die Akte neu, weil die Sperre für den Deal dann
 * steht; nach `VERSAND_UNKLAR` bleibt Senden bis zum nächsten Öffnen gesperrt.
 */
export function BewertungDialog({
  dealId,
  portalZiel,
  onSchliessen,
  onNeuLaden,
}: {
  dealId: string;
  portalZiel: HTMLElement | undefined;
  onSchliessen: () => void;
  onNeuLaden: () => Promise<void> | void;
}) {
  const [zustand, setZustand] = useState<Zustand>({ art: "laden" });
  const [text, setText] = useState("");
  const [einwilligung, setEinwilligung] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [sendet, setSendet] = useState(false);
  const [versandUnklar, setVersandUnklar] = useState(false);

  useEffect(() => {
    let aktuell = true;
    void apiAufruf<Vorschau>(`/api/v1/deals/${dealId}/review-request`).then((r) => {
      if (!aktuell) return;
      if (r.ok) {
        setZustand({ art: "fertig", vorschau: r.data });
        setText(r.data.text);
      } else {
        setZustand({ art: "fehler", meldung: r.message });
      }
    });
    return () => {
      aktuell = false;
    };
  }, [dealId]);

  const vorschau = zustand.art === "fertig" ? zustand.vorschau : null;
  const gesperrt = vorschau?.sperre ?? null;
  const einwilligungNoetig = vorschau !== null && !vorschau.einwilligung;

  async function senden(e: React.FormEvent) {
    e.preventDefault();
    if (!vorschau) return;
    if (!text.includes(BEWERTUNGSLINK_PLATZHALTER)) return setFehler(`Der Text muss den Platzhalter ${BEWERTUNGSLINK_PLATZHALTER} enthalten.`);
    if (einwilligungNoetig && !einwilligung.trim()) return setFehler("Bitte eintragen, wie und wann der Kunde zugestimmt hat.");
    setFehler(null);
    setSendet(true);
    const r = await apiAufruf<{ gesendet: boolean; gespraechId: string }>(
      `/api/v1/deals/${dealId}/review-request`,
      jsonAufruf("POST", {
        ...(text !== vorschau.text ? { text } : {}),
        ...(einwilligungNoetig ? { einwilligung: einwilligung.trim() } : {}),
      })
    );
    setSendet(false);
    if (r.ok) {
      toast.success("Bewertung angefragt.");
      await onNeuLaden();
      onSchliessen();
      return;
    }
    setFehler(bewertungFehlerText(r.code, r.message));
    if (r.code === "VERSAND_UNKLAR") setVersandUnklar(true);
    if (r.code === "VERSAND_UNKLAR" || r.code === "SCHON_GESENDET") await onNeuLaden();
  }

  return (
    <GlassDialog open onOpenChange={(offen) => !offen && !sendet && onSchliessen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen">
        <GlassDialogTitle className="akte-dialog-titel">Bewertung anfragen</GlassDialogTitle>
        <GlassDialogDescription className="akte-dialog-text">
          Eine Nachricht per WhatsApp mit dem Link zur Google-Bewertung. Der Kunde muss vorher ausdrücklich zugestimmt haben.
        </GlassDialogDescription>

        {zustand.art === "laden" ? <p className="akte-dialog-leer">Vorschau wird geladen …</p> : null}
        {zustand.art === "fehler" ? <p className="akte-dialog-fehler">{zustand.meldung}</p> : null}

        {vorschau ? (
          <form onSubmit={(e) => void senden(e)}>
            <p className="akte-dialog-info">
              Kanal: <b>{vorschau.kanal ? `WhatsApp · ${vorschau.kanal}` : "kein WhatsApp-Gespräch"}</b>
              {" · "}
              Einwilligung: <b>{vorschau.einwilligung ? "liegt vor" : "noch nicht gespeichert"}</b>
            </p>
            {gesperrt ? (
              <p className="akte-dialog-sperre" role="status">
                {BEWERTUNG_TEXT[gesperrt] ?? gesperrt}
              </p>
            ) : null}
            <label className="akte-dialog-feld">
              Nachricht
              <textarea
                className="lg-input lg-textarea"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={8}
                disabled={gesperrt !== null}
              />
              <span className="akte-dialog-hilfe">{BEWERTUNGSLINK_PLATZHALTER} wird beim Senden durch den Link ersetzt.</span>
            </label>
            {einwilligungNoetig ? (
              <label className="akte-dialog-feld">
                Wie und wann hat der Kunde zugestimmt?
                <textarea
                  className="lg-input lg-textarea"
                  value={einwilligung}
                  onChange={(e) => setEinwilligung(e.target.value)}
                  rows={2}
                  maxLength={1000}
                  placeholder="Etwa: telefonisch am 05.11., Kunde bat um den Link"
                  disabled={gesperrt !== null}
                  required
                />
                <span className="akte-dialog-hilfe">Wird mit deinem Namen und dem heutigen Datum gespeichert.</span>
              </label>
            ) : null}
            {fehler ? <p className="akte-dialog-fehler">{fehler}</p> : null}
            <div className="akte-dialog-knoepfe">
              <GlassButton type="button" variant="ghost" onClick={onSchliessen} disabled={sendet}>
                Abbrechen
              </GlassButton>
              <GlassButton type="submit" disabled={sendet || gesperrt !== null || versandUnklar}>
                {sendet ? "Sendet" : "Senden"}
              </GlassButton>
            </div>
          </form>
        ) : null}
      </GlassDialogContent>
    </GlassDialog>
  );
}
