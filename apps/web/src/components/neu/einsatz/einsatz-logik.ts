/**
 * Zustand des Einsatz-Dialogs (Plan 12a Task U, von 12c mitbenutzt): Auswahl,
 * Rolle und Minuten je Person. Rein, ohne React. Minuten folgen der Zahl der
 * Ausgewählten (`planMinutenJePerson`), bis jemand sie von Hand ändert.
 */
import {
  einsatzKosten,
  lohnVergleich,
  planMinutenJePerson,
  type EinsatzKostenZeile,
  type EinsatzPerson,
  type LohnVergleich,
  type TeamRolle,
  type TeamWunsch,
} from "@/lib/einsatz";
import type { EinsatzAnsicht, EinsatzPersonLage } from "@/lib/einsatz-ansicht";

export interface AuswahlEintrag {
  employeeId: string;
  role: TeamRolle;
  fahrtMin: number | null;
  arbeitMin: number | null;
  /** Von Hand geänderte Minuten bleiben, wenn sich das Team ändert. */
  vonHand: { fahrt: boolean; arbeit: boolean };
}

export interface Auswahl {
  team: AuswahlEintrag[];
  /** Personen, die trotz Belegung oder Abwesenheit bewusst eingeteilt wurden. */
  bestaetigtAmTag: string[];
}

type RechnerTeil = Pick<NonNullable<EinsatzAnsicht["rechner"]>, "fahrtMin" | "personenH" | "personalStunden"> | null;

/** Minuten je Person für `n` Ausgewählte aus dem Rechner-Ergebnis. */
export function minutenFuer(rechner: RechnerTeil, n: number): { fahrtMin: number | null; arbeitMin: number | null } {
  return planMinutenJePerson({
    teamgroesse: Math.max(1, n),
    fahrtMin: rechner?.fahrtMin ?? null,
    personenH: rechner?.personenH ?? null,
    personalStunden: rechner?.personalStunden ?? null,
  });
}

/** Minuten aller nicht von Hand geänderten Einträge an die Teamgröße anpassen. */
function neuVerteilt(team: AuswahlEintrag[], rechner: RechnerTeil): AuswahlEintrag[] {
  const m = minutenFuer(rechner, team.length);
  return team.map((t) => ({
    ...t,
    fahrtMin: t.vonHand.fahrt ? t.fahrtMin : m.fahrtMin,
    arbeitMin: t.vonHand.arbeit ? t.arbeitMin : m.arbeitMin,
  }));
}

/** Rollen ordnen: genau eine Person leitet, solange jemand im Team ist. */
function mitLead(team: AuswahlEintrag[]): AuswahlEintrag[] {
  if (team.length === 0 || team.some((t) => t.role === "lead")) return team;
  return team.map((t, i) => (i === 0 ? { ...t, role: "lead" } : t));
}

/**
 * Startauswahl: das heutige Team mit seinen Minuten; ohne Team der Vorschlag.
 * Gespeicherte Minuten zählen als von Hand gesetzt, wenn sie von der
 * Verteilung des Rechners abweichen.
 */
export function startAuswahl(a: Pick<EinsatzAnsicht, "team" | "teamVorschlag" | "rechner">): Auswahl {
  if (a.team.length > 0) {
    const m = minutenFuer(a.rechner, a.team.length);
    const team = a.team.map((z) => ({
      employeeId: z.employeeId,
      role: (z.role === "lead" ? "lead" : "helper") as TeamRolle,
      fahrtMin: z.plannedDriveMinutes ?? m.fahrtMin,
      arbeitMin: z.plannedWorkMinutes ?? m.arbeitMin,
      vonHand: {
        fahrt: z.plannedDriveMinutes !== null && z.plannedDriveMinutes !== m.fahrtMin,
        arbeit: z.plannedWorkMinutes !== null && z.plannedWorkMinutes !== m.arbeitMin,
      },
    }));
    return { team: mitLead(team), bestaetigtAmTag: [] };
  }
  return vorschlagUebernehmen(a);
}

/** „Vorschlag übernehmen“: setzt nur die Auswahl. */
export function vorschlagUebernehmen(a: Pick<EinsatzAnsicht, "teamVorschlag" | "rechner">): Auswahl {
  const team = a.teamVorschlag.team.map((w) => ({
    employeeId: w.employeeId,
    role: w.role,
    fahrtMin: null,
    arbeitMin: null,
    vonHand: { fahrt: false, arbeit: false },
  }));
  return { team: mitLead(neuVerteilt(team, a.rechner)), bestaetigtAmTag: [] };
}

export function imTeam(s: Auswahl, id: string): boolean {
  return s.team.some((t) => t.employeeId === id);
}

export function auswahlHinzufuegen(s: Auswahl, id: string, rechner: RechnerTeil, opts: { trotzdem?: boolean } = {}): Auswahl {
  if (imTeam(s, id)) return s;
  const team = [...s.team, { employeeId: id, role: "helper" as TeamRolle, fahrtMin: null, arbeitMin: null, vonHand: { fahrt: false, arbeit: false } }];
  const bestaetigtAmTag = opts.trotzdem && !s.bestaetigtAmTag.includes(id) ? [...s.bestaetigtAmTag, id] : s.bestaetigtAmTag;
  return { team: mitLead(neuVerteilt(team, rechner)), bestaetigtAmTag };
}

export function auswahlEntfernen(s: Auswahl, id: string, rechner: RechnerTeil): Auswahl {
  if (!imTeam(s, id)) return s;
  const team = s.team.filter((t) => t.employeeId !== id);
  return { team: mitLead(neuVerteilt(team, rechner)), bestaetigtAmTag: s.bestaetigtAmTag.filter((x) => x !== id) };
}

export function leitungSetzen(s: Auswahl, id: string): Auswahl {
  if (!imTeam(s, id)) return s;
  return { ...s, team: s.team.map((t) => ({ ...t, role: t.employeeId === id ? "lead" : "helper" })) };
}

/** Minuten von Hand (null hebt die Hand-Eingabe auf und verteilt neu). */
export function minutenSetzen(s: Auswahl, id: string, teil: "fahrt" | "arbeit", wert: number | null, rechner: RechnerTeil): Auswahl {
  const team = s.team.map((t) => {
    if (t.employeeId !== id) return t;
    return teil === "fahrt"
      ? { ...t, fahrtMin: wert, vonHand: { ...t.vonHand, fahrt: wert !== null } }
      : { ...t, arbeitMin: wert, vonHand: { ...t.vonHand, arbeit: wert !== null } };
  });
  return { ...s, team: neuVerteilt(team, rechner) };
}

export interface Summe {
  kosten: EinsatzKostenZeile[];
  vergleich: LohnVergleich;
}

/** Kostenzeilen und Vergleich mit der Kalkulation für die aktuelle Auswahl (gleiche Funktionen wie der Server). */
export function summeAus(s: Auswahl, a: Pick<EinsatzAnsicht, "personen" | "rechner" | "anfahrten">): Summe {
  const team = s.team
    .map((t) => {
      const person: EinsatzPerson | undefined = a.personen.find((p) => p.id === t.employeeId);
      return person ? { person, fahrtMin: t.fahrtMin, arbeitMin: t.arbeitMin } : null;
    })
    .filter((x): x is { person: EinsatzPerson; fahrtMin: number | null; arbeitMin: number | null } => x !== null);
  const kosten = einsatzKosten({
    team,
    fahrzeugEur: a.rechner?.fahrzeugEur ?? null,
    fahrzeugName: a.rechner?.fahrzeugName ?? null,
    anfahrten: a.anfahrten,
  });
  const vergleich = lohnVergleich({
    kosten,
    posten: a.rechner?.posten,
    festpreisEur: a.rechner?.festpreisEur ?? null,
    selbstkostenEur: a.rechner?.selbstkostenEur ?? null,
  });
  return { kosten, vergleich };
}

/** Nutzlast für `PUT …/einsatz`. */
export function teamBody(s: Auswahl): { team: TeamWunsch[]; bestaetigtAmTag?: string[] } {
  const team = s.team.map((t) => ({
    employeeId: t.employeeId,
    role: t.role,
    plannedDriveMinutes: t.fahrtMin === null ? null : Math.max(0, Math.min(1440, Math.round(t.fahrtMin))),
    plannedWorkMinutes: t.arbeitMin === null ? null : Math.max(0, Math.min(1440, Math.round(t.arbeitMin))),
  }));
  return s.bestaetigtAmTag.length > 0 ? { team, bestaetigtAmTag: [...s.bestaetigtAmTag] } : { team };
}

/** Hat sich die Auswahl gegenüber dem gespeicherten Team geändert? */
export function geaendert(s: Auswahl, a: Pick<EinsatzAnsicht, "team">): boolean {
  if (s.team.length !== a.team.length) return true;
  return s.team.some((t) => {
    const z = a.team.find((x) => x.employeeId === t.employeeId);
    return !z || z.role !== t.role || z.plannedDriveMinutes !== t.fahrtMin || z.plannedWorkMinutes !== t.arbeitMin;
  });
}

export type Rueckfrage = { art: "belegt" | "abwesend"; person: EinsatzPersonLage; text: string };

/** „hat … Urlaub“, „ist … krank“, „ist … gesperrt“. */
const ABWESEND_SATZ = {
  urlaub: (name: string, tag: string) => `${name} hat am ${tag} Urlaub.`,
  krank: (name: string, tag: string) => `${name} ist am ${tag} krank gemeldet.`,
  gesperrt: (name: string, tag: string) => `${name} ist am ${tag} gesperrt.`,
} as const;

/** Rückfrage vor dem Hinzufügen (12c-5 Texte); null = ohne Rückfrage hinzufügen. */
export function rueckfrageFuer(p: EinsatzPersonLage, tagText: string, s: Auswahl): Rueckfrage | null {
  if (imTeam(s, p.id) || s.bestaetigtAmTag.includes(p.id)) return null;
  if (p.lage === "abwesend" && p.abwesend) {
    return { art: "abwesend", person: p, text: `${ABWESEND_SATZ[p.abwesend](p.name, tagText)} Trotzdem einteilen?` };
  }
  if (p.lage === "belegt") {
    const titel = p.belegtMit.map((d) => d.titel).join(", ") || "einem anderen Umzug";
    return { art: "belegt", person: p, text: `${p.name} ist am ${tagText} schon bei ${titel} eingeteilt. Trotzdem einteilen?` };
  }
  return null;
}
