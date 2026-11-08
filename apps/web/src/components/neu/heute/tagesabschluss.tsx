"use client";

import "@/styles/neu-kasse.css";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { apiAufruf, jsonAufruf } from "@/components/neu/akte/api";
import { RechnungFluss } from "@/components/neu/akte/rechnung-fluss";
import { BestaetigenDialog } from "@/components/neu/plan/bestaetigen-dialog";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import type { TagesabschlussKarte, TagesabschlussSchritt } from "@/lib/geld";

type Offen = { art: "bestaetigen"; karte: TagesabschlussKarte } | { art: "rechnung"; karte: TagesabschlussKarte };

const SYMBOL: Record<TagesabschlussSchritt["status"], string> = { erledigt: "✓", jetzt: "", spaeter: "" };

/**
 * Tagesabschluss oben auf Heute (Plan 9, Entscheidung 15): je Auftrag, der
 * gestern lief oder den das Team „fertig“ gemeldet hat, die Schritte
 * „Durchgeführt bestätigen“, „Rechnung erstellen“ und „Bar bei [Name]“ in
 * fester Folge. Nur der jetzige Schritt ist klickbar; erledigte stehen jade.
 * Die Karte verschwindet, wenn alles erledigt ist (der Server lässt sie weg).
 */
export function Tagesabschluss({
  karten,
  durchgefuehrtStufe,
  onNeuLaden,
}: {
  karten: TagesabschlussKarte[];
  durchgefuehrtStufe: { id: string; label: string } | null;
  onNeuLaden: () => Promise<void> | void;
}) {
  const portalZiel = usePortalZiel();
  const [offen, setOffen] = useState<Offen | null>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);

  if (karten.length === 0) return null;

  async function barErhalten(karte: TagesabschlussKarte, schritt: TagesabschlussSchritt) {
    if (!schritt.paymentIds?.length) return;
    setLaeuft(`${karte.dealId}:bar`);
    const r = await apiAufruf<{ anzahl: number }>(
      `/api/v1/deals/${karte.dealId}/payments/bar-erhalten`,
      jsonAufruf("POST", { paymentIds: schritt.paymentIds })
    );
    setLaeuft(null);
    if (!r.ok) {
      toast.error("Bar erhalten konnte nicht gespeichert werden.", { description: r.message });
      return;
    }
    toast.success(`${karte.name}: Bargeld erhalten.`);
    await onNeuLaden();
  }

  function klick(karte: TagesabschlussKarte, schritt: TagesabschlussSchritt) {
    if (schritt.status !== "jetzt") return;
    if (schritt.art === "bestaetigen") {
      if (!durchgefuehrtStufe) {
        toast.error("Keine Stufe „Durchgeführt“ gefunden.", { description: "Bitte in der Akte die Stufe setzen." });
        return;
      }
      setOffen({ art: "bestaetigen", karte });
    } else if (schritt.art === "rechnung") {
      setOffen({ art: "rechnung", karte });
    } else {
      void barErhalten(karte, schritt);
    }
  }

  return (
    <GlassPanel variant="panel" className="geld-abschluss" aria-label="Tagesabschluss">
      <header className="geld-panel-kopf">
        <h2>Tagesabschluss</h2>
        <span className="geld-panel-rest">{karten.length === 1 ? "1 Auftrag" : `${karten.length} Aufträge`}</span>
      </header>
      <ul className="geld-abschluss-liste">
        {karten.map((k) => (
          <li key={k.dealId} className="geld-abschluss-karte">
            <div className="geld-abschluss-kopf">
              <Link href={k.href} className="geld-abschluss-name">
                {k.name}
              </Link>
              {k.nummer ? <span className="geld-abschluss-nummer">{k.nummer}</span> : null}
              <span className="geld-abschluss-hinweis">{k.hinweis}</span>
            </div>
            <ol className="geld-schritte">
              {k.schritte.map((s, i) => {
                const schluessel = `${k.dealId}:${s.art}`;
                return (
                  <li key={`${s.art}-${i}`}>
                    <button
                      type="button"
                      className="geld-schritt"
                      data-status={s.status}
                      disabled={s.status !== "jetzt" || laeuft !== null}
                      aria-busy={laeuft === schluessel || undefined}
                      onClick={() => klick(k, s)}
                    >
                      <span className="geld-schritt-marke" aria-hidden="true">
                        {SYMBOL[s.status] || i + 1}
                      </span>
                      {s.art === "bar" && s.status === "jetzt" ? `${s.text} · Bar erhalten` : s.text}
                    </button>
                  </li>
                );
              })}
            </ol>
          </li>
        ))}
      </ul>

      {offen?.art === "bestaetigen" && durchgefuehrtStufe ? (
        <BestaetigenDialog
          eintrag={{ dealId: offen.karte.dealId, titel: offen.karte.name, bisTag: null }}
          stufe={durchgefuehrtStufe}
          portalZiel={portalZiel}
          onEnde={(gesetzt) => {
            const name = offen.karte.name;
            setOffen(null);
            if (gesetzt) {
              toast.success(`${name}: Durchführung bestätigt.`);
              void onNeuLaden();
            }
          }}
        />
      ) : null}
      {offen?.art === "rechnung" ? (
        <RechnungFluss
          dealId={offen.karte.dealId}
          portalZiel={portalZiel}
          onGeaendert={onNeuLaden}
          onEnde={() => {
            setOffen(null);
            void onNeuLaden();
          }}
        />
      ) : null}
    </GlassPanel>
  );
}
