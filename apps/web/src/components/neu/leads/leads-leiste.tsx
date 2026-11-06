"use client";

import { useId, useMemo } from "react";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { GlassSegmentedControl, GlassSegmentedControlItem } from "@/components/glassyui/glass-segmented-control";
import { GlassSwitch } from "@/components/glassyui/glass-switch";
import { LeistenMenue, type LeistenWahl } from "@/components/neu/leiste-menue";
import { monatsOptionen, type LeadsFilter, type LeadsModus, type LeadsStammdaten } from "@/lib/leads-board";

/**
 * Die Leiste (Entscheidung 7): Umschalter Board · Liste · Kalender (gemerkt
 * je Nutzer), Firma, Quelle, Monat nach Termin (nicht im Kalender: dort
 * ersetzt die Plan-Navigation den Monat, Plan 8 W7), Suche (ab 2 Zeichen,
 * serverseitig), Schalter „Nur „wartet auf uns““. Alle Filter stehen in der
 * URL. `kompakt` am Handy: ohne Umschalter, Pillen umbrechend.
 */
export function LeadsLeiste({
  filter,
  modus,
  firmen,
  quellen,
  kompakt,
  onFilter,
  onModus,
}: {
  filter: LeadsFilter;
  modus: LeadsModus;
  firmen: LeadsStammdaten["firmen"];
  quellen: LeadsStammdaten["quellen"];
  kompakt: boolean;
  onFilter: (teil: Partial<LeadsFilter>) => void;
  onModus: (modus: LeadsModus) => void;
}) {
  const schalterId = useId();
  const sucheId = useId();
  const firmenWahl: LeistenWahl[] = [{ wert: null, label: "Beide Firmen" }, ...firmen.map((f) => ({ wert: f.id, label: f.name }))];
  const quellenWahl: LeistenWahl[] = [{ wert: null, label: "Alle Quellen" }, ...quellen.map((q) => ({ wert: q.id, label: q.label }))];
  // Monate einmal je Einhängen; die Liste ändert sich nur mit dem Monat.
  const monateWahl: LeistenWahl[] = useMemo(() => [{ wert: null, label: "Alle Monate" }, ...monatsOptionen(new Date())], []);
  const firmaFarbe = firmen.find((f) => f.id === filter.firmaId)?.farbe;

  return (
    <GlassPanel variant="panel" className="leads-leiste" data-kompakt={kompakt || undefined} aria-label="Ansicht und Filter">
      {kompakt ? null : (
        <GlassSegmentedControl value={modus} onValueChange={(v) => onModus(v === "liste" || v === "kalender" ? v : "board")} aria-label="Ansicht" className="leads-umschalter">
          <GlassSegmentedControlItem value="board">Board</GlassSegmentedControlItem>
          <GlassSegmentedControlItem value="liste">Liste</GlassSegmentedControlItem>
          <GlassSegmentedControlItem value="kalender">Kalender</GlassSegmentedControlItem>
        </GlassSegmentedControl>
      )}
      <LeistenMenue titel="Firma" optionen={firmenWahl} wert={filter.firmaId} punkt punktFarbe={firmaFarbe} onWaehlen={(w) => onFilter({ firmaId: w })} />
      <LeistenMenue titel="Quelle" optionen={quellenWahl} wert={filter.quelleId} onWaehlen={(w) => onFilter({ quelleId: w })} />
      {modus === "kalender" ? null : (
        <LeistenMenue titel="Monat nach Termin" optionen={monateWahl} wert={filter.monat} onWaehlen={(w) => onFilter({ monat: w })} />
      )}
      <label className="leads-suche" htmlFor={sucheId}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l4.5 4.5" />
        </svg>
        <input
          id={sucheId}
          type="search"
          value={filter.suche}
          placeholder="Name, Ort, Telefon …"
          autoComplete="off"
          aria-label="Suche: Name, Ort, Deal-Nummer, Telefon"
          onChange={(e) => onFilter({ suche: e.target.value })}
        />
      </label>
      <div className="leads-schalter">
        <GlassSwitch
          id={schalterId}
          size="sm"
          checked={filter.nurWartet}
          onCheckedChange={(an) => onFilter({ nurWartet: an })}
          aria-labelledby={`${schalterId}-label`}
        />
        <label id={`${schalterId}-label`} htmlFor={schalterId}>
          Nur „wartet auf uns“
        </label>
      </div>
    </GlassPanel>
  );
}
