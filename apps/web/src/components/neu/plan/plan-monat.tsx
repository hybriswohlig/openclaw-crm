"use client";

import { useDroppable } from "@dnd-kit/core";
import type { KapazitaetTag } from "@/lib/einsatz";
import { WOCHENTAGE_KURZ, monatsRaster, planTitel, type PlanEintrag } from "@/lib/plan-heute";
import { KapazitaetChip } from "./kapazitaet-chip";
import { EintragVorschau, PlanEintragKnopf, type EintragWahl } from "./plan-eintrag";
import { ablageId, mehrText, zelleArt, zelleEintraege, zelleLabel, zelleZusatz } from "./plan-logik";

export interface RasterProps {
  anker: string;
  heute: string;
  eintraege: readonly PlanEintrag[];
  /** Ziehen erlaubt (Desktop, kein Zug offen). */
  ziehen: boolean;
  /** Gerade wird gezogen: Ablageflächen zeigen sich. */
  ziehend: boolean;
  /** Rückfrage offen: Eintrag blass im Ursprung, Vorschau im Ziel. */
  schwebend: { eintrag: PlanEintrag; ziel: string } | null;
  klickErlaubt: () => boolean;
  onWaehlen: EintragWahl;
  onTag: (tag: string) => void;
  /** Plan 12a: Kapazität je Tag; null = Schalter aus oder keine aktiven Mitarbeiter. */
  kapazitaet?: ReadonlyMap<string, KapazitaetTag> | null;
}

/**
 * Monatsraster (Mockup 04, Entscheidung 15): volle Wochen Mo bis So samt
 * Nachbartagen (blass), heute blau umrandet, Wochenende getönt, vergangene
 * Tage gedämpft, am Monatsersten „Nov“. Je Zelle höchstens drei Einträge,
 * dann „+N weitere“; Klick auf Datum oder „weitere“ öffnet den Tag. Jede
 * Zelle ab heute ist während des Ziehens eine Ablage.
 */
export function PlanMonat(p: RasterProps) {
  const wochen = monatsRaster(p.anker);
  return (
    <div className="plan-monat" role="grid" aria-label={planTitel("monat", p.anker)} aria-readonly="true">
      <div className="plan-wochentage" role="row">
        {WOCHENTAGE_KURZ.map((t) => (
          <div key={t} role="columnheader">
            {t}
          </div>
        ))}
      </div>
      {wochen.map((w) => (
        <div key={w[0]} className="plan-reihe" role="row">
          {w.map((tag) => (
            <MonatZelle key={tag} tag={tag} {...p} />
          ))}
        </div>
      ))}
    </div>
  );
}

function MonatZelle({ tag, anker, heute, eintraege, ziehen, ziehend, schwebend, klickErlaubt, onWaehlen, onTag, kapazitaet }: RasterProps & { tag: string }) {
  const art = zelleArt(tag, anker, heute);
  const ablage = ziehend && !art.vergangen;
  const { setNodeRef, isOver } = useDroppable({ id: ablageId(tag), disabled: !ablage });
  const { sichtbar, mehr } = zelleEintraege(eintraege, tag);
  const zusatz = zelleZusatz(tag, heute);
  const vorschau = schwebend && schwebend.ziel === tag ? schwebend.eintrag : null;
  const anzahl = sichtbar.length + mehr;
  const kap = !art.nachbar && !art.vergangen ? kapazitaet?.get(tag) ?? null : null;

  return (
    <div
      ref={setNodeRef}
      className="plan-zelle"
      role="gridcell"
      aria-label={zelleLabel(tag, heute, anzahl)}
      data-heute={art.heute || undefined}
      data-vergangen={art.vergangen || undefined}
      data-wochenende={art.wochenende || undefined}
      data-nachbar={art.nachbar || undefined}
      data-ablage={ablage || undefined}
      data-ueber={(ablage && isOver) || undefined}
    >
      <button type="button" className="plan-zelle-datum" onClick={() => onTag(tag)} aria-label={`${zelleLabel(tag, heute, anzahl)}, Tag öffnen`}>
        {Number(tag.slice(8))}
        {zusatz ? <small>{zusatz}</small> : null}
      </button>
      {kap ? <KapazitaetChip k={kap} /> : null}
      {sichtbar.map((e) => (
        <PlanEintragKnopf
          key={e.id}
          eintrag={e}
          tag={tag}
          woche={false}
          ziehen={ziehen}
          unterwegs={schwebend?.eintrag.id === e.id}
          klickErlaubt={klickErlaubt}
          onWaehlen={onWaehlen}
        />
      ))}
      {vorschau ? <EintragVorschau eintrag={vorschau} woche={false} /> : null}
      {mehr > 0 ? (
        <button type="button" className="plan-mehr" onClick={() => onTag(tag)}>
          {mehrText(mehr)}
        </button>
      ) : null}
    </div>
  );
}
