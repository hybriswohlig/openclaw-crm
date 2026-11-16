"use client";

import { useId } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import { tagKurz, uhrzeitKurz } from "@/lib/anzeige";
import type { EinsatzAnfrage, EinsatzPersonLage } from "@/lib/einsatz-ansicht";
import { anfragenGruppen } from "./einsatz-logik";

const ANTWORT_TEXT: Record<EinsatzAnfrage["answer"], string> = {
  ja: "Ja",
  warteliste: "Warteliste",
  vielleicht: "Vielleicht",
  nein: "Nein",
};

/**
 * Antworten aus dem Crew-Portal im Einsatz-Dialog. „Ins Team“ nimmt die Person
 * in die Auswahl (gleiche Rückfragen wie der Haken in der Liste); gespeichert
 * wird wie immer erst mit „Team bestätigen“.
 */
export function EinsatzAnfragen({
  anfragen,
  personen,
  imTeam,
  onInsTeam,
}: {
  anfragen: EinsatzAnfrage[];
  personen: EinsatzPersonLage[];
  imTeam: (id: string) => boolean;
  onInsTeam: (p: EinsatzPersonLage) => void;
}) {
  const titelId = useId();
  if (anfragen.length === 0) return null;
  const g = anfragenGruppen(anfragen);

  const zeile = (a: EinsatzAnfrage) => {
    const p = personen.find((x) => x.id === a.employeeId) ?? null;
    const drin = imTeam(a.employeeId);
    return (
      <li key={a.employeeId} className="ez-anfrage" data-antwort={a.answer}>
        <span className="ez-anfrage-name">{a.name}</span>
        <span className="ez-marke">{ANTWORT_TEXT[a.answer]}</span>
        <span className="ez-anfrage-zeit">
          {tagKurz(a.answeredAt)}, {uhrzeitKurz(a.answeredAt)}
        </span>
        {drin ? (
          <span className="ez-anfrage-drin">kommt ins Team</span>
        ) : p ? (
          <GlassButton type="button" size="sm" variant="ghost" onClick={() => onInsTeam(p)}>
            Ins Team
          </GlassButton>
        ) : (
          <span className="ez-anfrage-drin">deaktiviert</span>
        )}
      </li>
    );
  };

  return (
    <section className="ez-anfragen" aria-labelledby={titelId}>
      <h3 id={titelId}>Anfragen aus dem Crew-Portal</h3>
      <p className="ez-notiz">„Ja“ ist nur eine Anfrage. Dabei ist erst, wer hier im Team steht und bestätigt ist.</p>
      {g.vorn.length + g.vielleicht.length > 0 ? (
        <ul className="ez-anfragen-liste">
          {g.vorn.map(zeile)}
          {g.vielleicht.map(zeile)}
        </ul>
      ) : null}
      {g.nein.length > 0 ? (
        <details className="ez-anfragen-nein">
          <summary>Nein ({g.nein.length})</summary>
          <ul className="ez-anfragen-liste">{g.nein.map(zeile)}</ul>
        </details>
      ) : null}
    </section>
  );
}
