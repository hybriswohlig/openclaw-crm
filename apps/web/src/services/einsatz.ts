/**
 * Einsatz eines Deals (Plan 12a, Entscheidungen 5, 7, 9, 12): Ansicht mit
 * Vorschlag, Kapazität und Kosten (liest nur, schreibt nie `deal_employees`)
 * und „Team bestätigen“ (einziger Schreibweg der neuen Oberfläche).
 *
 * Maßgeblich ist die neueste gesperrte Kalkulationsversion, sonst der Entwurf
 * (dieselbe Wahl wie Schritt 7). Kapazität folgt dem Termin des Deals im Plan.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { dealCalculationVersions, dealEmployees, employeeTimeEntries, employees } from "@/db/schema";
import { berlinDateString } from "@/lib/berlin-date";
import {
  auslastungAus,
  doppelteAmTag,
  einsatzKosten,
  fahrzeugEurAus,
  festeEinsaetzeAus,
  istFest,
  kapazitaetAus,
  lageAmEinsatz,
  lohnVergleich,
  naechsterTag,
  planMinutenJePerson,
  pruefeTeam,
  teamAenderung,
  teamVorschlag,
  KALK_TEAM_KEYS,
  type Abwesenheit,
  type DoppelKonflikt,
  type EinsatzFehlerCode,
  type EinsatzPerson,
  type FesterEinsatz,
  type TeamWunsch,
  type Zuteilung,
} from "@/lib/einsatz";
import type { EinsatzAnsicht, EinsatzPersonLage, EinsatzRechnerDaten, EinsatzZuteilung } from "@/lib/einsatz-ansicht";
import { wirksameUebersteuerungen, type Uebersteuerung } from "@/lib/kalkulation-versionen";
import type { PlanEintrag } from "@/lib/plan-heute";
import { anfahrtenLaden } from "./einsatz-geo";
import { ladeAbwesenheiten, ladePersonen, type DbExecutor } from "./einsatz-personen";
import type { RechnerAnfrage } from "./rechner/eingabe";
import type { RechnerErgebnis } from "./rechner/client";

export type { EinsatzAnsicht } from "@/lib/einsatz-ansicht";

// ─── Tage und feste Einsätze ─────────────────────────────────────────────────

/** Feste Einsätze im Fenster (alle Firmen) und die Plan-Einträge, aus denen sie stammen. */
export async function festeEinsaetze(ws: string, von: string, bis: string): Promise<{ einsaetze: FesterEinsatz[]; eintraege: PlanEintrag[] }> {
  const { ladePlanEintraege, teamIdsLesen } = await import("./plan");
  const { eintraege } = await ladePlanEintraege(ws, { von, bis, firmaId: null, mitarbeiterId: null, leads: null });
  const festeDeals = [...new Set(eintraege.filter(istFest).map((e) => e.dealId))];
  const teamIds = await teamIdsLesen(ws, festeDeals);
  return { einsaetze: festeEinsaetzeAus(eintraege, teamIds), eintraege };
}

/**
 * Tage des Umzugs: die festen Umzug-Einträge des Deals; ohne festen Eintrag
 * die aus `move_date` oder der Datumswahl im Portal. Wunsch- und
 * Angebotstage zählen nicht (sonst müsste jemand an zehn Tagen frei sein).
 */
export function dealTage(eintraege: readonly PlanEintrag[], dealId: string): string[] {
  const eigene = eintraege.filter((e) => e.dealId === dealId && e.art === "umzug");
  const feste = eigene.filter(istFest);
  const quelle = feste.length > 0 ? feste : eigene.filter((e) => e.datumQuelle === "feld" || e.datumQuelle === "auswahl");
  const tage = new Set<string>();
  for (const e of quelle) {
    for (let t = e.tag; t <= e.bisTag && tage.size < 31; t = naechsterTag(t)) tage.add(t);
  }
  return [...tage].sort();
}

function tagPlus(tag: string, n: number): string {
  const [j, m, d] = tag.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(j, m - 1, d + n)).toISOString().slice(0, 10);
}

// ─── Laden ───────────────────────────────────────────────────────────────────

type VersionRoh = {
  version: number;
  status: "entwurf" | "gesperrt";
  rechnerRequest: unknown;
  rechnerResult: unknown;
  overrides: unknown;
};

/** Neueste gesperrte Version, sonst der Entwurf. */
export async function massgeblicheVersion(ws: string, deal: string, ex: DbExecutor = db): Promise<VersionRoh | null> {
  const rows = await ex
    .select({
      version: dealCalculationVersions.version,
      status: dealCalculationVersions.status,
      rechnerRequest: dealCalculationVersions.rechnerRequest,
      rechnerResult: dealCalculationVersions.rechnerResult,
      overrides: dealCalculationVersions.overrides,
    })
    .from(dealCalculationVersions)
    .where(and(eq(dealCalculationVersions.workspaceId, ws), eq(dealCalculationVersions.dealRecordId, deal)))
    .orderBy(desc(dealCalculationVersions.version));
  return (rows.find((r) => r.status === "gesperrt") ?? rows.find((r) => r.status !== "gesperrt") ?? null) as VersionRoh | null;
}

async function zuteilungenLesen(ws: string, deal: string, ex: DbExecutor = db): Promise<EinsatzZuteilung[]> {
  const rows = await ex
    .select({
      id: dealEmployees.id,
      employeeId: dealEmployees.employeeId,
      role: dealEmployees.role,
      plannedDriveMinutes: dealEmployees.plannedDriveMinutes,
      plannedWorkMinutes: dealEmployees.plannedWorkMinutes,
      confirmedAt: dealEmployees.confirmedAt,
    })
    .from(dealEmployees)
    .innerJoin(employees, and(eq(employees.id, dealEmployees.employeeId), eq(employees.workspaceId, ws)))
    .where(eq(dealEmployees.dealRecordId, deal))
    .orderBy(dealEmployees.createdAt, dealEmployees.id);
  return rows.map((r) => ({ ...r, confirmedAt: r.confirmedAt ? r.confirmedAt.toISOString() : null }));
}

async function offeneStempel(ws: string, deal: string, ex: DbExecutor = db): Promise<Set<string>> {
  const rows = await ex
    .select({ employeeId: employeeTimeEntries.employeeId })
    .from(employeeTimeEntries)
    .where(and(eq(employeeTimeEntries.workspaceId, ws), eq(employeeTimeEntries.dealRecordId, deal), isNull(employeeTimeEntries.endAt)));
  return new Set(rows.map((r) => r.employeeId));
}

const endlich = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) ? n : null);
const text = (w: unknown): string | null => (typeof w === "string" && w.trim() !== "" ? w.trim() : null);

/** Was der Browser zum Nachrechnen braucht; null ohne Rechner-Ergebnis. */
export function rechnerDatenAus(anfrage: RechnerAnfrage | null, e: RechnerErgebnis | null): EinsatzRechnerDaten | null {
  if (!e) return null;
  const posten = (e.kosten?.posten ?? [])
    .filter((p): p is typeof p & { key: string } => typeof p.key === "string" && Number.isFinite(p.betrag))
    .filter((p) => KALK_TEAM_KEYS.includes(p.key) || p.key.startsWith("fahrzeug."))
    .map((p) => ({ key: p.key, betrag: p.betrag }));
  const opt = e.empfehlungOptionId ? (e.fahrzeugoptionen ?? []).find((o) => o.id === e.empfehlungOptionId) ?? null : null;
  const ps = e.kosten?.personalStunden;
  return {
    groesse: endlich(e.team?.groesse),
    auftragsart: text(anfrage?.auftragsart),
    fahrtMin: endlich(e.zeiten?.fahrtMin),
    personenH: endlich(e.kosten?.personenH),
    personalStunden: ps ? { arbeitPm: ps.arbeitPm, fahrerPm: ps.fahrerPm, fahrzeitPm: ps.fahrzeitPm, pufferProzent: ps.pufferProzent } : null,
    posten,
    festpreisEur: endlich(e.preis?.festpreis),
    selbstkostenEur: endlich(e.preis?.selbstkosten ?? e.kosten?.selbstkosten),
    // 12b: steckt eine Buchung im Preis, ist die Fahrzeugzeile ihr Anteil.
    fahrzeugName: opt?.name?.trim() ? `${opt.name.trim()}${typeof anfrage?.buchung === "string" && anfrage.buchung !== "" ? ", Anteil Buchung" : ""}` : null,
    fahrzeugEur: fahrzeugEurAus(posten),
    station: e.mietstation?.name ?? null,
    empfehlung: opt ? { id: opt.id, name: opt.name, fahrten: opt.fahrten, km: opt.km } : null,
  };
}

export interface EinsatzLadeOptionen {
  frisch?: boolean;
  jetzt?: Date;
}

export async function ladeEinsatz(ws: string, deal: string, o: EinsatzLadeOptionen = {}): Promise<EinsatzAnsicht> {
  const jetzt = o.jetzt ?? new Date();
  const heute = berlinDateString(jetzt);
  const { ladeDealKopf } = await import("./kalkulations-ansicht-db");
  const [kopf, v, personen, team, stempel] = await Promise.all([
    ladeDealKopf(ws, deal),
    massgeblicheVersion(ws, deal),
    ladePersonen(ws),
    zuteilungenLesen(ws, deal),
    offeneStempel(ws, deal),
  ]);
  const anfrage = (v?.rechnerRequest ?? null) as RechnerAnfrage | null;
  const ergebnis = (v?.rechnerResult ?? null) as RechnerErgebnis | null;
  let beladen = text(anfrage?.von_adresse);
  let entladen = text(anfrage?.nach_adresse);
  let datum = text(anfrage?.umzugsdatum);
  if (!v) {
    const { ladeLeadDaten } = await import("./rechner/lead-daten");
    const lead = await ladeLeadDaten(ws, deal).catch(() => null);
    beladen = text(lead?.von);
    entladen = text(lead?.nach);
    datum = text(lead?.umzugsdatum);
  }

  const von = datum ? tagPlus(datum, -7) : heute;
  const bis = datum ? tagPlus(datum, 21) : tagPlus(heute, 120);
  const { einsaetze, eintraege } = await festeEinsaetze(ws, von, bis);
  const tage = dealTage(eintraege, deal);
  const fest = eintraege.some((e) => e.dealId === deal && istFest(e));
  const abwesenheiten: Abwesenheit[] = tage.length > 0 ? await ladeAbwesenheiten(ws, tage[0]!, tage[tage.length - 1]!) : [];
  const andere = einsaetze.filter((e) => e.dealId !== deal);
  const kapazitaet = kapazitaetAus({ tage, personen, abwesenheiten, einsaetze: andere });

  const teamIds = team.map((t) => t.employeeId);
  const sichtbar = personen.filter((p) => p.aktiv || teamIds.includes(p.id));
  const personenLage: EinsatzPersonLage[] = sichtbar.map((p) => {
    const belegtMit = new Map<string, string>();
    let abwesend: EinsatzPersonLage["abwesend"] = null;
    for (const k of kapazitaet) {
      for (const b of k.belegt) if (b.person.id === p.id) for (const d of b.deals) belegtMit.set(d.dealId, d.titel);
      const a = k.abwesend.find((x) => x.person.id === p.id);
      if (a && !abwesend) abwesend = a.art;
    }
    return {
      ...p,
      lage: lageAmEinsatz(kapazitaet, p.id),
      belegtMit: [...belegtMit].map(([dealId, titel]) => ({ dealId, titel })),
      abwesend,
      stempeltGerade: stempel.has(p.id),
    };
  });

  const rechner = rechnerDatenAus(anfrage, ergebnis);
  const groesse = rechner?.groesse ?? 0;
  const minuten = planMinutenJePerson({
    teamgroesse: Math.max(1, groesse),
    fahrtMin: rechner?.fahrtMin ?? null,
    personenH: rechner?.personenH ?? null,
    personalStunden: rechner?.personalStunden ?? null,
  });
  const brauchtFahrer = rechner?.empfehlung !== null && rechner?.empfehlung !== undefined && rechner.auftragsart !== "kuechenmontage";
  const vorschlag = teamVorschlag({
    dealId: deal,
    tage,
    groesse,
    brauchtFahrer,
    fahrtMinJePerson: minuten.fahrtMin,
    arbeitMinJePerson: minuten.arbeitMin,
    bisher: teamIds,
    personen,
    abwesenheiten,
    einsaetze,
  });

  const tag = tage[0] ?? datum;
  const fuerAnfahrt = personenLage.filter((p) => p.abwesend === null);
  const anfahrten = beladen
    ? await anfahrtenLaden(ws, { personen: fuerAnfahrt, beladen, entladen, tag }, { dealId: deal, frisch: o.frisch, jetzt })
    : [];

  // Kosten: heutiges Team mit seinen Minuten, sonst der Vorschlag.
  const basisTeam: TeamWunsch[] =
    team.length > 0
      ? team.map((t) => ({
          employeeId: t.employeeId,
          role: t.role === "lead" ? "lead" : "helper",
          plannedDriveMinutes: t.plannedDriveMinutes,
          plannedWorkMinutes: t.plannedWorkMinutes,
        }))
      : vorschlag.team;
  const n = Math.max(1, basisTeam.length);
  const fuerN = planMinutenJePerson({
    teamgroesse: n,
    fahrtMin: rechner?.fahrtMin ?? null,
    personenH: rechner?.personenH ?? null,
    personalStunden: rechner?.personalStunden ?? null,
  });
  const kostenTeam = basisTeam
    .map((w) => {
      const person = personen.find((p) => p.id === w.employeeId);
      if (!person) return null;
      return { person, fahrtMin: w.plannedDriveMinutes ?? fuerN.fahrtMin, arbeitMin: w.plannedWorkMinutes ?? fuerN.arbeitMin };
    })
    .filter((x): x is { person: EinsatzPerson; fahrtMin: number | null; arbeitMin: number | null } => x !== null);
  const kosten = einsatzKosten({ team: kostenTeam, fahrzeugEur: rechner?.fahrzeugEur ?? null, fahrzeugName: rechner?.fahrzeugName ?? null, anfahrten });
  const vergleich = lohnVergleich({
    kosten,
    posten: rechner?.posten,
    festpreisEur: rechner?.festpreisEur ?? null,
    selbstkostenEur: rechner?.selbstkostenEur ?? null,
  });
  const option = ergebnis?.empfehlungOptionId ? (ergebnis.fahrzeugoptionen ?? []).find((x) => x.id === ergebnis.empfehlungOptionId) : null;
  const auslastung = auslastungAus(option ?? null, rechner?.auftragsart ?? null);

  const wirksam = wirksameUebersteuerungen((Array.isArray(v?.overrides) ? v!.overrides : []) as Uebersteuerung[]);
  const eingabe = (key: string) => wirksam.find((u) => u.art === "eingabe" && u.key === key);
  const anfahrtU = eingabe("anfahrt_team");
  const textWert = (key: string) => {
    const w = eingabe(key)?.wert;
    return typeof w === "string" ? w : null;
  };

  // 12b: zugeordnete Buchung und Buchungen der Firma, die einen Tag des Umzugs decken.
  const { buchungImPreis, buchung, buchungenAmTag } = await buchungenFuerEinsatz(ws, deal, kopf.firmaId, tage);
  const hinweise: string[] = [];
  if (!v) hinweise.push("Noch keine Kalkulation: Minuten und Lohn fehlen.");
  if (!beladen) hinweise.push("Keine Beladeadresse: Anfahrt nicht berechnet.");

  return {
    dealId: deal,
    titel: kopf.name,
    firmaId: kopf.firmaId,
    tage,
    fest,
    version: v ? { nummer: v.version, status: v.status } : null,
    beladen,
    entladen,
    team,
    personen: personenLage,
    kapazitaet,
    teamVorschlag: vorschlag,
    rechner,
    anfahrten,
    einsatzKosten: kosten,
    lohnVergleich: vergleich,
    auslastung,
    anfahrtUebernommenEur: anfahrtU && typeof anfahrtU.wert === "number" ? anfahrtU.wert : null,
    buchung,
    buchungenAmTag,
    buchungImPreis,
    stationVorgabe: textWert("station"),
    klasseVorgabe: textWert("fahrzeugklasse"),
    hinweise,
  };
}

type BuchungAnsicht = NonNullable<EinsatzAnsicht["buchung"]>;

async function buchungenFuerEinsatz(
  ws: string,
  deal: string,
  firmaId: string | null,
  tage: readonly string[],
): Promise<{ buchungImPreis: boolean; buchung: BuchungAnsicht | null; buchungenAmTag: BuchungAnsicht[] }> {
  try {
    const [{ einsatzSchalter }, { dealBuchung, ladeBuchungen }, { buchungsLeisteText }] = await Promise.all([
      import("./plan5-schalter"),
      import("./einsatz-buchungen"),
      import("@/lib/einsatz"),
    ]);
    const [schalter, eigene] = await Promise.all([einsatzSchalter(ws, deal), dealBuchung(ws, deal)]);
    const amTag =
      firmaId && tage.length > 0 ? (await ladeBuchungen(ws, tage[0]!, tage[tage.length - 1]!, firmaId)).filter((b) => b.status !== "storniert") : [];
    let buchung: BuchungAnsicht | null = null;
    if (eigene) {
      const mit = amTag.find((b) => b.id === eigene.id) ?? (await ladeBuchungen(ws, eigene.von, eigene.bis, eigene.firmaId)).find((b) => b.id === eigene.id);
      const zuordnungen = mit?.zuordnungen ?? [];
      buchung = { ...eigene, zuordnungen, text: buchungsLeisteText(eigene, zuordnungen) };
    }
    return {
      buchungImPreis: schalter.buchungImPreis,
      buchung,
      buchungenAmTag: amTag.map((b) => ({ ...b, text: buchungsLeisteText(b, b.zuordnungen) })),
    };
  } catch (err) {
    console.error("[einsatz] Buchungen", err);
    return { buchungImPreis: false, buchung: null, buchungenAmTag: [] };
  }
}

// ─── Team bestätigen ─────────────────────────────────────────────────────────

export type BestaetigenErgebnis =
  | { ok: true; team: Zuteilung[] }
  | { ok: false; code: EinsatzFehlerCode; konflikte?: DoppelKonflikt[] };

function istUniqueFehler(e: unknown): boolean {
  for (let x: unknown = e, i = 0; x && i < 4; x = (x as { cause?: unknown }).cause, i++) {
    if ((x as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

class Abbruch extends Error {
  constructor(readonly ergebnis: Extract<BestaetigenErgebnis, { ok: false }>) {
    super(ergebnis.code);
  }
}

/**
 * „Team bestätigen“ (Entscheidung 5): einzige Stelle der neuen Oberfläche, die
 * `deal_employees` schreibt. Sperren je Deal, dann je Person (sortiert, kein
 * Deadlock); in der Transaktion neu gelesen, damit parallele Bestätigungen
 * einander sehen. Keine Nachricht, kein Neurechnen, keine neue Version.
 */
export async function einsatzBestaetigen(
  ws: string,
  deal: string,
  e: { team: TeamWunsch[]; bestaetigtAmTag?: string[] },
  autor: string,
  o: { jetzt?: Date } = {},
): Promise<BestaetigenErgebnis> {
  const jetzt = o.jetzt ?? new Date();
  const [personen, bisher] = await Promise.all([ladePersonen(ws), zuteilungenLesen(ws, deal)]);
  const fehler = pruefeTeam(e.team, personen, bisher.map((z) => z.employeeId));
  if (fehler) return { ok: false, code: fehler };

  // Tage und feste Einsätze vor der Transaktion (Plan-Daten, liest nur).
  const v = await massgeblicheVersion(ws, deal);
  const datum = text((v?.rechnerRequest as RechnerAnfrage | null)?.umzugsdatum);
  const heute = berlinDateString(jetzt);
  const von = datum ? tagPlus(datum, -7) : heute;
  const bis = datum ? tagPlus(datum, 21) : tagPlus(heute, 120);
  const { einsaetze, eintraege } = await festeEinsaetze(ws, von, bis);
  const tage = dealTage(eintraege, deal);
  const neuIds = e.team.map((t) => t.employeeId);

  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`einsatz:deal:${deal}`}, 0))`);
      for (const id of [...neuIds].sort()) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`einsatz:ma:${id}`}, 0))`);
      }
      const alt = await zuteilungenLesen(ws, deal, tx);
      // Wer schon wo eingeteilt ist, frisch gelesen (überschreibt die Plan-Daten für das Team).
      const frisch =
        neuIds.length === 0
          ? []
          : await tx
              .select({ dealId: dealEmployees.dealRecordId, employeeId: dealEmployees.employeeId })
              .from(dealEmployees)
              .where(inArray(dealEmployees.employeeId, neuIds));
      const aktuell = einsaetze.map((f) => ({
        ...f,
        employeeIds: [
          ...f.employeeIds.filter((id) => !neuIds.includes(id)),
          ...frisch.filter((z) => z.dealId === f.dealId).map((z) => z.employeeId),
        ],
      }));
      const neuHinzu = neuIds.filter((id) => !alt.some((z) => z.employeeId === id));
      const konflikte = doppelteAmTag({ dealId: deal, tage, employeeIds: neuHinzu, einsaetze: aktuell, bestaetigt: e.bestaetigtAmTag });
      if (konflikte.length > 0) throw new Abbruch({ ok: false, code: "DOPPELT_AM_TAG", konflikte });

      const diff = teamAenderung(alt, e.team);
      if (diff.entfernen.length > 0) {
        const stempel = await offeneStempel(ws, deal, tx);
        if (diff.entfernen.some((z) => stempel.has(z.employeeId))) throw new Abbruch({ ok: false, code: "STEMPELT_NOCH" });
        await tx.delete(dealEmployees).where(
          and(
            eq(dealEmployees.dealRecordId, deal),
            inArray(
              dealEmployees.id,
              diff.entfernen.map((z) => z.id),
            ),
          ),
        );
      }
      const am = jetzt;
      for (const w of diff.aendern) {
        await tx
          .update(dealEmployees)
          .set({
            role: w.wunsch.role,
            plannedDriveMinutes: w.wunsch.plannedDriveMinutes,
            plannedWorkMinutes: w.wunsch.plannedWorkMinutes,
            confirmedAt: am,
            confirmedBy: autor,
          })
          .where(and(eq(dealEmployees.id, w.id), eq(dealEmployees.dealRecordId, deal)));
      }
      if (diff.anlegen.length > 0) {
        await tx.insert(dealEmployees).values(
          diff.anlegen.map((w) => ({
            dealRecordId: deal,
            employeeId: w.employeeId,
            role: w.role,
            plannedDriveMinutes: w.plannedDriveMinutes,
            plannedWorkMinutes: w.plannedWorkMinutes,
            confirmedAt: am,
            confirmedBy: autor,
          })),
        );
      }
      // Unverändert übernommene Zeilen (etwa aus der alten Oberfläche) gelten jetzt als bestätigt.
      if (neuIds.length > 0) {
        await tx
          .update(dealEmployees)
          .set({ confirmedAt: am, confirmedBy: autor })
          .where(and(eq(dealEmployees.dealRecordId, deal), inArray(dealEmployees.employeeId, neuIds), isNull(dealEmployees.confirmedAt)));
      }
      const team = await zuteilungenLesen(ws, deal, tx);
      return { ok: true as const, team: team.map(({ confirmedAt: _c, ...z }) => z) };
    });
  } catch (err) {
    if (err instanceof Abbruch) return err.ergebnis;
    if (istUniqueFehler(err)) return { ok: false, code: "DOPPELTE_PERSON" };
    throw err;
  }
}
