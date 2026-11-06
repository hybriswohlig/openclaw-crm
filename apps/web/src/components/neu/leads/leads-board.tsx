"use client";

import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motionReduced } from "@/components/glassyui/lib/liquid-motion";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import type { LeadKarte as Karte, LeadSpalte, LeadsBoard as Board } from "@/lib/leads-board";
import { KarteInhalt } from "./lead-karte";
import { ablageTexte, eingeklappteSpalten, eingeklapptText, sichtbareSpalten, type Zug, type ZugSeite } from "./leads-logik";
import { LeadsSpalte } from "./leads-spalte";

/** So lange nach dem Ende eines Zugs gilt ein Klick noch als Teil des Zugs. */
const KLICK_SPERRE_MS = 400;

/** Die Spalte als Zugseite (Label für Dialogtexte). */
function seite(s: LeadSpalte): ZugSeite {
  return { stufeId: s.stufeId, kategorie: s.kategorie, label: s.label };
}

/** Zeiger im Rechteck der Ablagefläche, sonst nichts (kein Raten nach Nähe). */
const zeigerImRechteck: CollisionDetection = ({ droppableContainers, pointerCoordinates }) => {
  if (!pointerCoordinates) return [];
  for (const c of droppableContainers) {
    const node = c.node.current;
    if (!node || c.disabled) continue;
    const r = node.getBoundingClientRect();
    if (pointerCoordinates.x >= r.left && pointerCoordinates.x <= r.right && pointerCoordinates.y >= r.top && pointerCoordinates.y <= r.bottom) {
      return [{ id: c.id, data: { droppableContainer: c, value: 0 } }];
    }
  }
  return [];
};

const MESSEN = { droppable: { strategy: MeasuringStrategy.Always } };

/**
 * Das Board (Entscheidungen 2, 3, 18): eine Spalte je sichtbarer Stufe,
 * waagerecht scrollbar; Ziehen mit `@dnd-kit/core`, Ablagefläche nur während
 * des Zugs und nur, wo `zugAktion` etwas auslöst. Nichts wird optimistisch
 * verschoben: nach dem Loslassen meldet das Board den Zug nach oben, die
 * Karte bleibt als Überlagerung im Ziel (`zug`), bis die Seite entschieden hat.
 * Unten die Zeile der eingeklappten Spalten; während eines Zugs werden sie
 * dort zu Ablage-Pillen.
 */
export function LeadsBoard({
  board,
  zug,
  nachladend,
  onZug,
  onMehr,
  onEndstufen,
  onOeffnen,
  onZahlungGemeldet,
}: {
  board: Board;
  zug: Zug | null;
  /** Spalten, die gerade neu oder nachladen. */
  nachladend: ReadonlySet<string>;
  onZug: (karte: Karte, von: ZugSeite, nach: ZugSeite) => void;
  onMehr: (stufeId: string) => void;
  onEndstufen: (zeigen: boolean) => void;
  onOeffnen: (karte: Karte) => void;
  onZahlungGemeldet: (karte: Karte) => void;
}) {
  const portalZiel = usePortalZiel();
  const [aktiv, setAktiv] = useState<Karte | null>(null);
  const [reduziert, setReduziert] = useState(false);
  const letzterZug = useRef(0);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    setReduziert(motionReduced());
  }, []);

  const sichtbar = useMemo(() => sichtbareSpalten(board.spalten), [board.spalten]);
  const eingeklappt = useMemo(() => eingeklappteSpalten(board.spalten), [board.spalten]);
  const ablagen = useMemo(() => (aktiv ? ablageTexte(aktiv, board.spalten) : null), [aktiv, board.spalten]);
  const klickErlaubt = useCallback(() => Date.now() - letzterZug.current > KLICK_SPERRE_MS, []);

  const spalteZu = useCallback((id: string | number | undefined) => board.spalten.find((s) => s.stufeId === id) ?? null, [board.spalten]);

  function zugStart(e: DragStartEvent) {
    const karte = (e.active.data.current as { karte?: Karte } | undefined)?.karte;
    if (karte) setAktiv(karte);
  }

  function zugEnde(e: DragEndEvent) {
    letzterZug.current = Date.now();
    const karte = aktiv;
    setAktiv(null);
    if (!karte || !e.over) return;
    const nach = spalteZu(e.over.id);
    const von = spalteZu(karte.spalteId);
    if (!nach || !von) return;
    onZug(karte, seite(von), seite(nach));
  }

  function zugAbbruch() {
    letzterZug.current = Date.now();
    setAktiv(null);
  }

  // Kartenmenü: derselbe Weg wie das Ziehen.
  const menueZug = useCallback(
    (karte: Karte, nach: ZugSeite) => {
      const von = spalteZu(karte.spalteId);
      if (von) onZug(karte, seite(von), nach);
    },
    [onZug, spalteZu]
  );

  const ueberlagerung = (
    <DragOverlay dropAnimation={reduziert ? null : undefined}>
      {aktiv ? (
        <article className="leads-karte leads-karte-ueberlagerung">
          <KarteInhalt karte={aktiv} />
        </article>
      ) : null}
    </DragOverlay>
  );

  const eingeklapptZeile = eingeklapptText(board.spalten);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={zeigerImRechteck}
      measuring={MESSEN}
      autoScroll
      onDragStart={zugStart}
      onDragEnd={zugEnde}
      onDragCancel={zugAbbruch}
    >
      <div className="leads-board" data-ziehend={aktiv !== null || undefined}>
        {sichtbar.map((s) => (
          <LeadsSpalte
            key={s.stufeId}
            spalte={s}
            stufen={board.stufen}
            ziehend={aktiv !== null}
            ablage={ablagen?.get(s.stufeId) ?? null}
            schwebend={zug && zug.nach.stufeId === s.stufeId ? zug.karte : null}
            unterwegsId={zug && zug.von.stufeId === s.stufeId ? zug.karte.id : null}
            laedt={nachladend.has(s.stufeId)}
            klickErlaubt={klickErlaubt}
            onMehr={onMehr}
            onZug={menueZug}
            onOeffnen={onOeffnen}
            onZahlungGemeldet={onZahlungGemeldet}
          />
        ))}
      </div>

      {eingeklappt.length > 0 ? (
        <div className="leads-eingeklappt">
          {aktiv ? (
            eingeklappt.map((s) => <AblagePille key={s.stufeId} spalte={s} text={ablagen?.get(s.stufeId) ?? null} />)
          ) : (
            <>
              <span>{eingeklapptZeile}</span>
              <span aria-hidden="true"> · </span>
              <button type="button" className="leads-eingeklappt-knopf" onClick={() => onEndstufen(true)}>
                anzeigen
              </button>
            </>
          )}
        </div>
      ) : board.spalten.some((s) => s.kategorie === "lost" || s.kategorie === "kein_lead") ? (
        <div className="leads-eingeklappt">
          <span>Verloren und Kein Lead werden angezeigt</span>
          <span aria-hidden="true"> · </span>
          <button type="button" className="leads-eingeklappt-knopf" onClick={() => onEndstufen(false)}>
            ausblenden
          </button>
        </div>
      ) : null}

      {portalZiel ? createPortal(ueberlagerung, portalZiel) : ueberlagerung}
    </DndContext>
  );
}

/** Eingeklappte Spalte als Ablage während eines Zugs: „Verloren · Hierher ziehen = Als verloren markieren“. */
function AblagePille({ spalte, text }: { spalte: LeadSpalte; text: string | null }) {
  const { setNodeRef, isOver } = useDroppable({ id: spalte.stufeId, disabled: text === null });
  if (text === null) return null;
  return (
    <span ref={setNodeRef} className="leads-eingeklappt-pille" data-ueber={isOver || undefined}>
      <i className="leads-punkt" data-ton={spalte.ton} aria-hidden="true" />
      <b>{spalte.label}</b> · {text}
    </span>
  );
}
