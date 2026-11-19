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
import { anpassungCent, type AnpassungArt, type RechnungAnpassung, type RechnungsVorschlag } from "@/lib/geld";
import { eurosToCents } from "@/lib/work-ui";
import {
  ANPASSUNG_BEISPIEL,
  ANPASSUNG_TITEL,
  anpassungAusEingabe,
  geldFehlerText,
  rechnungBetrag,
  rechnungSchritt,
  rechnungZeile,
  type AnpassungEingabe,
} from "@/components/neu/kasse/kasse-logik";
import { GlassSegmentedControl, GlassSegmentedControlItem } from "@/components/glassyui/glass-segmented-control";
import { apiAufruf, jsonAufruf } from "./api";
import { StornoDialog } from "./storno-dialog";

export interface RechnungsEingabe {
  /** Rechnungsbetrag, mit Nachlass und Aufschlag. */
  bruttoCent: number;
  abweichungGrund?: string;
  /** Nachlass und Aufschlag als eigene Zeilen (Rechnung anpassen). */
  anpassungen?: RechnungAnpassung[];
}

const ARTEN: AnpassungArt[] = ["nachlass", "aufschlag"];

/** Eine Zeile Nachlass oder Aufschlag: Bezeichnung, Wert, Umschalter Euro oder Prozent. */
function AnpassungZeile({
  zeile,
  basisCent,
  onAendern,
  onEntfernen,
}: {
  zeile: AnpassungEingabe;
  basisCent: number | null;
  onAendern: (z: AnpassungEingabe) => void;
  onEntfernen: () => void;
}) {
  const titel = ANPASSUNG_TITEL[zeile.art];
  const fertig = anpassungAusEingabe(zeile, basisCent);
  return (
    <fieldset className="geld-anpassung" data-art={zeile.art}>
      <legend className="geld-anpassung-kopf">
        <span>{titel}</span>
        <button type="button" className="akte-ablauf-knopf geld-knopf-klein" data-ton="grau" onClick={onEntfernen}>
          Entfernen
        </button>
      </legend>
      <div className="akte-dialog-zeile">
        <label className="akte-dialog-feld">
          Steht so auf der Rechnung
          <input
            className="lg-input"
            type="text"
            maxLength={80}
            value={zeile.bezeichnung}
            onChange={(e) => onAendern({ ...zeile, bezeichnung: e.target.value })}
            placeholder={ANPASSUNG_BEISPIEL[zeile.art]}
            autoComplete="off"
          />
        </label>
        <div className="akte-dialog-feld">
          <label htmlFor={`anpassung-${zeile.art}`}>{zeile.modus === "prozent" ? "Prozent" : "Betrag in Euro"}</label>
          <div className="geld-anpassung-wert">
            <input
              id={`anpassung-${zeile.art}`}
              className="lg-input"
              type="text"
              inputMode="decimal"
              value={zeile.wert}
              onChange={(e) => onAendern({ ...zeile, wert: e.target.value })}
              placeholder={zeile.modus === "prozent" ? "10" : "0,00"}
              autoComplete="off"
            />
            <GlassSegmentedControl
              className="geld-anpassung-modus"
              value={zeile.modus}
              onValueChange={(m) => onAendern({ ...zeile, modus: m === "prozent" ? "prozent" : "euro", wert: "" })}
              aria-label={`${titel} in Euro oder Prozent`}
            >
              <GlassSegmentedControlItem value="euro">€</GlassSegmentedControlItem>
              <GlassSegmentedControlItem value="prozent">%</GlassSegmentedControlItem>
            </GlassSegmentedControl>
          </div>
        </div>
      </div>
      {zeile.modus === "prozent" && fertig ? (
        <p className="geld-anpassung-hilfe">= {euroText(anpassungCent(fertig))}</p>
      ) : null}
    </fieldset>
  );
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
  const [anpassungen, setAnpassungen] = useState<AnpassungEingabe[]>([]);
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
  const schritt = v ? rechnungSchritt(v, { betragCent: eingabeCent, grund, anpassungen }) : null;
  const zeileAendern = (z: AnpassungEingabe) => setAnpassungen((liste) => liste.map((a) => (a.art === z.art ? z : a)));

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
              if (!schritt.weiter || schritt.gesamtCent == null) return;
              onWeiter({
                bruttoCent: schritt.gesamtCent,
                ...(schritt.grundNoetig ? { abweichungGrund: grund.trim() } : {}),
                ...(schritt.anpassungen.length > 0 ? { anpassungen: schritt.anpassungen } : {}),
              });
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

                {anpassungen.map((z) => (
                  <AnpassungZeile
                    key={z.art}
                    zeile={z}
                    basisCent={schritt.basisCent}
                    onAendern={zeileAendern}
                    onEntfernen={() => setAnpassungen((liste) => liste.filter((a) => a.art !== z.art))}
                  />
                ))}
                {anpassungen.length < ARTEN.length ? (
                  <div className="geld-anpassung-knoepfe">
                    {ARTEN.filter((art) => !anpassungen.some((a) => a.art === art)).map((art) => (
                      <button
                        key={art}
                        type="button"
                        className="akte-ablauf-knopf geld-knopf-klein"
                        onClick={() => setAnpassungen((liste) => [...liste, { art, bezeichnung: "", modus: "euro", wert: "" }])}
                      >
                        {ANPASSUNG_TITEL[art]} eintragen
                      </button>
                    ))}
                  </div>
                ) : null}
                {anpassungen.length > 0 && schritt.basisCent != null && schritt.gesamtCent != null ? (
                  <p className="akte-dialog-info geld-anpassung-summe">
                    Grundbetrag {euroText(schritt.basisCent)}
                    {schritt.anpassungen.map((a) => ` · ${ANPASSUNG_TITEL[a.art]} ${euroText(anpassungCent(a))}`).join("")}
                    {" · "}
                    <b>Rechnungsbetrag {euroText(schritt.gesamtCent)}</b>
                  </p>
                ) : null}

                {schritt.grundNoetig ? (
                  <>
                    {v.abweichung && !v.istStunden ? (
                      <p className="akte-dialog-sperre">
                        Angenommen wurden {euroText(v.annahmeCent ?? 0)}, das Angebot steht heute bei {euroText(v.pdfBetragCent ?? 0)}.
                      </p>
                    ) : null}
                    <label className="akte-dialog-feld">
                      {anpassungen.length > 0 ? "Warum? Nur intern, steht nicht auf der Rechnung" : "Warum weicht die Rechnung ab?"}
                      <textarea
                        className="lg-input lg-textarea"
                        rows={2}
                        value={grund}
                        onChange={(e) => setGrund(e.target.value)}
                        placeholder={
                          anpassungen.length > 0 ? "Zum Beispiel: am Telefon 10 % Nachlass zugesagt" : "Zum Beispiel: eine Stunde mehr vor Ort"
                        }
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
