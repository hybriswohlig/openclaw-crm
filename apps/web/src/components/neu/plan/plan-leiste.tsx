"use client";

import Link from "next/link";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { GlassSegmentedControl, GlassSegmentedControlItem } from "@/components/glassyui/glass-segmented-control";
import { LeistenMenue, type LeistenWahl } from "@/components/neu/leiste-menue";
import type { LeadFirma } from "@/lib/leads-board";
import {
  PLAN_MODI,
  ankerVerschieben,
  planTitel,
  type PlanMitarbeiter,
  type PlanModus,
  type PlanSeitenZustand,
} from "@/lib/plan-heute";

const ZURUECK: Record<PlanModus, string> = { monat: "Vorheriger Monat", woche: "Vorherige Woche", tag: "Vorheriger Tag" };
const VOR: Record<PlanModus, string> = { monat: "Nächster Monat", woche: "Nächste Woche", tag: "Nächster Tag" };

/**
 * Die Leiste des Plans (Mockup 04, Entscheidung 10): Umschalter Monat · Woche
 * · Tag, Navigation „‹ Titel ›“ mit „Heute“, Pillen Firma (nicht im
 * Leads-Kalender, dort filtert die Leads-Leiste) und Mitarbeiter, rechts leise
 * „Kalender-Abo“. `kompakt` am Handy: nur Tag, ohne Umschalter.
 */
export function PlanLeiste({
  zustand: z,
  heute,
  firmen,
  mitarbeiter,
  imLeads,
  kompakt,
  onZustand,
}: {
  zustand: PlanSeitenZustand;
  heute: string;
  firmen: readonly LeadFirma[];
  mitarbeiter: readonly PlanMitarbeiter[];
  imLeads: boolean;
  kompakt: boolean;
  onZustand: (z: PlanSeitenZustand) => void;
}) {
  const firmenWahl: LeistenWahl[] = [{ wert: null, label: "Beide Firmen" }, ...firmen.map((f) => ({ wert: f.id, label: f.name }))];
  const leuteWahl: LeistenWahl[] = [{ wert: null, label: "Alle Mitarbeiter" }, ...mitarbeiter.map((m) => ({ wert: m.id, label: m.name }))];
  const firmaFarbe = firmen.find((f) => f.id === z.firmaId)?.farbe;
  const imFenster = z.modus === "tag" ? z.anker === heute : planTitel(z.modus, z.anker) === planTitel(z.modus, heute);

  return (
    <GlassPanel variant="panel" className="plan-leiste" data-kompakt={kompakt || undefined} aria-label="Ansicht und Filter">
      {kompakt ? null : (
        <GlassSegmentedControl
          value={z.modus}
          onValueChange={(v) => {
            const modus = PLAN_MODI.find((m) => m.key === v)?.key;
            if (modus && modus !== z.modus) onZustand({ ...z, modus });
          }}
          aria-label="Ansicht"
          className="plan-umschalter"
        >
          {PLAN_MODI.map((m) => (
            <GlassSegmentedControlItem key={m.key} value={m.key}>
              {m.label}
            </GlassSegmentedControlItem>
          ))}
        </GlassSegmentedControl>
      )}

      <div className="plan-nav">
        <button type="button" className="plan-nav-pfeil" aria-label={ZURUECK[z.modus]} onClick={() => onZustand({ ...z, anker: ankerVerschieben(z.modus, z.anker, -1) })}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <h2 className="plan-nav-titel" aria-live="polite">
          {kompakt && z.anker.slice(0, 4) === heute.slice(0, 4) ? planTitel(z.modus, z.anker).replace(/ \d{4}$/, "") : planTitel(z.modus, z.anker)}
        </h2>
        <button type="button" className="plan-nav-pfeil" aria-label={VOR[z.modus]} onClick={() => onZustand({ ...z, anker: ankerVerschieben(z.modus, z.anker, 1) })}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
        <button type="button" className="plan-heute-knopf" disabled={imFenster} onClick={() => onZustand({ ...z, anker: heute })}>
          Heute
        </button>
      </div>

      {imLeads ? null : (
        <LeistenMenue titel="Firma" optionen={firmenWahl} wert={z.firmaId} punkt punktFarbe={firmaFarbe} onWaehlen={(w) => onZustand({ ...z, firmaId: w })} />
      )}
      <LeistenMenue titel="Mitarbeiter" optionen={leuteWahl} wert={z.mitarbeiterId} onWaehlen={(w) => onZustand({ ...z, mitarbeiterId: w })} />

      {imLeads || kompakt ? null : (
        <Link href="/contract-calendar" className="plan-abo">
          Kalender-Abo
        </Link>
      )}
    </GlassPanel>
  );
}
