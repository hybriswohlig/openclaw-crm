"use client";

import { useDroppable } from "@dnd-kit/core";
import { summeAnzeige, type LeadKarte as Karte, type LeadSpalte, type LeadsStammdaten } from "@/lib/leads-board";
import { KartenMenue } from "./karten-menue";
import { KarteInhalt, LeadKarte } from "./lead-karte";
import type { ZugSeite } from "./leads-logik";

/**
 * Eine Spalte des Boards (Entscheidung 2): Kopf mit Punkt, Name, Anzahl,
 * Summe und Satz; die geladenen Karten; während eines Zugs die Ablagefläche
 * mit dem Text der Aktion; „Mehr laden“, solange der Server weitere Seiten
 * hat. `schwebend` ist die Karte, die nach dem Loslassen hier auf die
 * Entscheidung wartet.
 */
export function LeadsSpalte({
  spalte,
  stufen,
  ziehend,
  ablage,
  schwebend,
  unterwegsId,
  laedt,
  klickErlaubt,
  onMehr,
  onZug,
  onOeffnen,
  onZahlungGemeldet,
}: {
  spalte: LeadSpalte;
  stufen: LeadsStammdaten["stufen"];
  ziehend: boolean;
  /** Text der Ablagefläche für die gezogene Karte; null = kein Ziel. */
  ablage: string | null;
  schwebend: Karte | null;
  unterwegsId: string | null;
  laedt: boolean;
  klickErlaubt: () => boolean;
  onMehr: (stufeId: string) => void;
  onZug: (karte: Karte, nach: ZugSeite) => void;
  onOeffnen: (karte: Karte) => void;
  onZahlungGemeldet: (karte: Karte) => void;
}) {
  const ziel = ziehend && ablage !== null;
  const { setNodeRef, isOver } = useDroppable({ id: spalte.stufeId, disabled: !ziel });
  const summe = summeAnzeige(spalte.summeCent, spalte.summeGeschaetzt);

  return (
    <section
      ref={setNodeRef}
      className="leads-spalte"
      data-ziel={ziel || undefined}
      data-ueber={(ziel && isOver) || undefined}
      aria-label={`${spalte.label}, ${spalte.anzahl} ${spalte.anzahl === 1 ? "Lead" : "Leads"}`}
      aria-busy={laedt || undefined}
    >
      <header className="leads-spalte-kopf">
        <div className="leads-spalte-titel">
          <i className="leads-punkt" data-ton={spalte.ton} aria-hidden="true" />
          <h2>{spalte.label}</h2>
          <span className="leads-spalte-anzahl">{spalte.anzahl}</span>
          {summe ? <span className="leads-spalte-summe">{summe}</span> : null}
        </div>
        <p className="leads-spalte-satz">{spalte.satz}</p>
      </header>

      <div className="leads-spalte-karten">
        {/* Oben, damit sie auch in einer langen Spalte sichtbar bleibt. */}
        {schwebend ? (
          <article className="leads-karte leads-karte-schwebt" aria-label={`${schwebend.name}, wartet auf Entscheidung`}>
            <KarteInhalt karte={schwebend} />
          </article>
        ) : null}
        {spalte.karten.map((k) => (
          <LeadKarte
            key={k.id}
            karte={k}
            unterwegs={k.id === unterwegsId}
            klickErlaubt={klickErlaubt}
            menue={<KartenMenue karte={k} stufen={stufen} onZug={onZug} />}
            onOeffnen={onOeffnen}
            onZahlungGemeldet={onZahlungGemeldet}
          />
        ))}
        {ziel ? (
          <div className="leads-ablage" data-ueber={isOver || undefined}>
            {ablage}
          </div>
        ) : null}
        {spalte.weiter !== null ? (
          <button type="button" className="leads-mehr" disabled={laedt} onClick={() => onMehr(spalte.stufeId)}>
            {laedt ? "Lädt …" : `Mehr laden (${spalte.anzahl - spalte.karten.length} weitere)`}
          </button>
        ) : null}
      </div>
    </section>
  );
}
