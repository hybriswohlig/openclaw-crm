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
import {
  GlassSelect,
  GlassSelectContent,
  GlassSelectItem,
  GlassSelectTrigger,
  GlassSelectValue,
} from "@/components/glassyui/glass-select";
import type { GespraechKanal } from "@/services/gespraech";
import type { WhatsAppTemplate } from "@/services/inbox-whatsapp";
import { apiAufruf, jsonAufruf } from "./api";
import { vorlageFehlerText } from "./dialog-texte";

type Vorlagen = { art: "laden" } | { art: "fehler"; meldung: string } | { art: "fertig"; liste: WhatsAppTemplate[] };

const schluessel = (t: Pick<WhatsAppTemplate, "name" | "language">) => `${t.name}|${t.language}`;

/**
 * WhatsApp-Vorlage über das WABA-Konto des Gesprächs senden (außerhalb des
 * 24-Stunden-Fensters der einzige Weg). Vorlagen kommen live von Meta
 * (`GET /inbox/channel-accounts/{kontoId}/templates`), nur freigegebene;
 * je `{{n}}` im Text ein Feld. Senden über `POST /inbox/whatsapp/send-template`
 * mit `dealRecordId`, danach lädt die Akte neu. Die Auswahl läuft über das
 * Gespräch (`gespraechId`), nicht über das Konto: zwei Gespräche können auf
 * demselben Konto liegen. Englische Fehler der Routen werden übersetzt.
 */
export function VorlageDialog({
  dealId,
  kanaele,
  portalZiel,
  onSchliessen,
  onNeuLaden,
}: {
  /** Null für ein WABA-Gespräch ohne Deal (Inbox, Plan 6); die Route nimmt `dealRecordId: null`. */
  dealId: string | null;
  /** Direkt verknüpfte WABA-Gespräche des Deals. */
  kanaele: GespraechKanal[];
  portalZiel: HTMLElement | undefined;
  onSchliessen: () => void;
  onNeuLaden: () => Promise<void> | void;
}) {
  const [gespraechId, setGespraechId] = useState(kanaele[0]?.gespraechId ?? "");
  const [vorlagen, setVorlagen] = useState<Vorlagen>({ art: "laden" });
  const [gewaehlt, setGewaehlt] = useState("");
  const [variablen, setVariablen] = useState<string[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [sendet, setSendet] = useState(false);

  const kanal = kanaele.find((k) => k.gespraechId === gespraechId) ?? null;
  const kontoId = kanal?.kontoId ?? null;

  useEffect(() => {
    if (!kontoId) return;
    let aktuell = true;
    setVorlagen({ art: "laden" });
    setGewaehlt("");
    setVariablen([]);
    void apiAufruf<WhatsAppTemplate[]>(`/api/v1/inbox/channel-accounts/${kontoId}/templates`).then((r) => {
      if (!aktuell) return;
      if (r.ok) setVorlagen({ art: "fertig", liste: (r.data ?? []).filter((t) => t.status === "APPROVED") });
      else setVorlagen({ art: "fehler", meldung: vorlageFehlerText(r.message) });
    });
    return () => {
      aktuell = false;
    };
  }, [kontoId]);

  const liste = vorlagen.art === "fertig" ? vorlagen.liste : [];
  const vorlage = liste.find((t) => schluessel(t) === gewaehlt) ?? null;
  const text = vorlage?.components.find((c) => c.type === "BODY")?.text ?? "";

  function waehlen(key: string) {
    setGewaehlt(key);
    const t = liste.find((x) => schluessel(x) === key);
    setVariablen(Array.from({ length: t?.bodyVariableCount ?? 0 }, () => ""));
    setFehler(null);
  }

  const sendbar = kanal !== null && kanal.telefon !== null && vorlage !== null && variablen.every((v) => v.trim() !== "");

  async function senden(e: React.FormEvent) {
    e.preventDefault();
    if (!kanal || !vorlage) return;
    if (!kanal.telefon) return setFehler("Keine Telefonnummer am Gespräch.");
    if (!variablen.every((v) => v.trim() !== "")) return setFehler("Bitte alle Variablen ausfüllen.");
    setFehler(null);
    setSendet(true);
    const r = await apiAufruf<{ conversationId: string }>(
      "/api/v1/inbox/whatsapp/send-template",
      jsonAufruf("POST", {
        channelAccountId: kanal.kontoId,
        toPhone: kanal.telefon,
        customerName: kanal.kundeName ?? "",
        templateName: vorlage.name,
        languageCode: vorlage.language,
        bodyParams: variablen.map((v) => v.trim()),
        dealRecordId: dealId,
      })
    );
    setSendet(false);
    if (!r.ok) return setFehler(vorlageFehlerText(r.message));
    toast.success("Vorlage gesendet.");
    await onNeuLaden();
    onSchliessen();
  }

  return (
    <GlassDialog open onOpenChange={(offen) => !offen && !sendet && onSchliessen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen">
        <GlassDialogTitle className="akte-dialog-titel">Vorlage senden</GlassDialogTitle>
        <GlassDialogDescription className="akte-dialog-text">
          Freigegebene WhatsApp-Vorlage des Kontos, auch außerhalb des 24-Stunden-Fensters.
        </GlassDialogDescription>
        <form onSubmit={(e) => void senden(e)}>
          {kanaele.length > 1 ? (
            <label className="akte-dialog-feld">
              Konto
              <GlassSelect value={gespraechId} onValueChange={setGespraechId}>
                <GlassSelectTrigger aria-label="WhatsApp-Gespräch">
                  <GlassSelectValue placeholder="Auswählen" />
                </GlassSelectTrigger>
                <GlassSelectContent>
                  {kanaele.map((k) => (
                    <GlassSelectItem key={k.gespraechId} value={k.gespraechId}>
                      {k.name}
                      {k.telefon ? ` · ${k.telefon}` : ""}
                    </GlassSelectItem>
                  ))}
                </GlassSelectContent>
              </GlassSelect>
            </label>
          ) : null}
          <p className="akte-dialog-info">
            An: <b>{kanal?.kundeName ?? "Kunde"}</b>
            {" · "}
            {kanal?.telefon ?? "keine Telefonnummer"}
            {kanaele.length === 1 && kanal ? ` · über ${kanal.name}` : ""}
          </p>

          {vorlagen.art === "laden" ? <p className="akte-dialog-leer">Vorlagen werden geladen …</p> : null}
          {vorlagen.art === "fehler" ? <p className="akte-dialog-fehler">Vorlagen konnten nicht geladen werden. {vorlagen.meldung}</p> : null}
          {vorlagen.art === "fertig" && liste.length === 0 ? <p className="akte-dialog-leer">Keine freigegebenen Vorlagen für dieses Konto.</p> : null}

          {liste.length > 0 ? (
            <label className="akte-dialog-feld">
              Vorlage
              <GlassSelect value={gewaehlt} onValueChange={waehlen}>
                <GlassSelectTrigger aria-label="Vorlage">
                  <GlassSelectValue placeholder="Auswählen" />
                </GlassSelectTrigger>
                <GlassSelectContent>
                  {liste.map((t) => (
                    <GlassSelectItem key={schluessel(t)} value={schluessel(t)}>
                      {t.name} · {t.language}
                    </GlassSelectItem>
                  ))}
                </GlassSelectContent>
              </GlassSelect>
            </label>
          ) : null}

          {vorlage ? (
            <>
              {text ? <p className="akte-vorlage-text">{text}</p> : null}
              {variablen.map((wert, i) => (
                <label key={i} className="akte-dialog-feld">
                  {`Variable {{${i + 1}}}`}
                  <input
                    className="lg-input"
                    type="text"
                    value={wert}
                    onChange={(e) => setVariablen((alt) => alt.map((v, j) => (j === i ? e.target.value : v)))}
                    required
                  />
                </label>
              ))}
            </>
          ) : null}

          {fehler ? <p className="akte-dialog-fehler">{fehler}</p> : null}
          <div className="akte-dialog-knoepfe">
            <GlassButton type="button" variant="ghost" onClick={onSchliessen} disabled={sendet}>
              Abbrechen
            </GlassButton>
            <GlassButton type="submit" disabled={sendet || !sendbar}>
              {sendet ? "Sendet" : "Senden"}
            </GlassButton>
          </div>
        </form>
      </GlassDialogContent>
    </GlassDialog>
  );
}
