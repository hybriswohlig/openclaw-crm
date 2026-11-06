"use client";

import Link from "next/link";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { NachfassSchalter } from "@/components/neu/akte/akte-kopf";
import type { Kurzfassung } from "@/lib/inbox-neu";
import type { LaneAktionen } from "./lane-aktionen";

/** Fehlender Wert, wie die Spec ihn vorgibt (kein Gedankenstrich im Satz). */
const LEER = "–";

function Wert({ label, kinder }: { label: string; kinder: React.ReactNode }) {
  return (
    <div className="inbox-kv-zeile">
      <dt>{label}</dt>
      <dd>{kinder}</dd>
    </div>
  );
}

/**
 * Rechte Spalte „Deal · Kurzfassung der Akte“ (Entscheidung 12): Karte Deal
 * mit Stufe, Zeilen, nächstem Schritt und Link zur Akte; Karte Kunde; Karte
 * Gespräch mit Nachfass-Schalter und den Knöpfen „Kein Lead“ und „Info“.
 */
export function KurzfassungSpalte({
  kurz,
  inInfo,
  aktionen,
  onNachfass,
  onNeuLaden,
}: {
  kurz: Kurzfassung;
  /** Der Eintrag liegt in der Gruppe „Info und Kein Lead“: dann „Als Lead“ statt „Kein Lead“. */
  inInfo: boolean;
  aktionen: LaneAktionen;
  onNachfass: (nachfass: Kurzfassung["nachfass"]) => void;
  onNeuLaden: () => Promise<unknown>;
}) {
  const k = kurz.kunde;
  return (
    <GlassPanel variant="panel" className="akte-panel inbox-rechts-panel">
      <div className="akte-panel-kopf">
        <div>
          <h2 className="akte-panel-titel">Deal</h2>
          <p className="akte-panel-unter">Kurzfassung der Akte</p>
        </div>
      </div>
      <div className="inbox-karten">
        <section className="inbox-karte" aria-label="Deal">
          <div className="inbox-karte-zeile">
            <b className="inbox-karte-name">{kurz.name}</b>
            <span className="inbox-stufe">
              <i className="akte-punkt" data-ton={kurz.stufe.ton} aria-hidden="true" />
              {kurz.stufe.label}
            </span>
          </div>
          <dl className="inbox-kv">
            {kurz.zeilen.map((z) => (
              <div className="inbox-kv-zeile" key={z.label}>
                <dt>{z.label}</dt>
                <dd data-ton={z.ton ?? undefined}>{z.wert}</dd>
              </div>
            ))}
          </dl>
          {kurz.naechsterSchritt ? (
            <p className="inbox-naechster">
              Nächster Schritt: <b>{kurz.naechsterSchritt.titel}</b>
              {kurz.naechsterSchritt.zusatz ? ` · ${kurz.naechsterSchritt.zusatz}` : ""}
            </p>
          ) : null}
          <Link href={kurz.akteLink} className="inbox-link">
            Akte öffnen →
          </Link>
        </section>

        <section className="inbox-karte" aria-label="Kunde">
          <h3 className="inbox-karte-k">Kunde</h3>
          <dl className="inbox-kv">
            <Wert label="Telefon" kinder={k.telefon ? <a href={`tel:${k.telefon.replace(/\s+/g, "")}`}>{k.telefon}</a> : LEER} />
            <Wert label="E-Mail" kinder={k.email ? <a href={`mailto:${k.email}`}>{k.email}</a> : LEER} />
            <Wert label="Von" kinder={k.von ?? LEER} />
            <Wert label="Nach" kinder={k.nach ?? LEER} />
            <Wert label="Quelle" kinder={k.quelle ?? LEER} />
            <Wert label="Firma" kinder={k.firma ?? LEER} />
          </dl>
        </section>

        <section className="inbox-karte" aria-label="Gespräch">
          <h3 className="inbox-karte-k">Gespräch</h3>
          <dl className="inbox-kv">
            <Wert label="Kanäle" kinder={kurz.gespraech.kanaele || LEER} />
            <Wert label="Fotos" kinder={String(kurz.gespraech.fotos)} />
            <Wert label="Dokumente" kinder={kurz.gespraech.dokumente || LEER} />
          </dl>
          <div className="inbox-karte-nachfass">
            <NachfassSchalter
              dealId={kurz.dealId}
              nachfass={kurz.nachfass}
              onNachfass={onNachfass}
              onNeuLaden={async () => {
                await onNeuLaden();
              }}
            />
          </div>
          <div className="inbox-karte-knoepfe">
            {inInfo ? (
              <GlassButton size="sm" variant="ghost" onClick={() => void aktionen.lead()} disabled={aktionen.laeuft || !aktionen.moeglich}>
                Als Lead
              </GlassButton>
            ) : (
              <>
                <GlassButton size="sm" variant="ghost" onClick={() => void aktionen.keinLead()} disabled={aktionen.laeuft || !aktionen.moeglich}>
                  Kein Lead
                </GlassButton>
                <GlassButton size="sm" variant="ghost" onClick={() => void aktionen.info()} disabled={aktionen.laeuft || !aktionen.moeglich}>
                  Info
                </GlassButton>
              </>
            )}
          </div>
        </section>
      </div>
    </GlassPanel>
  );
}
