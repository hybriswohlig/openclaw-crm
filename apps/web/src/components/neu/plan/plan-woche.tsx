"use client";

import { useDroppable } from "@dnd-kit/core";
import { tagKurz } from "@/lib/anzeige";
import { eintraegeAm, planTitel, wochenTage } from "@/lib/plan-heute";
import { BuchungLeiste } from "./buchung-leiste";
import { KapazitaetChip } from "./kapazitaet-chip";
import { EintragVorschau, PlanEintragKnopf } from "./plan-eintrag";
import type { RasterProps } from "./plan-monat";
import { ablageId, zelleArt, zelleLabel } from "./plan-logik";

/**
 * Woche (Entscheidung 16): sieben Spalten als Liste ohne Stundenraster; je
 * Eintrag Uhrzeit („07:30 Beladen · ca. 13:00 fertig“), Titel, Zeile, Team mit
 * Namen und Fahrzeugtyp. Spaltenkopf öffnet den Tag; jede Spalte ab heute ist
 * während des Ziehens eine Ablage. Unter dem Kopf die Kapazität (Plan 12a).
 */
export function PlanWoche(p: RasterProps) {
  const tage = wochenTage(p.anker);
  return (
    <div className="plan-woche" role="grid" aria-label={planTitel("woche", p.anker)} aria-readonly="true">
      <div
        className="plan-reihe"
        role="row"
        data-buchungen={(p.buchungen ?? []).some((b) => b.von <= tage[6]! && b.bis >= tage[0]!) || undefined}
      >
        <BuchungLeiste buchungen={p.buchungen ?? []} tage={tage} onOeffnen={p.onBuchung} />
        {tage.map((tag) => (
          <WochenSpalte key={tag} tag={tag} {...p} />
        ))}
      </div>
    </div>
  );
}

function WochenSpalte({ tag, anker, heute, eintraege, ziehen, ziehend, schwebend, klickErlaubt, onWaehlen, onTag, kapazitaet }: RasterProps & { tag: string }) {
  const art = zelleArt(tag, anker, heute);
  const ablage = ziehend && !art.vergangen;
  const { setNodeRef, isOver } = useDroppable({ id: ablageId(tag), disabled: !ablage });
  const liste = eintraegeAm(eintraege, tag);
  const vorschau = schwebend && schwebend.ziel === tag ? schwebend.eintrag : null;
  const kap = !art.vergangen ? kapazitaet?.get(tag) ?? null : null;

  return (
    <div
      ref={setNodeRef}
      className="plan-spalte"
      role="gridcell"
      aria-label={zelleLabel(tag, heute, liste.length)}
      data-heute={art.heute || undefined}
      data-vergangen={art.vergangen || undefined}
      data-wochenende={art.wochenende || undefined}
      data-ablage={ablage || undefined}
      data-ueber={(ablage && isOver) || undefined}
    >
      <button type="button" className="plan-spalte-kopf" onClick={() => onTag(tag)} aria-label={`${zelleLabel(tag, heute, liste.length)}, Tag öffnen`}>
        <b>{tagKurz(tag)}</b>
        {art.heute ? <small>heute</small> : null}
      </button>
      {kap ? <KapazitaetChip k={kap} /> : null}
      {liste.map((e) => (
        <PlanEintragKnopf
          key={e.id}
          eintrag={e}
          tag={tag}
          woche
          ziehen={ziehen}
          unterwegs={schwebend?.eintrag.id === e.id}
          klickErlaubt={klickErlaubt}
          onWaehlen={onWaehlen}
        />
      ))}
      {vorschau ? <EintragVorschau eintrag={vorschau} woche /> : null}
      {liste.length === 0 && !vorschau ? <span className="plan-spalte-leer">frei</span> : null}
    </div>
  );
}
