"use client";

import "@/styles/neu-akte-dock.css";

import { useId, useState } from "react";
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
import { euroText } from "@/lib/anzeige";
import { GRUND_MIN_ZEICHEN, type ZahlungZeileAkte } from "@/lib/geld";
import { eurosToCents } from "@/lib/work-ui";
import { ZAHLUNGSART_LABEL, type Zahlungsart } from "@/lib/zahlungsart";
import { geldFehlerText, grundReicht } from "@/components/neu/kasse/kasse-logik";
import { apiAufruf, jsonAufruf } from "./api";

const ARTEN = ["bank_transfer", "paypal", "cash", "card"] as const satisfies readonly Zahlungsart[];
type Art = (typeof ARTEN)[number];

function alsArt(a: Zahlungsart | null): Art {
  return a && (ARTEN as readonly string[]).includes(a) ? (a as Art) : "bank_transfer";
}

/**
 * Zahlung bearbeiten oder korrigieren (Plan 9, Entscheidung 8), ein Dialog in
 * zwei Arten. „Bearbeiten“ ändert Datum, Art und Notiz (`PUT`). „Korrigieren“
 * ändert Betrag oder Kaution: Storno der alten Zahlung und neue Zahlung in
 * einer Transaktion (`POST …/korrektur`), mit Pflichtgrund.
 */
export function ZahlungBearbeitenDialog({
  dealId,
  zahlung: z,
  art: modus,
  portalZiel,
  onSchliessen,
  onNeuLaden,
}: {
  dealId: string;
  zahlung: ZahlungZeileAkte;
  art: "bearbeiten" | "korrigieren";
  portalZiel: HTMLElement | undefined;
  onSchliessen: () => void;
  onNeuLaden: () => Promise<void> | void;
}) {
  const id = useId();
  const korrigieren = modus === "korrigieren";
  const [datum, setDatum] = useState(z.date);
  const [betrag, setBetrag] = useState(() => (Math.abs(z.cent) / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 }));
  const [art, setArt] = useState<Art>(alsArt(z.art));
  const [kaution, setKaution] = useState(z.kaution);
  const [notiz, setNotiz] = useState(z.notiz ?? "");
  const [grund, setGrund] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  async function speichern(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return setFehler("Bitte ein Datum wählen.");
    setFehler(null);
    let r;
    if (korrigieren) {
      const cent = eurosToCents(betrag);
      if (cent === null || cent <= 0) return setFehler("Bitte einen Betrag größer 0 eingeben, etwa 1.980,00.");
      if (!grundReicht(grund)) return setFehler(`Bitte einen Grund mit mindestens ${GRUND_MIN_ZEICHEN} Zeichen angeben.`);
      setLaeuft(true);
      r = await apiAufruf(
        `/api/v1/deals/${dealId}/payments/${z.id}/korrektur`,
        jsonAufruf("POST", { date: datum, amountCent: cent, paymentMethod: art, kaution, notes: notiz.trim() || null, grund: grund.trim() })
      );
    } else {
      setLaeuft(true);
      r = await apiAufruf(
        `/api/v1/deals/${dealId}/payments/${z.id}`,
        jsonAufruf("PUT", { date: datum, paymentMethod: art, notes: notiz.trim() || null })
      );
    }
    setLaeuft(false);
    if (!r.ok) return setFehler(geldFehlerText(r.code, r.message));
    toast.success(korrigieren ? "Zahlung korrigiert." : "Zahlung geändert.");
    await onNeuLaden();
    onSchliessen();
  }

  return (
    <GlassDialog open onOpenChange={(o) => !o && !laeuft && onSchliessen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen">
        <GlassDialogTitle className="akte-dialog-titel">{korrigieren ? "Zahlung korrigieren" : "Zahlung bearbeiten"}</GlassDialogTitle>
        <GlassDialogDescription className="akte-dialog-text">
          {korrigieren
            ? `Die Zahlung über ${euroText(z.cent)} wird storniert und neu gebucht. Beide Buchungen bleiben sichtbar.`
            : "Betrag und Kaution ändern sich nur über „Korrigieren“."}
        </GlassDialogDescription>
        <form onSubmit={(e) => void speichern(e)}>
          <div className="akte-dialog-zeile">
            <label className="akte-dialog-feld">
              Datum
              <input className="lg-input" type="date" value={datum} onChange={(e) => setDatum(e.target.value)} required />
            </label>
            {korrigieren ? (
              <label className="akte-dialog-feld">
                Betrag in Euro
                <input
                  className="lg-input"
                  type="text"
                  inputMode="decimal"
                  value={betrag}
                  onChange={(e) => setBetrag(e.target.value)}
                  autoComplete="off"
                />
              </label>
            ) : null}
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
          {korrigieren ? (
            <label className="akte-dialog-schalter">
              <GlassSwitch size="sm" checked={kaution} onCheckedChange={setKaution} />
              Kaution (nicht steuerbar, zählt nicht zum Preis)
            </label>
          ) : null}
          <label className="akte-dialog-feld">
            Notiz
            <textarea className="lg-input lg-textarea" value={notiz} onChange={(e) => setNotiz(e.target.value)} rows={2} placeholder="Optional" />
          </label>
          {korrigieren ? (
            <label className="akte-dialog-feld">
              Grund der Korrektur
              <textarea
                className="lg-input lg-textarea"
                value={grund}
                onChange={(e) => setGrund(e.target.value)}
                rows={2}
                placeholder="Zum Beispiel: Betrag vertippt"
                required
              />
            </label>
          ) : null}
          {fehler ? (
            <p className="akte-dialog-fehler" role="alert">
              {fehler}
            </p>
          ) : null}
          <div className="akte-dialog-knoepfe">
            <GlassButton type="button" variant="ghost" onClick={onSchliessen} disabled={laeuft}>
              Abbrechen
            </GlassButton>
            <GlassButton type="submit" disabled={laeuft}>
              {laeuft ? "Speichert" : korrigieren ? "Korrigieren" : "Speichern"}
            </GlassButton>
          </div>
        </form>
      </GlassDialogContent>
    </GlassDialog>
  );
}
