"use client";

import "@/styles/neu-akte-kunde.css";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import type { DealKunde } from "@/lib/deal-kunde";
import { ALLE_FELDER, aenderungen, entwurfAus, type KundeEntwurf, type KundeFeld } from "@/lib/kunde-entwurf";
import { apiAufruf, jsonAufruf } from "./api";
import { AusDemChatKnopf, KUNDE_GEAENDERT_EVENT, KundeFelder, kundeWert } from "./kunde-felder";

const ZEILEN: Array<{ feld: KundeFeld; label: string }> = [
  { feld: "name", label: "Name" },
  { feld: "telefon", label: "Telefon" },
  { feld: "email", label: "E-Mail" },
  { feld: "auszug", label: "Kundenanschrift (Auszug)" },
  { feld: "einzug", label: "Einzug" },
  { feld: "datum", label: "Umzugsdatum" },
];

/** Ohne diese Angaben entsteht kein KV (Vorlage auf crm-tools). */
const KV_PFLICHT: KundeFeld[] = ["name", "auszug"];

/**
 * Bereich „Kunde und Adressen“ der Akte: Name, Telefon, E-Mail, Kundenanschrift
 * (Auszug), Einzug und Datum ansehen und bearbeiten, mit „Aus dem Chat
 * übernehmen“. Speichert über PUT …/kunde (updateRecord am Lead bzw. an der
 * Person, wie die übrigen Akte-Felder). `offen` (Link „Angaben ergänzen“,
 * `?angaben=1`) öffnet ihn gleich zum Bearbeiten und scrollt hin.
 */
export function KundeBereich({
  dealId,
  offen = false,
  onGespeichert,
}: {
  dealId: string;
  offen?: boolean;
  onGespeichert: () => Promise<void>;
}) {
  const [kunde, setKunde] = useState<DealKunde | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [bearbeiten, setBearbeiten] = useState(offen);
  const [entwurf, setEntwurf] = useState<KundeEntwurf>(entwurfAus(null));
  const [vorgeschlagen, setVorgeschlagen] = useState<KundeFeld[]>([]);
  const [speichert, setSpeichert] = useState(false);
  const panel = useRef<HTMLDivElement | null>(null);

  const bearbeitet = useRef(bearbeiten);
  bearbeitet.current = bearbeiten;

  useEffect(() => {
    let aktuell = true;
    const laden = (still: boolean) => {
      if (!still) {
        setKunde(null);
        setFehler(null);
      }
      void apiAufruf<DealKunde>(`/api/v1/deals/${encodeURIComponent(dealId)}/kunde`).then((r) => {
        if (!aktuell) return;
        if (!r.ok) return setFehler(r.message);
        setKunde(r.data);
        // Beim ersten Laden immer, danach einen offenen Entwurf nie überschreiben.
        if (!still || !bearbeitet.current) setEntwurf(entwurfAus(r.data));
      });
    };
    laden(false);
    // Gespeichert im Fenster „Es fehlen noch Angaben“: hier still nachladen.
    const geaendert = (e: Event) => {
      const d = (e as CustomEvent<unknown>).detail;
      if (d === dealId) laden(true);
    };
    window.addEventListener(KUNDE_GEAENDERT_EVENT, geaendert);
    return () => {
      aktuell = false;
      window.removeEventListener(KUNDE_GEAENDERT_EVENT, geaendert);
    };
  }, [dealId]);

  useEffect(() => {
    if (!offen) return;
    setBearbeiten(true);
    requestAnimationFrame(() => panel.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [offen]);

  function abbrechen() {
    setEntwurf(entwurfAus(kunde));
    setVorgeschlagen([]);
    setFehler(null);
    setBearbeiten(false);
  }

  async function speichern(e: React.FormEvent) {
    e.preventDefault();
    const body = aenderungen(entwurf, kunde);
    if (Object.keys(body).length === 0) return abbrechen();
    setSpeichert(true);
    setFehler(null);
    const r = await apiAufruf<DealKunde>(
      `/api/v1/deals/${encodeURIComponent(dealId)}/kunde`,
      jsonAufruf("PUT", { ...body, quelle: vorgeschlagen.length > 0 ? "chat" : "akte" })
    );
    setSpeichert(false);
    if (!r.ok) return setFehler(r.message);
    setKunde(r.data);
    setEntwurf(entwurfAus(r.data));
    setVorgeschlagen([]);
    setBearbeiten(false);
    toast.success("Kundendaten gespeichert.");
    await onGespeichert();
  }

  const fehltFuerKv = kunde ? KV_PFLICHT.filter((f) => !kundeWert(kunde, f)) : [];

  return (
    <GlassPanel variant="panel" className="kunde-panel" aria-label="Kunde und Adressen" ref={panel}>
      <header className="kunde-panel-kopf">
        <h2>Kunde und Adressen</h2>
        {kunde && !bearbeiten ? (
          <button type="button" className="akte-ablauf-knopf kunde-knopf-klein" onClick={() => setBearbeiten(true)}>
            Bearbeiten
          </button>
        ) : null}
      </header>

      {!kunde && !fehler ? <p className="kunde-hinweis">Lädt …</p> : null}

      {kunde && !bearbeiten ? (
        <>
          <dl className="kunde-zeilen">
            {ZEILEN.map(({ feld, label }) => {
              const wert = kundeWert(kunde, feld);
              const pflicht = KV_PFLICHT.includes(feld);
              return (
                <div key={feld} className="kunde-zeile" data-fehlt={!wert && pflicht ? "" : undefined}>
                  <dt>{label}</dt>
                  <dd>{wert ?? (pflicht ? "fehlt, ohne sie entsteht kein KV" : "nicht eingetragen")}</dd>
                </div>
              );
            })}
          </dl>
          {fehltFuerKv.length > 0 ? (
            <p className="kunde-hinweis">
              Steht es im Chat?{" "}
              <button type="button" className="kunde-link" onClick={() => setBearbeiten(true)}>
                Bearbeiten und aus dem Chat übernehmen
              </button>
            </p>
          ) : null}
        </>
      ) : null}

      {kunde && bearbeiten ? (
        <form onSubmit={(e) => void speichern(e)}>
          <AusDemChatKnopf
            dealId={dealId}
            entwurf={entwurf}
            felder={ALLE_FELDER}
            disabled={speichert}
            onVorschlag={(neu, gesetzt) => {
              setEntwurf(neu);
              setVorgeschlagen(gesetzt);
            }}
          />
          <KundeFelder
            felder={ALLE_FELDER}
            entwurf={entwurf}
            pflicht={KV_PFLICHT}
            vorgeschlagen={vorgeschlagen}
            gesperrt={speichert}
            onAendern={(neu, feld) => {
              setEntwurf(neu);
              setVorgeschlagen((v) => v.filter((f) => f !== feld));
            }}
          />
          {!kunde.nameAusPerson && kunde.personId === null ? (
            <p className="kunde-hinweis">Noch keine Person verknüpft: Speichern legt sie mit Name, Telefon und E-Mail an.</p>
          ) : null}
          {fehler ? <p className="akte-dialog-fehler">{fehler}</p> : null}
          <div className="akte-dialog-knoepfe">
            <GlassButton type="button" variant="ghost" onClick={abbrechen} disabled={speichert}>
              Abbrechen
            </GlassButton>
            <GlassButton type="submit" disabled={speichert} aria-busy={speichert || undefined}>
              {speichert ? "Speichert …" : "Speichern"}
            </GlassButton>
          </div>
        </form>
      ) : null}

      {fehler && !bearbeiten ? <p className="akte-dialog-fehler">{fehler}</p> : null}
    </GlassPanel>
  );
}
