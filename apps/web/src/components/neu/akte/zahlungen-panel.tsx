"use client";

import "@/styles/neu-kasse.css";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { useState } from "react";
import { toast } from "sonner";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { euroText, tagKurz } from "@/lib/anzeige";
import type { ZahlungAkte, ZahlungZeileAkte } from "@/lib/geld";
import { betragText, geldFehlerText, rechnungZeile, zahlungAktionen, zahlungDetails } from "@/components/neu/kasse/kasse-logik";
import { apiAufruf, jsonAufruf } from "./api";
import { eurosToCents } from "@/lib/work-ui";
import { StornoDialog } from "./storno-dialog";
import { ZahlungBearbeitenDialog } from "./zahlung-bearbeiten-dialog";

type Offen =
  | { art: "bearbeiten" | "korrigieren"; zahlung: ZahlungZeileAkte }
  | { art: "storno_zahlung"; zahlung: ZahlungZeileAkte }
  | { art: "storno_rechnung" };

/**
 * Panel „Zahlungen“ unter der Zahlenreihe der Akte (Plan 9, Entscheidung 18):
 * offener Rest, die Rechnung kurz (Nummer, Betrag, fällig, Status,
 * Erinnerung) mit „Stornieren“, darunter jede Zahlung mit Datum, Art,
 * Betrag, Quelle und Belegnummer. Zeilenmenü: Bearbeiten, Korrigieren,
 * Stornieren (Pflichtgrund, Rückfrage). Stornierte Zahlungen bleiben
 * durchgestrichen stehen, die Gegenbuchung steht darunter.
 */
export function ZahlungenPanel({
  dealId,
  zahlung,
  portalZiel,
  onNeuLaden,
}: {
  dealId: string;
  zahlung: ZahlungAkte;
  portalZiel: HTMLElement | undefined;
  onNeuLaden: () => Promise<void> | void;
}) {
  const [offen, setOffen] = useState<Offen | null>(null);
  const r = zahlung.rechnung;
  const schliessen = () => setOffen(null);

  if (!r && zahlung.zahlungen.length === 0) return null;

  const rest =
    zahlung.restCent == null
      ? "Offener Rest unbekannt"
      : zahlung.restCent > 0
        ? `Offen ${euroText(zahlung.restCent)}`
        : "Nichts offen";

  return (
    <GlassPanel variant="panel" className="geld-panel" aria-label="Zahlungen">
      <header className="geld-panel-kopf">
        <h2>Zahlungen</h2>
        <span className="geld-panel-rest" data-ton={zahlung.restCent != null && zahlung.restCent > 0 ? "gold" : undefined}>
          {rest}
          {zahlung.gesamtCent != null ? ` von ${euroText(zahlung.gesamtCent)}` : ""}
        </span>
      </header>

      {r ? (
        <div className="geld-rechnung" data-status={r.status}>
          <span className="geld-rechnung-text">{rechnungZeile(r)}</span>
          {r.abweichungGrund ? <span className="geld-rechnung-grund">Abweichung: {r.abweichungGrund}</span> : null}
          {r.status === "gestellt" ? (
            <button type="button" className="akte-ablauf-knopf geld-knopf-klein" onClick={() => setOffen({ art: "storno_rechnung" })}>
              Rechnung stornieren
            </button>
          ) : null}
        </div>
      ) : null}
      {r && r.herkunft === "alt" && r.status === "gestellt" && r.bruttoCent == null ? (
        <BetragNachtragen dealId={dealId} invoiceId={r.id} onNeuLaden={onNeuLaden} />
      ) : null}

      {zahlung.zahlungen.length > 0 ? (
        <ul className="geld-zeilen">
          {zahlung.zahlungen.map((z) => {
            const a = zahlungAktionen(z);
            return (
              <li key={z.id} className="geld-zeile" data-storniert={z.storniert || undefined} data-storno={z.istStorno || undefined}>
                <span className="geld-zeile-tag">{tagKurz(z.date)}</span>
                <span className="geld-zeile-text">
                  <span className="geld-zeile-details">{zahlungDetails(z) || "Zahlung"}</span>
                  {z.notiz ? <span className="geld-zeile-notiz">{z.notiz}</span> : null}
                </span>
                <span className="geld-zeile-betrag">{betragText(z.cent)}</span>
                {a.bearbeiten || a.korrigieren || a.stornieren ? (
                  <ZeilenMenue
                    portalZiel={portalZiel}
                    aktionen={a}
                    onWahl={(art) => setOffen(art === "storno" ? { art: "storno_zahlung", zahlung: z } : { art, zahlung: z })}
                  />
                ) : (
                  <span className="geld-zeile-menue-platz" aria-hidden="true" />
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="geld-leer">Noch keine Zahlung erfasst.</p>
      )}

      {offen?.art === "bearbeiten" || offen?.art === "korrigieren" ? (
        <ZahlungBearbeitenDialog
          dealId={dealId}
          zahlung={offen.zahlung}
          art={offen.art}
          portalZiel={portalZiel}
          onSchliessen={schliessen}
          onNeuLaden={onNeuLaden}
        />
      ) : null}
      {offen?.art === "storno_zahlung" ? (
        <StornoDialog
          titel={`Zahlung über ${euroText(offen.zahlung.cent)} stornieren?`}
          text="Es entsteht eine Gegenbuchung mit eigener Belegnummer. Die Zahlung bleibt sichtbar und zählt nicht mehr."
          portalZiel={portalZiel}
          onSchliessen={schliessen}
          onBestaetigen={async (grund) => {
            const res = await apiAufruf(`/api/v1/deals/${dealId}/payments/${offen.zahlung.id}/storno`, jsonAufruf("POST", { grund }));
            if (!res.ok) return geldFehlerText(res.code, res.message);
            toast.success("Zahlung storniert.");
            schliessen();
            await onNeuLaden();
            return null;
          }}
        />
      ) : null}
      {offen?.art === "storno_rechnung" && r ? (
        <StornoDialog
          titel={`${r.nummer ?? "Rechnung"} stornieren?`}
          text="Die Rechnung verschwindet aus dem Kundenportal, das PDF bleibt im CRM. Offene Zahlungserinnerungen werden gestoppt."
          portalZiel={portalZiel}
          onSchliessen={schliessen}
          onBestaetigen={async (grund) => {
            const res = await apiAufruf(`/api/v1/deals/${dealId}/invoices/${r.id}/storno`, jsonAufruf("POST", { grund }));
            if (!res.ok) return geldFehlerText(res.code, res.message);
            toast.success("Rechnung storniert.");
            schliessen();
            await onNeuLaden();
            return null;
          }}
        />
      ) : null}
    </GlassPanel>
  );
}

function ZeilenMenue({
  portalZiel,
  aktionen,
  onWahl,
}: {
  portalZiel: HTMLElement | undefined;
  aktionen: { bearbeiten: boolean; korrigieren: boolean; stornieren: boolean };
  onWahl: (art: "bearbeiten" | "korrigieren" | "storno") => void;
}) {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>
        <button type="button" className="geld-zeile-menue" aria-label="Zahlung bearbeiten, korrigieren oder stornieren">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="5" cy="12" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="19" cy="12" r="1.6" />
          </svg>
        </button>
      </Menu.Trigger>
      <Menu.Portal container={portalZiel}>
        <Menu.Content asChild align="end" sideOffset={6} collisionPadding={12}>
          <GlassPanel elevation="raised" lens preset="prominent" refraction="none" variant="card" className="lg-menu-content geld-menue">
            {aktionen.bearbeiten ? (
              <Menu.Item className="lg-menu-item" onSelect={() => onWahl("bearbeiten")}>
                Bearbeiten
              </Menu.Item>
            ) : null}
            {aktionen.korrigieren ? (
              <Menu.Item className="lg-menu-item" onSelect={() => onWahl("korrigieren")}>
                Korrigieren
              </Menu.Item>
            ) : null}
            {aktionen.stornieren ? (
              <Menu.Item className="lg-menu-item" data-ton="rose" onSelect={() => onWahl("storno")}>
                Stornieren
              </Menu.Item>
            ) : null}
          </GlassPanel>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * Fix-Welle I3: alte Rechnung (vor Plan 9) ohne Betrag, etwa ein Stunden-KV.
 * Sie zählt nicht in der Kasse, bis hier der Rechnungsbetrag steht.
 */
function BetragNachtragen({
  dealId,
  invoiceId,
  onNeuLaden,
}: {
  dealId: string;
  invoiceId: string;
  onNeuLaden: () => Promise<void> | void;
}) {
  const [betrag, setBetrag] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  return (
    <form
      className="geld-nachtragen"
      onSubmit={async (e) => {
        e.preventDefault();
        const cent = eurosToCents(betrag);
        if (cent == null || cent <= 0) return setFehler("Bitte einen Betrag eingeben, etwa 1.980,00.");
        setLaeuft(true);
        setFehler(null);
        const res = await apiAufruf(`/api/v1/deals/${dealId}/invoices/${invoiceId}/betrag`, jsonAufruf("PUT", { bruttoCent: cent }));
        setLaeuft(false);
        if (!res.ok) return setFehler(geldFehlerText(res.code, res.message));
        toast.success("Rechnungsbetrag eingetragen.");
        await onNeuLaden();
      }}
    >
      <span className="geld-nachtragen-text">Alte Rechnung ohne Betrag: bitte den Rechnungsbetrag eintragen.</span>
      <input
        className="lg-input geld-nachtragen-feld"
        type="text"
        inputMode="decimal"
        aria-label="Rechnungsbetrag in Euro"
        placeholder="0,00"
        value={betrag}
        onChange={(e) => setBetrag(e.target.value)}
      />
      <button type="submit" className="akte-ablauf-knopf geld-knopf-klein" disabled={laeuft}>
        {laeuft ? "Speichert" : "Eintragen"}
      </button>
      {fehler ? (
        <span className="akte-dialog-fehler" role="alert">
          {fehler}
        </span>
      ) : null}
    </form>
  );
}
