"use client";

import { useDraggable } from "@dnd-kit/core";
import type { PlanEintrag } from "@/lib/plan-heute";
import { TON_TEXT, teamText, teamZeigen } from "./plan-zeile-logik";

/** Füllungen der Team-Kürzel wie Board und Plan-Zeile: dunkle Tinten, weiße Schrift erreicht 4,5:1. */
const KUERZEL_FARBEN = ["var(--ink)", "var(--jade-ink)", "var(--blue-ink)", "var(--violet)", "var(--gold-ink)"] as const;

export type EintragWahl = (e: PlanEintrag, anker: HTMLElement) => void;

/** ID des ziehbaren Eintrags; je Tag eindeutig, weil mehrtägige an jedem Tag stehen. */
export function ziehId(e: PlanEintrag, tag: string): string {
  return `${e.id}@${tag}`;
}

/** Vorlesetext: „Familie Can, fest, Team steht, Umzug · 2.950 € · Stuttgart-Süd → Esslingen“. */
function eintragLabel(e: PlanEintrag, woche: boolean): string {
  return [e.titel, TON_TEXT[e.ton], woche ? e.zeitText : null, e.zeile].filter(Boolean).join(", ");
}

/**
 * Inhalt eines Eintrags im Monat (Mockup 04: Titel, Zeile, Team-Kürzel,
 * Firmenpunkt) bzw. in der Woche (dazu Uhrzeit, Team mit Namen und
 * Fahrzeugtyp). Auch für die Überlagerung beim Ziehen.
 */
export function EintragInhalt({ eintrag: e, woche }: { eintrag: PlanEintrag; woche: boolean }) {
  const team = teamZeigen(e);
  return (
    <>
      {woche ? <span className="plan-eintrag-zeit">{e.zeitText ?? "ganztägig"}</span> : null}
      <span className="plan-eintrag-kopf">
        <b>{e.titel}</b>
        {e.firma ? <i className="plan-eintrag-firma" style={{ background: e.firma.farbe }} title={e.firma.name} /> : null}
      </span>
      <small>{e.zeile}</small>
      {team ? (
        <span className="plan-eintrag-team">
          <span className="plan-kuerzel">
            {e.team.map((m, i) => (
              <span key={`${m.name}-${i}`} style={{ background: KUERZEL_FARBEN[i % KUERZEL_FARBEN.length] }} title={m.name}>
                {m.kuerzel}
              </span>
            ))}
            {e.teamFehlt ? (
              <span className="plan-kuerzel-fehlt" title="Team unvollständig">
                ?
              </span>
            ) : null}
          </span>
          {woche ? <span className="plan-eintrag-namen">{teamText(e)}</span> : null}
        </span>
      ) : null}
      {woche && e.transporter ? <span className="plan-eintrag-wagen">{e.transporter}</span> : null}
    </>
  );
}

/**
 * Ein Eintrag im Monat oder in der Woche: Knopf, der das Popover öffnet;
 * ziehbar nur, wenn `ziehbar` (fester Umzug ab heute, Entscheidung 7) und die
 * Ansicht Ziehen erlaubt. `unterwegs`: die Rückfrage läuft, der Eintrag steht
 * blass an seinem Platz, bis sie entschieden ist.
 */
export function PlanEintragKnopf({
  eintrag: e,
  tag,
  woche,
  ziehen,
  unterwegs,
  klickErlaubt,
  onWaehlen,
}: {
  eintrag: PlanEintrag;
  tag: string;
  woche: boolean;
  ziehen: boolean;
  unterwegs: boolean;
  klickErlaubt: () => boolean;
  onWaehlen: EintragWahl;
}) {
  const darf = ziehen && e.ziehbar && !unterwegs;
  const { listeners, setNodeRef, isDragging } = useDraggable({ id: ziehId(e, tag), data: { eintrag: e }, disabled: !darf });
  return (
    <button
      ref={setNodeRef}
      type="button"
      className="plan-eintrag"
      data-ton={e.ton}
      data-woche={woche || undefined}
      data-ziehbar={darf || undefined}
      data-ziehend={isDragging || undefined}
      data-unterwegs={unterwegs || undefined}
      data-eintrag={e.id}
      aria-label={eintragLabel(e, woche)}
      aria-haspopup="dialog"
      {...(darf ? listeners : {})}
      onClick={(ev) => {
        if (!klickErlaubt()) return;
        onWaehlen(e, ev.currentTarget);
      }}
    >
      <EintragInhalt eintrag={e} woche={woche} />
    </button>
  );
}

/** Vorschau im Zieltag, solange die Rückfrage offen ist (nichts optimistisch). */
export function EintragVorschau({ eintrag: e, woche }: { eintrag: PlanEintrag; woche: boolean }) {
  return (
    <div className="plan-eintrag" data-ton={e.ton} data-vorschau data-woche={woche || undefined} aria-hidden="true">
      <EintragInhalt eintrag={e} woche={woche} />
    </div>
  );
}
