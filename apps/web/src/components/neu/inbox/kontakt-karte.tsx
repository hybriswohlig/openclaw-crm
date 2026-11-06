"use client";

import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { KANAL_LABEL } from "@/components/neu/akte/gespraech-verlauf";
import { posteingangUrl } from "@/components/neu/akte/gespraech-texte";
import type { InboxEintrag } from "@/lib/inbox-neu";
import type { Gespraech } from "@/services/gespraech";
import type { LaneAktionen } from "./lane-aktionen";

const LEER = "–";

/**
 * Rechte Spalte für ein Gespräch ohne Deal (Entscheidung 12): Karte „Kontakt“
 * mit Name, Telefon, Kanal und Firma, der Weg in die alte Inbox zum Zuordnen,
 * dazu „Kein Lead“ und „Info“ (nur Lane) bzw. „Lead“ aus der Info-Gruppe.
 * Eine Kunden-E-Mail kennt das Einzelgespräch nicht; die Zeile entfällt.
 */
export function KontaktKarte({
  gespraechId,
  eintrag,
  gespraech,
  aktionen,
}: {
  gespraechId: string;
  eintrag: InboxEintrag | null;
  gespraech: Gespraech;
  aktionen: LaneAktionen;
}) {
  const kanal = gespraech.kanaele.find((k) => k.gespraechId === gespraechId) ?? gespraech.kanaele[0] ?? null;
  const name = eintrag?.name ?? kanal?.kundeName?.trim() ?? "Unbekannt";
  const telefon = kanal?.telefon ?? null;
  const inInfo = eintrag?.gruppe === "info";

  return (
    <GlassPanel variant="panel" className="akte-panel inbox-rechts-panel">
      <div className="akte-panel-kopf">
        <div>
          <h2 className="akte-panel-titel">Kontakt</h2>
          <p className="akte-panel-unter">Gespräch ohne Deal</p>
        </div>
      </div>
      <div className="inbox-karten">
        <section className="inbox-karte" aria-label="Kontakt">
          <div className="inbox-karte-zeile">
            <b className="inbox-karte-name">{name}</b>
            {eintrag?.laneText ? <span className="inbox-pille" data-art="stufe">{eintrag.laneText}</span> : null}
          </div>
          <dl className="inbox-kv">
            <div className="inbox-kv-zeile">
              <dt>Telefon</dt>
              <dd>{telefon ? <a href={`tel:${telefon.replace(/\s+/g, "")}`}>{telefon}</a> : LEER}</dd>
            </div>
            <div className="inbox-kv-zeile">
              <dt>Kanal</dt>
              <dd>{kanal ? `${KANAL_LABEL[kanal.kanal]} · ${kanal.name}` : LEER}</dd>
            </div>
            <div className="inbox-kv-zeile">
              <dt>Firma</dt>
              <dd>{eintrag?.firma?.name ?? LEER}</dd>
            </div>
          </dl>
          <a href={posteingangUrl(gespraechId)} className="inbox-link">
            In der alten Inbox einem Lead zuordnen →
          </a>
          <div className="inbox-karte-knoepfe">
            {inInfo ? (
              <GlassButton size="sm" variant="ghost" onClick={() => void aktionen.lead()} disabled={aktionen.laeuft}>
                Als Lead
              </GlassButton>
            ) : (
              <GlassButton size="sm" variant="ghost" onClick={() => void aktionen.keinLead()} disabled={aktionen.laeuft}>
                Kein Lead
              </GlassButton>
            )}
            {eintrag?.laneText !== "Info" ? (
              <GlassButton size="sm" variant="ghost" onClick={() => void aktionen.info()} disabled={aktionen.laeuft}>
                Info
              </GlassButton>
            ) : null}
          </div>
        </section>
      </div>
    </GlassPanel>
  );
}
