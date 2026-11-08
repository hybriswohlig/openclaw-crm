"use client";

import "@/styles/neu-akte-dock.css";
import "@/styles/neu-kasse.css";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import { euroText, tagKurz } from "@/lib/anzeige";
import type { RechnungsVorschlag } from "@/lib/geld";
import { eurosToCents } from "@/lib/work-ui";
import { geldFehlerText, rechnungBetrag, rechnungSchritt, rechnungZeile } from "@/components/neu/kasse/kasse-logik";
import { apiAufruf, jsonAufruf } from "./api";
import { StornoDialog } from "./storno-dialog";

export interface RechnungsEingabe {
  bruttoCent: number;
  abweichungGrund?: string;
}

type Zustand = { art: "laden" } | { art: "fehler"; meldung: string } | { art: "bereit"; v: RechnungsVorschlag };

/** „1.980,00“ für das Eingabefeld. */
function centAlsEingabe(cent: number | null): string {
  return cent == null ? "" : (cent / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Rechnungsschritt (Plan 9, Entscheidung 17) vor dem Dokumentdialog: Betrag
 * (Festpreis schreibgeschützt; Stunden-KV vorbelegt aus den gestempelten
 * Stunden, änderbar, mit Grundlage), Fälligkeit als Vorschau, bei Abweichung
 * vom angenommenen Betrag ein Pflichtgrund. Gibt es schon eine Rechnung, steht
 * sie hier mit „Stornieren“. „Weiter“ reicht Betrag und Grund an den
 * Dokumentdialog; geprüft wird erst auf dem Server.
 */
export function RechnungDialog({
  dealId,
  portalZiel,
  onWeiter,
  onSchliessen,
  onGeaendert,
}: {
  dealId: string;
  portalZiel: HTMLElement | undefined;
  onWeiter: (r: RechnungsEingabe) => void;
  onSchliessen: () => void;
  /** Nach einem Storno: Akte, Heute oder Kasse neu laden. */
  onGeaendert?: () => Promise<void> | void;
}) {
  const [zustand, setZustand] = useState<Zustand>({ art: "laden" });
  const [betrag, setBetrag] = useState("");
  const [grund, setGrund] = useState("");
  const [storno, setStorno] = useState(false);

  const laden = useCallback(async () => {
    setZustand({ art: "laden" });
    const r = await apiAufruf<RechnungsVorschlag>(`/api/v1/deals/${dealId}/invoices/vorschlag`);
    if (!r.ok) return setZustand({ art: "fehler", meldung: r.message });
    setZustand({ art: "bereit", v: r.data });
    setBetrag(centAlsEingabe(r.data.istStunden ? r.data.stunden?.bruttoCent ?? null : r.data.bruttoCent));
  }, [dealId]);

  useEffect(() => {
    void laden();
  }, [laden]);

  if (storno && zustand.art === "bereit" && zustand.v.aktiveRechnung) {
    const alt = zustand.v.aktiveRechnung;
    return (
      <StornoDialog
        titel={`${alt.nummer ?? "Rechnung"} stornieren?`}
        text="Die Rechnung verschwindet aus dem Kundenportal, das PDF bleibt im CRM. Danach lässt sich eine neue Rechnung erstellen."
        portalZiel={portalZiel}
        onSchliessen={() => setStorno(false)}
        onBestaetigen={async (g) => {
          const r = await apiAufruf(`/api/v1/deals/${dealId}/invoices/${alt.id}/storno`, jsonAufruf("POST", { grund: g }));
          if (!r.ok) return geldFehlerText(r.code, r.message);
          toast.success("Rechnung storniert.");
          setStorno(false);
          await onGeaendert?.();
          await laden();
          return null;
        }}
      />
    );
  }

  const v = zustand.art === "bereit" ? zustand.v : null;
  const eingabeCent = eurosToCents(betrag);
  const schritt = v ? rechnungSchritt(v, { betragCent: eingabeCent, grund }) : null;

  return (
    <GlassDialog open onOpenChange={(o) => !o && onSchliessen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen">
        <GlassDialogTitle className="akte-dialog-titel">Rechnung</GlassDialogTitle>
        {zustand.art === "laden" ? <GlassDialogDescription className="akte-dialog-text">Wird geladen …</GlassDialogDescription> : null}
        {zustand.art === "fehler" ? (
          <GlassDialogDescription className="akte-dialog-fehler" role="alert">
            {zustand.meldung}
          </GlassDialogDescription>
        ) : null}
        {v && schritt ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const cent = rechnungBetrag(v, eingabeCent);
              if (!schritt.weiter || cent == null) return;
              onWeiter({ bruttoCent: cent, ...(schritt.grundNoetig ? { abweichungGrund: grund.trim() } : {}) });
            }}
          >
            <GlassDialogDescription className="akte-dialog-text">
              {v.istStunden
                ? "Stunden-KV: Betrag aus den gestempelten Stunden, bitte prüfen."
                : "Der Betrag kommt aus dem Angebot und steht so im PDF."}
            </GlassDialogDescription>

            {v.aktiveRechnung ? (
              <div className="geld-rechnung-alt">
                <span>{rechnungZeile(v.aktiveRechnung)}</span>
                {v.aktiveRechnung.status === "gestellt" ? (
                  <button type="button" className="akte-ablauf-knopf" onClick={() => setStorno(true)}>
                    Stornieren
                  </button>
                ) : null}
              </div>
            ) : null}

            {v.sperrgrund ? (
              <p className="akte-dialog-sperre">{schritt.hinweis}</p>
            ) : (
              <>
                <div className="akte-dialog-zeile">
                  <label className="akte-dialog-feld">
                    Betrag in Euro
                    <input
                      className="lg-input"
                      type="text"
                      inputMode="decimal"
                      value={schritt.betragFest ? centAlsEingabe(rechnungBetrag(v, null)) : betrag}
                      readOnly={schritt.betragFest}
                      aria-readonly={schritt.betragFest || undefined}
                      onChange={(e) => setBetrag(e.target.value)}
                      placeholder="0,00"
                      autoComplete="off"
                    />
                  </label>
                  <div className="akte-dialog-feld">
                    Fällig
                    <span className="geld-wert">{tagKurz(v.faelligAm)}</span>
                  </div>
                </div>

                {v.stunden ? (
                  <p className="akte-dialog-info">
                    <b>Grundlage:</b> {v.stunden.grundlage}
                    {v.stunden.bruttoCent != null ? ` · Vorschlag ${euroText(v.stunden.bruttoCent)}` : ""}
                    {v.stunden.offeneEintraege > 0
                      ? ` · ${v.stunden.offeneEintraege} ${v.stunden.offeneEintraege === 1 ? "Eintrag ist" : "Einträge sind"} noch offen oder nicht eingereicht`
                      : ""}
                  </p>
                ) : null}

                {schritt.grundNoetig ? (
                  <>
                    <p className="akte-dialog-sperre">
                      Angenommen wurden {euroText(v.annahmeCent ?? 0)}, das Angebot steht heute bei {euroText(v.pdfBetragCent ?? 0)}.
                    </p>
                    <label className="akte-dialog-feld">
                      Warum weicht die Rechnung ab?
                      <textarea
                        className="lg-input lg-textarea"
                        rows={2}
                        value={grund}
                        onChange={(e) => setGrund(e.target.value)}
                        placeholder="Zum Beispiel: eine Stunde mehr vor Ort"
                        required
                      />
                    </label>
                  </>
                ) : null}

                {schritt.hinweis && !schritt.weiter ? <p className="akte-dialog-hilfe">{schritt.hinweis}</p> : null}
              </>
            )}

            <div className="akte-dialog-knoepfe">
              <GlassButton type="button" variant="ghost" onClick={onSchliessen}>
                Abbrechen
              </GlassButton>
              <GlassButton type="submit" disabled={!schritt.weiter}>
                Weiter zur Rechnung
              </GlassButton>
            </div>
          </form>
        ) : null}
      </GlassDialogContent>
    </GlassDialog>
  );
}
