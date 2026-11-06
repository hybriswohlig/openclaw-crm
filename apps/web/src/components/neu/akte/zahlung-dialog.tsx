"use client";

import "@/styles/neu-akte-dock.css";

import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import { GlassSegmentedControl, GlassSegmentedControlItem } from "@/components/glassyui/glass-segmented-control";
import { GlassSwitch } from "@/components/glassyui/glass-switch";
import type { AkteDaten } from "@/lib/akte";
import { euroText, tagKurz } from "@/lib/anzeige";
import { berlinDateString } from "@/lib/berlin-date";
import { eurosToCents } from "@/lib/work-ui";
import { ZAHLUNGSART_LABEL, type Zahlungsart } from "@/lib/zahlungsart";
import type { Zahlungsmeldung } from "@/lib/zahlungsmeldungen";
import { apiAufruf, jsonAufruf } from "./api";
import { betragVorbelegung } from "./dialog-texte";
import { meldungBearbeiten } from "./zahlungsmeldung";

type Zahlung = AkteDaten["zahlung"];

/** Zahlungsarten im Dialog, in dieser Reihenfolge (Spec: Überweisung · PayPal · Bar · Karte). */
const ARTEN = ["bank_transfer", "paypal", "cash", "card"] as const satisfies readonly Zahlungsart[];
type Art = (typeof ARTEN)[number];

/** „Kunde meldet bezahlt · 500 € · Überweisung · Mo 10.11.“ */
export function meldungText(m: Zahlungsmeldung): string {
  return ["Kunde meldet bezahlt", euroText(m.betragCent), m.zahlungsart ? ZAHLUNGSART_LABEL[m.zahlungsart] : null, tagKurz(m.gemeldetAm)]
    .filter((t): t is string => typeof t === "string")
    .join(" · ");
}

/**
 * Zahlung erfassen: offene Meldungen oben in Gold mit Bestätigen und Verwerfen
 * (Entscheidung 6), darunter Datum (heute), Betrag (vorbelegt mit dem offenen
 * Rest, leer bei unbekanntem Rest), Zahlungsart, Schalter „Kaution“
 * (`taxTreatment: "nicht_steuerbar"`, Entscheidung 5) und Notiz. Speichern
 * schreibt über `POST /payments` wie die alte Finanzen-Ansicht und lädt die
 * Akte neu. Bestätigen und Verwerfen lassen den Dialog offen; die Liste
 * aktualisiert sich mit der neu geladenen Akte, und der Betrag folgt dem neuen
 * Rest, solange der Inhaber ihn nicht selbst geändert hat (sonst würde ein
 * zweites Speichern die bestätigte Zahlung doppelt buchen).
 */
export function ZahlungDialog({
  dealId,
  zahlung,
  portalZiel,
  onSchliessen,
  onNeuLaden,
}: {
  dealId: string;
  zahlung: Zahlung;
  portalZiel: HTMLElement | undefined;
  onSchliessen: () => void;
  onNeuLaden: () => Promise<void> | void;
}) {
  const id = useId();
  const [datum, setDatum] = useState(() => berlinDateString());
  const [betrag, setBetrag] = useState(() => betragVorbelegung(zahlung.restCent));
  const [betragBearbeitet, setBetragBearbeitet] = useState(false);
  const [art, setArt] = useState<Art>("bank_transfer");
  const [kaution, setKaution] = useState(false);
  const [notiz, setNotiz] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [speichert, setSpeichert] = useState(false);
  const [meldungLaeuft, setMeldungLaeuft] = useState<string | null>(null);
  const beschaeftigt = speichert || meldungLaeuft !== null;

  // Neuer Rest nach Bestätigen oder Verwerfen: Vorbelegung nachziehen, außer der Betrag wurde von Hand geändert.
  const restCent = zahlung.restCent;
  useEffect(() => {
    if (!betragBearbeitet) setBetrag(betragVorbelegung(restCent));
  }, [restCent, betragBearbeitet]);

  async function meldung(eventId: string, aktion: "bestaetigen" | "verwerfen") {
    setMeldungLaeuft(eventId);
    const { neuLaden } = await meldungBearbeiten(dealId, eventId, aktion);
    if (neuLaden) await onNeuLaden();
    setMeldungLaeuft(null);
  }

  async function speichern(e: React.FormEvent) {
    e.preventDefault();
    const cent = eurosToCents(betrag);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return setFehler("Bitte ein Datum wählen.");
    if (cent === null || cent <= 0) return setFehler("Bitte einen Betrag größer 0 eingeben, etwa 1.980,00.");
    setFehler(null);
    setSpeichert(true);
    const r = await apiAufruf<{ id: string }>(
      `/api/v1/deals/${dealId}/payments`,
      jsonAufruf("POST", {
        date: datum,
        amount: (cent / 100).toFixed(2),
        payer: null,
        paymentMethod: art,
        reference: null,
        notes: notiz.trim() || null,
        taxTreatment: kaution ? "nicht_steuerbar" : "betriebseinnahme",
      })
    );
    setSpeichert(false);
    if (!r.ok) return setFehler(r.message);
    toast.success(kaution ? "Kaution gespeichert." : "Zahlung gespeichert.");
    await onNeuLaden();
    onSchliessen();
  }

  return (
    <GlassDialog open onOpenChange={(offen) => !offen && !beschaeftigt && onSchliessen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen">
        <GlassDialogTitle className="akte-dialog-titel">Zahlung erfassen</GlassDialogTitle>
        <GlassDialogDescription className="akte-dialog-text">
          {zahlung.restCent === null
            ? "Offener Rest unbekannt (Stunden-KV oder kein Angebot)."
            : zahlung.restCent > 0
              ? `Offener Rest ${euroText(zahlung.restCent)}.`
              : "Kein offener Rest."}
        </GlassDialogDescription>

        {zahlung.meldungen.length > 0 ? (
          <ul className="akte-meldungen" aria-label="Offene Meldungen">
            {zahlung.meldungen.map((m) => {
              const laeuft = meldungLaeuft === m.eventId;
              return (
                <li key={m.eventId} className="akte-meldung">
                  <span>{meldungText(m)}</span>
                  <span className="akte-meldung-knoepfe">
                    <button
                      type="button"
                      className="akte-ablauf-knopf"
                      disabled={beschaeftigt}
                      aria-busy={laeuft || undefined}
                      onClick={() => void meldung(m.eventId, "bestaetigen")}
                    >
                      {laeuft ? "Läuft …" : "Bestätigen"}
                    </button>
                    <button
                      type="button"
                      className="akte-ablauf-knopf"
                      data-ton="grau"
                      disabled={beschaeftigt}
                      onClick={() => void meldung(m.eventId, "verwerfen")}
                    >
                      Verwerfen
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}

        <form onSubmit={(e) => void speichern(e)}>
          <div className="akte-dialog-zeile">
            <label className="akte-dialog-feld">
              Datum
              <input className="lg-input" type="date" value={datum} onChange={(e) => setDatum(e.target.value)} required />
            </label>
            <label className="akte-dialog-feld">
              Betrag in Euro
              <input
                className="lg-input"
                type="text"
                inputMode="decimal"
                value={betrag}
                onChange={(e) => {
                  setBetragBearbeitet(true);
                  setBetrag(e.target.value);
                }}
                placeholder="0,00"
                autoComplete="off"
              />
            </label>
          </div>
          <div className="akte-dialog-feld">
            <span id={`${id}-art`}>Zahlungsart</span>
            <GlassSegmentedControl value={art} onValueChange={(v) => setArt(v as Art)} aria-labelledby={`${id}-art`}>
              {ARTEN.map((a) => (
                <GlassSegmentedControlItem key={a} value={a}>
                  {ZAHLUNGSART_LABEL[a]}
                </GlassSegmentedControlItem>
              ))}
            </GlassSegmentedControl>
          </div>
          <label className="akte-dialog-schalter">
            <GlassSwitch size="sm" checked={kaution} onCheckedChange={setKaution} />
            Kaution (nicht steuerbar, zählt nicht zum Preis)
          </label>
          <label className="akte-dialog-feld">
            Notiz
            <textarea className="lg-input lg-textarea" value={notiz} onChange={(e) => setNotiz(e.target.value)} rows={2} placeholder="Optional" />
          </label>
          {fehler ? <p className="akte-dialog-fehler">{fehler}</p> : null}
          <div className="akte-dialog-knoepfe">
            <GlassButton type="button" variant="ghost" onClick={onSchliessen} disabled={beschaeftigt}>
              Abbrechen
            </GlassButton>
            <GlassButton type="submit" disabled={beschaeftigt}>
              {speichert ? "Speichert" : "Speichern"}
            </GlassButton>
          </div>
        </form>
      </GlassDialogContent>
    </GlassDialog>
  );
}
