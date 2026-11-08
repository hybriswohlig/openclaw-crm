/**
 * Plan 12 (Einsatz und Kapazität): Vertrag. Rein: keine Datenbank, kein Netz.
 * Ziel im Repo: `apps/web/src/lib/einsatz.ts`.
 *
 * Tage sind Berliner Kalendertage `YYYY-MM-DD` (wie `PlanEintrag.tag`).
 * Beträge in Cent, Sätze in Cent je Stunde, Kilometer ganzzahlig.
 */

// ─── Tage ────────────────────────────────────────────────────────────────────

const ISO_TAG = /^\d{4}-\d{2}-\d{2}$/;

export function istTag(wert: unknown): wert is string {
  if (typeof wert !== "string" || !ISO_TAG.test(wert)) return false;
  const [j, m, d] = wert.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(j, m - 1, d));
  return t.getUTCFullYear() === j && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function naechsterTag(tag: string): string {
  const [j, m, d] = tag.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(j, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Alle Tage von `von` bis `bis` (inklusiv); leer bei `bis < von`. Höchstens `max` Tage. */
export function tageZwischen(von: string, bis: string, max = 62): string[] {
  const aus: string[] = [];
  for (let t = von; t <= bis && aus.length < max; t = naechsterTag(t)) aus.push(t);
  return aus;
}

// ─── Mitarbeiter-Stammdaten ──────────────────────────────────────────────────

/** Vorgabesätze (E8) für neue Mitarbeiter. */
export const SATZ_FAHRT_CENT_VORGABE = 1500;
export const SATZ_ARBEIT_CENT_VORGABE = 2000;
/** Grenzen für Sätze je Stunde (1 € bis 200 €). */
export const SATZ_CENT_MIN = 100;
export const SATZ_CENT_MAX = 20000;

/** `employees.hourly_rate` (numeric(10,2), Text) ist die Ableitung aus `rate_work_cents` (E8). */
export function hourlyRateAusCent(cent: number): string {
  return (Math.round(cent) / 100).toFixed(2);
}

/** Alter Satz (Text „20.00“, „20,5“) in Cent; null bei ungültigem Wert. */
export function centAusHourlyRate(wert: string | number | null | undefined): number | null {
  if (wert === null || wert === undefined) return null;
  const n = typeof wert === "number" ? wert : Number(String(wert).trim().replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export interface EinsatzPerson {
  id: string;
  name: string;
  kuerzel: string;
  aktiv: boolean;
  /** PLZ und Ort, keine Straße (E4, Inhaber 07.11.). Nie an MCP, Portal oder Mitarbeiter-App. */
  plz: string | null;
  wohnort: string | null;
  kannSprinter: boolean;
  eigenerPkw: boolean;
  satzFahrtCent: number;
  satzArbeitCent: number;
}

/** Eingabe für Anlegen und Ändern (`PATCH`: alle Felder optional). */
export interface StammdatenEingabe {
  name?: string;
  plz?: string | null;
  wohnort?: string | null;
  kannSprinter?: boolean;
  eigenerPkw?: boolean;
  satzFahrtCent?: number;
  satzArbeitCent?: number;
  aktiv?: boolean;
}

export type StammdatenFehler = "NAME_LEER" | "NAME_LANG" | "WOHNORT_LANG" | "PLZ_UNGUELTIG" | "SATZ_UNGUELTIG";

/** Deutsche PLZ, fünf Ziffern (auch mit führender 0). */
export const PLZ_MUSTER = /^\d{5}$/;

export function pruefeStammdaten(e: StammdatenEingabe, neu: boolean): StammdatenFehler | null {
  if (neu || e.name !== undefined) {
    const name = (e.name ?? "").trim();
    if (name === "") return "NAME_LEER";
    if (name.length > 80) return "NAME_LANG";
  }
  if (e.wohnort !== undefined && e.wohnort !== null && e.wohnort.trim().length > 80) return "WOHNORT_LANG";
  if (e.plz !== undefined && e.plz !== null && !PLZ_MUSTER.test(e.plz.trim())) return "PLZ_UNGUELTIG";
  for (const s of [e.satzFahrtCent, e.satzArbeitCent]) {
    if (s === undefined) continue;
    if (!Number.isInteger(s) || s < SATZ_CENT_MIN || s > SATZ_CENT_MAX) return "SATZ_UNGUELTIG";
  }
  return null;
}

// ─── Verfügbarkeit als Ausnahme (E1) ─────────────────────────────────────────

export type AbwesenheitArt = "urlaub" | "krank" | "gesperrt";
export const ABWESENHEIT_ARTEN: readonly AbwesenheitArt[] = ["urlaub", "krank", "gesperrt"];
export const ABWESENHEIT_TEXT: Record<AbwesenheitArt, string> = { urlaub: "Urlaub", krank: "krank", gesperrt: "gesperrt" };
/** Längste Ausnahme in einem Eintrag. */
export const ABWESENHEIT_MAX_TAGE = 92;

export interface Abwesenheit {
  id: string;
  employeeId: string;
  von: string;
  bis: string;
  art: AbwesenheitArt;
  notiz: string | null;
}

export function pruefeAbwesenheit(e: { von: unknown; bis: unknown; art: unknown }): "ZEITRAUM_UNGUELTIG" | "ART_UNGUELTIG" | null {
  if (!istTag(e.von) || !istTag(e.bis) || e.bis < e.von) return "ZEITRAUM_UNGUELTIG";
  if (tageZwischen(e.von, e.bis, ABWESENHEIT_MAX_TAGE + 1).length > ABWESENHEIT_MAX_TAGE) return "ZEITRAUM_UNGUELTIG";
  if (!ABWESENHEIT_ARTEN.includes(e.art as AbwesenheitArt)) return "ART_UNGUELTIG";
  return null;
}

/** Erste Ausnahme, die `tag` für die Person deckt (Reihenfolge der Liste), sonst null. Ohne Eintrag: frei. */
export function abwesendAm(liste: readonly Abwesenheit[], employeeId: string, tag: string): Abwesenheit | null {
  return liste.find((a) => a.employeeId === employeeId && a.von <= tag && a.bis >= tag) ?? null;
}

// ─── Feste Einsätze und Kapazität (E2) ───────────────────────────────────────

/** Fest = Umzug-Eintrag im Ton jade oder gold. Gestrichelt (Wunsch, Angebot), violett, grau zählen nicht. */
export function istFest(e: { art: string; ton: string }): boolean {
  return e.art === "umzug" && (e.ton === "jade" || e.ton === "gold");
}

/** Ein fester Umzug mit den zugeteilten Personen (`deal_employees`), Tage inklusiv. */
export interface FesterEinsatz {
  dealId: string;
  titel: string;
  tag: string;
  bisTag: string;
  employeeIds: string[];
}

/**
 * Feste Einsätze aus geladenen Plan-Einträgen (ungefiltert, alle Firmen) und
 * den Team-IDs je Deal (`teamIdsLesen`). Ein Eintrag je Deal und Zeitraum;
 * Plan und Einsatz-Dialog nutzen dieselbe Regel (Koordinator, 12a-9).
 */
export function festeEinsaetzeAus(
  eintraege: ReadonlyArray<{ dealId: string; art: string; ton: string; tag: string; bisTag: string; titel: string }>,
  teamIds: ReadonlyMap<string, readonly string[]>,
): FesterEinsatz[] {
  const aus: FesterEinsatz[] = [];
  const gesehen = new Set<string>();
  for (const e of eintraege) {
    if (!istFest(e)) continue;
    const schluessel = `${e.dealId}|${e.tag}|${e.bisTag}`;
    if (gesehen.has(schluessel)) continue;
    gesehen.add(schluessel);
    aus.push({ dealId: e.dealId, titel: e.titel, tag: e.tag, bisTag: e.bisTag, employeeIds: [...(teamIds.get(e.dealId) ?? [])] });
  }
  return aus;
}

export type KapazitaetTon = "gruen" | "gold" | "rot";
/** Ab so vielen freien Personen grün; 1 gold, 0 rot (Spec 3.5: „4 frei“ grün, „1 frei“ gold, „0 frei“ rot). */
export const KAPAZITAET_GRUEN_AB = 2;

export function kapazitaetTon(frei: number): KapazitaetTon {
  if (frei <= 0) return "rot";
  return frei >= KAPAZITAET_GRUEN_AB ? "gruen" : "gold";
}

export interface PersonKurz {
  id: string;
  name: string;
  kuerzel: string;
}

export interface KapazitaetTag {
  tag: string;
  frei: PersonKurz[];
  belegt: Array<{ person: PersonKurz; deals: Array<{ dealId: string; titel: string }> }>;
  abwesend: Array<{ person: PersonKurz; art: AbwesenheitArt }>;
  freiZahl: number;
  ton: KapazitaetTon;
  /** „3 frei“; Chip-Text. */
  text: string;
}

function kurz(p: EinsatzPerson | PersonKurz): PersonKurz {
  return { id: p.id, name: p.name, kuerzel: p.kuerzel };
}

function nachName<T extends { name: string; id: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name, "de") || a.id.localeCompare(b.id);
}

/**
 * Kapazität je Tag: aktive Personen ohne Ausnahme minus Personen auf festen
 * Umzügen. Abwesend geht vor belegt (eine abwesende Person auf einem festen
 * Umzug steht unter `abwesend` und zusätzlich unter `belegt`, damit der
 * Widerspruch sichtbar ist). Inaktive Personen zählen nie. Namen sortiert.
 */
export function kapazitaetAus(input: {
  tage: readonly string[];
  personen: readonly EinsatzPerson[];
  abwesenheiten: readonly Abwesenheit[];
  einsaetze: readonly FesterEinsatz[];
}): KapazitaetTag[] {
  const aktiv = input.personen.filter((p) => p.aktiv).sort(nachName);
  return input.tage.map((tag) => {
    const amTag = input.einsaetze.filter((e) => e.tag <= tag && e.bisTag >= tag);
    const frei: PersonKurz[] = [];
    const belegt: KapazitaetTag["belegt"] = [];
    const abwesend: KapazitaetTag["abwesend"] = [];
    for (const p of aktiv) {
      const deals = amTag
        .filter((e) => e.employeeIds.includes(p.id))
        .map((e) => ({ dealId: e.dealId, titel: e.titel }))
        .sort((a, b) => a.titel.localeCompare(b.titel, "de") || a.dealId.localeCompare(b.dealId));
      const ab = abwesendAm(input.abwesenheiten, p.id, tag);
      if (ab) abwesend.push({ person: kurz(p), art: ab.art });
      if (deals.length > 0) belegt.push({ person: kurz(p), deals });
      if (!ab && deals.length === 0) frei.push(kurz(p));
    }
    return { tag, frei, belegt, abwesend, freiZahl: frei.length, ton: kapazitaetTon(frei.length), text: `${frei.length} frei` };
  });
}

export type PersonLage = "frei" | "belegt" | "abwesend";

/**
 * Lage einer Person über alle Tage eines Umzugs (Liste und Karte, 12a und 12c).
 * `kap` ist ohne den eigenen Deal gerechnet. Abwesend an irgendeinem Tag geht
 * vor belegt an irgendeinem Tag; ohne Tage oder ohne Eintrag: frei.
 */
export function lageAmEinsatz(kap: readonly KapazitaetTag[], employeeId: string): PersonLage {
  if (kap.some((k) => k.abwesend.some((a) => a.person.id === employeeId))) return "abwesend";
  if (kap.some((k) => k.belegt.some((b) => b.person.id === employeeId))) return "belegt";
  return "frei";
}

// ─── Team-Vorschlag und „Team bestätigen“ (E3) ───────────────────────────────

export type TeamRolle = "lead" | "helper";

export interface TeamWunsch {
  employeeId: string;
  role: TeamRolle;
  plannedDriveMinutes: number | null;
  plannedWorkMinutes: number | null;
}

export interface TeamVorschlag {
  team: TeamWunsch[];
  /** Fehlende Personen bis zur Teamgröße. */
  fehlen: number;
  hinweise: string[];
}

/** Größtes Team, das der Vorschlag bildet. */
export const TEAM_MAX = 12;

/**
 * Vorschlag aus den Freien an allen Tagen des Umzugs (nie gespeichert, nie in
 * `deal_employees`). Reihenfolge: braucht der Umzug einen Transporter, zuerst
 * eine freie Person mit `kannSprinter` als Lead; dann die mit den wenigsten
 * festen Einsätzen in `einsaetze` (Fairness im geladenen Fenster), dann Name.
 * Bereits zugeteilte, freie Personen bleiben vorne. Minuten aus dem Rechner
 * (Fahrt und Arbeit je Person) für jede Person gleich.
 */
export function teamVorschlag(input: {
  dealId: string;
  tage: readonly string[];
  groesse: number;
  brauchtFahrer: boolean;
  fahrtMinJePerson: number | null;
  arbeitMinJePerson: number | null;
  bisher: readonly string[];
  personen: readonly EinsatzPerson[];
  abwesenheiten: readonly Abwesenheit[];
  einsaetze: readonly FesterEinsatz[];
}): TeamVorschlag {
  const groesse = Math.max(0, Math.min(TEAM_MAX, Math.round(input.groesse)));
  const andere = input.einsaetze.filter((e) => e.dealId !== input.dealId);
  const kap = kapazitaetAus({ tage: input.tage, personen: input.personen, abwesenheiten: input.abwesenheiten, einsaetze: andere });
  const freiUeberall = input.personen.filter((p) => p.aktiv && kap.every((k) => k.frei.some((f) => f.id === p.id)));
  const last = (id: string) => andere.filter((e) => e.employeeIds.includes(id)).length;
  const sortiert = [...freiUeberall].sort((a, b) => {
    const ab = Number(input.bisher.includes(b.id)) - Number(input.bisher.includes(a.id));
    return ab || last(a.id) - last(b.id) || nachName(a, b);
  });
  const hinweise: string[] = [];
  const gewaehlt: EinsatzPerson[] = [];
  if (input.brauchtFahrer && groesse > 0) {
    const fahrer = sortiert.find((p) => p.kannSprinter);
    if (fahrer) gewaehlt.push(fahrer);
    else hinweise.push("Niemand Freies darf Sprinter fahren.");
  }
  for (const p of sortiert) {
    if (gewaehlt.length >= groesse) break;
    if (!gewaehlt.includes(p)) gewaehlt.push(p);
  }
  if (input.tage.length === 0) hinweise.push("Kein Termin: Verfügbarkeit nicht geprüft.");
  const minuten = (m: number | null) => (m === null || !Number.isFinite(m) ? null : Math.max(0, Math.round(m)));
  const team = gewaehlt.map((p, i) => ({
    employeeId: p.id,
    role: (i === 0 ? "lead" : "helper") as TeamRolle,
    plannedDriveMinutes: minuten(input.fahrtMinJePerson),
    plannedWorkMinutes: minuten(input.arbeitMinJePerson),
  }));
  const fehlen = Math.max(0, groesse - team.length);
  if (fehlen > 0) hinweise.push(fehlen === 1 ? "1 Person fehlt." : `${fehlen} Personen fehlen.`);
  return { team, fehlen, hinweise };
}

export type EinsatzFehlerCode =
  | "DOPPELTE_PERSON"
  | "UNBEKANNT"
  | "INAKTIV"
  | "MEHR_ALS_EIN_LEAD"
  | "MINUTEN_UNGUELTIG"
  | "DOPPELT_AM_TAG"
  | "STEMPELT_NOCH"
  | "NUR_MENSCH"
  | "FALSCHE_FIRMA"
  | "BUCHUNG_STORNIERT"
  | "ZEITRAUM_UNGUELTIG"
  | "ART_UNGUELTIG"
  | "BUCHUNG_UNGUELTIG"
  | "STAMMDATEN_UNGUELTIG";

export const EINSATZ_FEHLER_TEXT: Record<EinsatzFehlerCode, string> = {
  DOPPELTE_PERSON: "Eine Person steht zweimal im Team.",
  UNBEKANNT: "Diese Person gibt es nicht (mehr).",
  INAKTIV: "Deaktivierte Personen lassen sich nicht neu einteilen.",
  MEHR_ALS_EIN_LEAD: "Nur eine Person kann das Team leiten.",
  MINUTEN_UNGUELTIG: "Geplante Minuten müssen zwischen 0 und 1440 liegen.",
  DOPPELT_AM_TAG: "Mindestens eine Person ist an diesem Tag schon fest eingeteilt.",
  STEMPELT_NOCH: "Diese Person ist gerade für den Auftrag eingestempelt und kann nicht entfernt werden.",
  NUR_MENSCH: "Das geht nur in der Oberfläche, nicht per API-Schlüssel.",
  FALSCHE_FIRMA: "Die Buchung gehört zu einer anderen Firma als der Auftrag.",
  BUCHUNG_STORNIERT: "Die Buchung ist storniert.",
  ZEITRAUM_UNGUELTIG: "Der Zeitraum ist ungültig.",
  ART_UNGUELTIG: "Unbekannte Art der Abwesenheit.",
  BUCHUNG_UNGUELTIG: "Die Angaben zur Buchung sind unvollständig oder ungültig.",
  STAMMDATEN_UNGUELTIG: "Die Angaben zur Person sind ungültig.",
};

/** Formale Prüfung vor jeder Datenbank-Arbeit. `personen` = alle des Workspace (auch inaktive). `bisher` = schon zugeteilte IDs. */
export function pruefeTeam(
  neu: readonly TeamWunsch[],
  personen: readonly EinsatzPerson[],
  bisher: readonly string[],
): EinsatzFehlerCode | null {
  const ids = neu.map((t) => t.employeeId);
  if (new Set(ids).size !== ids.length) return "DOPPELTE_PERSON";
  if (neu.filter((t) => t.role === "lead").length > 1) return "MEHR_ALS_EIN_LEAD";
  for (const t of neu) {
    const p = personen.find((x) => x.id === t.employeeId);
    if (!p) return "UNBEKANNT";
    if (!p.aktiv && !bisher.includes(p.id)) return "INAKTIV";
    for (const m of [t.plannedDriveMinutes, t.plannedWorkMinutes]) {
      if (m !== null && (!Number.isInteger(m) || m < 0 || m > 1440)) return "MINUTEN_UNGUELTIG";
    }
  }
  return null;
}

export interface DoppelKonflikt {
  employeeId: string;
  tag: string;
  andere: Array<{ dealId: string; titel: string }>;
}

/**
 * Wer an einem Tag dieses Umzugs schon auf einem anderen festen Umzug steht.
 * Läuft im Dienst unter der Sperre je Person (Entscheidung 12a-5); bewusst
 * erlaubte Personen (`bestaetigt`) sind ausgenommen.
 */
export function doppelteAmTag(input: {
  dealId: string;
  tage: readonly string[];
  employeeIds: readonly string[];
  einsaetze: readonly FesterEinsatz[];
  bestaetigt?: readonly string[];
}): DoppelKonflikt[] {
  const aus: DoppelKonflikt[] = [];
  for (const id of input.employeeIds) {
    if (input.bestaetigt?.includes(id)) continue;
    for (const tag of input.tage) {
      const andere = input.einsaetze
        .filter((e) => e.dealId !== input.dealId && e.tag <= tag && e.bisTag >= tag && e.employeeIds.includes(id))
        .map((e) => ({ dealId: e.dealId, titel: e.titel }));
      if (andere.length > 0) aus.push({ employeeId: id, tag, andere });
    }
  }
  return aus;
}

export interface Zuteilung {
  id: string;
  employeeId: string;
  role: string;
  plannedDriveMinutes: number | null;
  plannedWorkMinutes: number | null;
}

/** Unterschied zwischen heutiger Zuteilung und bestätigtem Team. */
export function teamAenderung(
  alt: readonly Zuteilung[],
  neu: readonly TeamWunsch[],
): { anlegen: TeamWunsch[]; aendern: Array<{ id: string; wunsch: TeamWunsch }>; entfernen: Zuteilung[] } {
  const anlegen: TeamWunsch[] = [];
  const aendern: Array<{ id: string; wunsch: TeamWunsch }> = [];
  for (const w of neu) {
    const a = alt.find((z) => z.employeeId === w.employeeId);
    if (!a) anlegen.push(w);
    else if (a.role !== w.role || a.plannedDriveMinutes !== w.plannedDriveMinutes || a.plannedWorkMinutes !== w.plannedWorkMinutes) {
      aendern.push({ id: a.id, wunsch: w });
    }
  }
  const entfernen = alt.filter((z) => !neu.some((w) => w.employeeId === z.employeeId));
  return { anlegen, aendern, entfernen };
}

// ─── Anfahrt und Abfahrt je Person (12a, Inhaber 07.11.) ─────────────────────

/**
 * Gespeichert werden nur Kilometer je Ort und Adresse (`einsatz_wege`), nie die
 * Verkehrsminute. Minuten kommen je Planung frisch aus Google oder werden aus
 * den Kilometern geschätzt. Cache und Kartenpunkte gelten 30 Tage (wie
 * `ROUTE_GUELTIG_MS` der Kalkulationsroute), danach neu holen.
 */
export const WEG_GUELTIG_TAGE = 30;
/** Durchschnitt für geschätzte Minuten (Raum Stuttgart, Landstraße und Stadt gemischt). */
export const ANFAHRT_KMH_SCHAETZUNG = 50;

/** Schlüssel für Cache und Bündelung: „70176 stuttgart“. Ohne PLZ oder Ort null. */
export function ortSchluessel(plz: string | null | undefined, ort: string | null | undefined): string | null {
  const p = (plz ?? "").trim();
  const o = (ort ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("de");
  if (!PLZ_MUSTER.test(p) || o === "") return null;
  return `${p} ${o}`;
}

/** Anzeige „70176 Stuttgart“; nur Ort, wenn die PLZ fehlt; sonst null. */
export function ortText(p: Pick<EinsatzPerson, "plz" | "wohnort">): string | null {
  const o = (p.wohnort ?? "").trim();
  if (o === "") return null;
  const plz = (p.plz ?? "").trim();
  return PLZ_MUSTER.test(plz) ? `${plz} ${o}` : o;
}

/** Schlüssel einer Kundenadresse im Cache: klein, Leerraum gefaltet, ohne „, Deutschland“. */
export function adresseSchluessel(adresse: string): string {
  return adresse
    .trim()
    .replace(/\s+/g, " ")
    .replace(/,\s*(deutschland|germany)$/i, "")
    .toLocaleLowerCase("de");
}

export function cacheGueltig(berechnetAm: Date, jetzt: Date): boolean {
  return jetzt.getTime() - berechnetAm.getTime() < WEG_GUELTIG_TAGE * 24 * 60 * 60 * 1000;
}

export function minutenAusKm(km: number): number {
  return Math.max(1, Math.round((km / ANFAHRT_KMH_SCHAETZUNG) * 60));
}

/**
 * Anfahrt = Wohnort → Beladeadresse, Abfahrt = Entladeadresse → Wohnort (ohne
 * Entladeadresse zurück zur Beladeadresse). Kilometer einfache Strecke.
 * `anMinQuelle` "verkehr": Google mit Abfahrt am Umzugstag 07:00 (Berlin);
 * "geschaetzt": aus den Kilometern. Abfahrt-Minuten sind immer geschätzt.
 */
export interface Anfahrt {
  employeeId: string;
  anKm: number | null;
  abKm: number | null;
  anMin: number | null;
  abMin: number | null;
  anMinQuelle: "verkehr" | "geschaetzt" | null;
}

/** „14 km · 22 min“, geschätzt „14 km · ca. 17 min“, ohne Wert „unbekannt“. */
export function anfahrtText(km: number | null, min: number | null, quelle: Anfahrt["anMinQuelle"]): string {
  if (km === null) return "unbekannt";
  const k = `${Math.round(km)} km`;
  if (min === null) return k;
  return quelle === "verkehr" ? `${k} · ${min} min` : `${k} · ca. ${min} min`;
}

/**
 * Geplante Minuten je Person aus dem Rechner-Ergebnis, so verteilt wie die
 * Kalkulation rechnet (`personal.arbeit` und `personal.fahrt` mit Puffer):
 * Arbeit = (Arbeit + Fahrzeugübergabe) × Puffer ÷ Teamgröße, Fahrt = Fahrzeit
 * je Person × Puffer. Bei gleichen Sätzen ergibt die Lohnsumme damit genau die
 * Annahme der Kalkulation. `teamgroesse` = tatsächliche Auswahl (mehr Leute:
 * weniger Arbeit je Person, Fahrt bleibt). Ohne `personalStunden` (alter
 * Rechner): Fahrt = `fahrtMin`, Arbeit = `personenH` × 60 ÷ Größe minus Fahrt.
 */
export function planMinutenJePerson(input: {
  teamgroesse: number;
  fahrtMin: number | null;
  personenH: number | null;
  personalStunden: { arbeitPm: number; fahrerPm: number; fahrzeitPm: number; pufferProzent: number } | null | undefined;
}): { fahrtMin: number | null; arbeitMin: number | null } {
  const n = Math.max(1, Math.round(input.teamgroesse));
  const ps = input.personalStunden;
  if (ps) {
    const puffer = 1 + ps.pufferProzent / 100;
    return {
      fahrtMin: input.fahrtMin === null ? null : Math.round(input.fahrtMin * puffer),
      arbeitMin: Math.round(((ps.arbeitPm + ps.fahrerPm) * puffer) / n),
    };
  }
  if (input.personenH === null) return { fahrtMin: input.fahrtMin, arbeitMin: null };
  const fahrt = input.fahrtMin ?? 0;
  return { fahrtMin: input.fahrtMin, arbeitMin: Math.max(0, Math.round((input.personenH * 60) / n - fahrt)) };
}

// ─── Kostenzeilen im Einsatz (E7) ────────────────────────────────────────────

/** Kilometersatz für „Anfahrt Team“ mit eigenem PKW (Anfahrt plus Abfahrt), nur Anzeige und Übersteuerung. */
export const ANFAHRT_KM_SATZ_CENT = 30;

/**
 * Fahrzeugkosten aus den Rechner-Kostenzeilen: Summe aller Zeilen mit Schlüssel
 * `fahrzeug.<id>.<teil>` (Miete, Mehr-km, Kraftstoff, Tagespauschale,
 * Verschleiß). Behebt `einsatzAus`, das nach dem Schlüssel `fahrzeug` suchte.
 * Euro, auf Cent gerundet; null ohne solche Zeile.
 */
export function fahrzeugEurAus(posten: ReadonlyArray<{ key?: string; betrag: number }> | undefined): number | null {
  const treffer = (posten ?? []).filter((p) => typeof p.key === "string" && p.key.startsWith("fahrzeug.") && Number.isFinite(p.betrag));
  if (treffer.length === 0) return null;
  return Math.round(treffer.reduce((s, p) => s + p.betrag, 0) * 100) / 100;
}

export type EinsatzKostenKey = "fahrt" | "arbeit" | "fahrzeug" | "anfahrt_team";

export interface EinsatzKostenZeile {
  key: EinsatzKostenKey;
  text: string;
  formel: string;
  betragCent: number;
  /** Nur „Anfahrt Team“: nie automatisch im Preis, nur per Übersteuerung (E7). */
  nurAnzeige: boolean;
}

function euro(cent: number): string {
  return `${(cent / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function stunden(min: number): string {
  return `${(min / 60).toLocaleString("de-DE", { maximumFractionDigits: 2 })} h`;
}

/**
 * Interne Kostenzeilen des Einsatzes mit den Sätzen je Person. „Anfahrt Team“
 * nur für Personen mit eigenem PKW: Anfahrt plus Abfahrt in km (fehlt die
 * Abfahrt, zählt die Anfahrt doppelt; ohne Anfahrt fehlt die Person in der
 * Zeile). Zeilen ohne Betrag entfallen.
 */
export function einsatzKosten(input: {
  team: ReadonlyArray<{ person: EinsatzPerson; fahrtMin: number | null; arbeitMin: number | null }>;
  fahrzeugEur: number | null;
  fahrzeugName: string | null;
  anfahrten: ReadonlyArray<Pick<Anfahrt, "employeeId" | "anKm" | "abKm">>;
}): EinsatzKostenZeile[] {
  const aus: EinsatzKostenZeile[] = [];
  const summe = (teil: "fahrt" | "arbeit") => {
    let cent = 0;
    const formeln: string[] = [];
    for (const t of input.team) {
      const min = teil === "fahrt" ? t.fahrtMin : t.arbeitMin;
      const satz = teil === "fahrt" ? t.person.satzFahrtCent : t.person.satzArbeitCent;
      if (min === null || min <= 0) continue;
      cent += Math.round((min / 60) * satz);
      formeln.push(`${t.person.kuerzel} ${stunden(min)} × ${euro(satz)}`);
    }
    return { cent, formel: formeln.join(" + ") };
  };
  const fahrt = summe("fahrt");
  if (fahrt.cent > 0) aus.push({ key: "fahrt", text: "Fahrt", formel: fahrt.formel, betragCent: fahrt.cent, nurAnzeige: false });
  const arbeit = summe("arbeit");
  if (arbeit.cent > 0) aus.push({ key: "arbeit", text: "Arbeit", formel: arbeit.formel, betragCent: arbeit.cent, nurAnzeige: false });
  if (input.fahrzeugEur !== null && input.fahrzeugEur > 0) {
    const cent = Math.round(input.fahrzeugEur * 100);
    aus.push({ key: "fahrzeug", text: input.fahrzeugName ?? "Fahrzeug", formel: "aus der Kalkulation", betragCent: cent, nurAnzeige: false });
  }
  let anfahrt = 0;
  const teile: string[] = [];
  for (const t of input.team) {
    if (!t.person.eigenerPkw) continue;
    const a = input.anfahrten.find((x) => x.employeeId === t.person.id);
    if (!a || a.anKm === null || a.anKm <= 0) continue;
    const hinZurueck = Math.round(a.anKm) + Math.round(a.abKm ?? a.anKm);
    anfahrt += hinZurueck * ANFAHRT_KM_SATZ_CENT;
    teile.push(`${t.person.kuerzel} ${hinZurueck} km`);
  }
  if (anfahrt > 0) {
    aus.push({
      key: "anfahrt_team",
      text: "Anfahrt Team",
      formel: `${teile.join(" + ")} × ${euro(ANFAHRT_KM_SATZ_CENT)}`,
      betragCent: anfahrt,
      nurAnzeige: true,
    });
  }
  return aus;
}

// ─── Lohnsumme gegen Kalkulation (12a) ───────────────────────────────────────

/** Kostenzeilen der Kalkulation, die das Team betreffen (Rechner `src/engine/kosten.ts`). */
export const KALK_TEAM_KEYS: readonly string[] = ["personal.arbeit", "personal.fahrt", "anfahrtsgeld"];

export interface LohnVergleich {
  /** Fahrt plus Arbeit nach Sätzen je Person. */
  lohnCent: number;
  /** „Anfahrt Team“ (eigener PKW), nur Anzeige. */
  anfahrtCent: number;
  summeCent: number;
  /** Summe der Zeilen `KALK_TEAM_KEYS` der maßgeblichen Version; null ohne solche Zeile. */
  kalkulationCent: number | null;
  differenzCent: number | null;
  margeKalkulationProzent: number | null;
  /** Marge, wenn die Differenz die Selbstkosten verschiebt; Preis und Gemeinkosten bleiben. */
  margeNeuProzent: number | null;
  /** „+38 € gegenüber Kalkulation, Marge 34 % statt 37 %“; null ohne Kalkulation. */
  text: string | null;
  ton: "normal" | "gold";
}

function euroGanz(cent: number): string {
  return `${Math.round(Math.abs(cent) / 100).toLocaleString("de-DE")} €`;
}

export function lohnVergleich(input: {
  kosten: readonly EinsatzKostenZeile[];
  posten: ReadonlyArray<{ key?: string; betrag: number }> | undefined;
  festpreisEur: number | null;
  selbstkostenEur: number | null;
}): LohnVergleich {
  const zeile = (k: EinsatzKostenKey) => input.kosten.find((z) => z.key === k)?.betragCent ?? 0;
  const lohnCent = zeile("fahrt") + zeile("arbeit");
  const anfahrtCent = zeile("anfahrt_team");
  const summeCent = lohnCent + anfahrtCent;
  const treffer = (input.posten ?? []).filter((p) => typeof p.key === "string" && KALK_TEAM_KEYS.includes(p.key) && Number.isFinite(p.betrag));
  const kalkulationCent = treffer.length === 0 ? null : Math.round(treffer.reduce((s, p) => s + p.betrag, 0) * 100);
  const differenzCent = kalkulationCent === null ? null : summeCent - kalkulationCent;
  const preis = input.festpreisEur;
  const sk = input.selbstkostenEur;
  const margeMoeglich = preis !== null && preis > 0 && sk !== null && Number.isFinite(sk);
  const margeKalkulationProzent = margeMoeglich ? Math.round(((preis - sk) / preis) * 100) : null;
  const margeNeuProzent =
    margeMoeglich && differenzCent !== null ? Math.round(((preis - sk - differenzCent / 100) / preis) * 100) : null;
  let text: string | null = null;
  if (differenzCent !== null) {
    const euroDiff = Math.round(differenzCent / 100);
    const teil = euroDiff === 0 ? "wie Kalkulation" : euroDiff > 0 ? `+${euroGanz(differenzCent)} gegenüber Kalkulation` : `${euroGanz(differenzCent)} unter Kalkulation`;
    const marge =
      margeNeuProzent === null || margeKalkulationProzent === null
        ? ""
        : margeNeuProzent === margeKalkulationProzent
          ? `, Marge ${margeNeuProzent} %`
          : `, Marge ${margeNeuProzent} % statt ${margeKalkulationProzent} %`;
    text = teil + marge;
  }
  const ton = differenzCent !== null && differenzCent >= 100 ? "gold" : "normal";
  return { lohnCent, anfahrtCent, summeCent, kalkulationCent, differenzCent, margeKalkulationProzent, margeNeuProzent, text, ton };
}

// ─── Auslastung des Fahrzeugs (12a, 12b) ─────────────────────────────────────

/**
 * `fahrzeugoptionen[].auslastung` des Rechners ist kein Füllstand eines
 * gemieteten Wagens, sondern Ladevolumen (Inventar ÷ Packfaktor) geteilt durch
 * Laderaum mal Fahrten (Rechner `src/engine/fahrzeuge.ts`). So steht es auch
 * an der Anzeige.
 */
export const AUSLASTUNG_FORMEL = "Ladevolumen ÷ (Laderaum × Fahrten)";
export const AUSLASTUNG_GOLD_AB = 0.9;

export interface AuslastungAnzeige {
  /** 0 bis 1 für den Balken; null = kein Balken. */
  anteil: number | null;
  /** „82 %“, „64 % bei 2 Fahrten“, „kein Volumen“, „keine Schätzung“. */
  text: string;
  formel: string;
  ton: "normal" | "gold" | "leer";
}

export function auslastungAus(
  option: { fahrten: number; auslastung?: number } | null | undefined,
  auftragsart: string | null | undefined,
): AuslastungAnzeige {
  if (auftragsart === "kuechenmontage") return { anteil: null, text: "kein Volumen", formel: AUSLASTUNG_FORMEL, ton: "leer" };
  const a = option?.auslastung;
  if (!option || typeof a !== "number" || !Number.isFinite(a)) {
    return { anteil: null, text: "keine Schätzung", formel: AUSLASTUNG_FORMEL, ton: "leer" };
  }
  const anteil = Math.min(1, Math.max(0, a));
  const fahrten = option.fahrten > 1 ? ` bei ${option.fahrten} Fahrten` : "";
  return { anteil, text: `${Math.round(anteil * 100)} %${fahrten}`, formel: AUSLASTUNG_FORMEL, ton: anteil >= AUSLASTUNG_GOLD_AB ? "gold" : "normal" };
}

// ─── Transporter-Buchung (E5, E6) ────────────────────────────────────────────

export type BuchungStatus = "geplant" | "bestaetigt" | "storniert";
export const BUCHUNG_MAX_TAGE = 31;
export const BUCHUNG_MAX_AUFTRAEGE = 20;

export interface TransporterBuchung {
  id: string;
  /** `operating_company_record_id`; eine Buchung trägt nur Aufträge derselben Firma (E5). */
  firmaId: string;
  von: string;
  bis: string;
  /** Kopie aus dem Rechner (ID, Name, Anbieter), damit ein Rechner-Reset nichts verliert. */
  stationId: string;
  stationName: string;
  stationAnbieter: string | null;
  klasseId: string;
  klasseName: string;
  mieteCent: number;
  inklusivKm: number | null;
  mehrkmSatzCent: number | null;
  geplanteAuftraege: number;
  status: BuchungStatus;
  notiz: string | null;
}

export type BuchungEingabe = Omit<TransporterBuchung, "id" | "status"> & { status?: BuchungStatus };

export function pruefeBuchung(e: BuchungEingabe): "ZEITRAUM_UNGUELTIG" | "BUCHUNG_UNGUELTIG" | null {
  if (!istTag(e.von) || !istTag(e.bis) || e.bis < e.von) return "ZEITRAUM_UNGUELTIG";
  if (tageZwischen(e.von, e.bis, BUCHUNG_MAX_TAGE + 1).length > BUCHUNG_MAX_TAGE) return "ZEITRAUM_UNGUELTIG";
  const ganz = (n: number | null, max: number) => n === null || (Number.isInteger(n) && n >= 0 && n <= max);
  if (!e.firmaId || !e.stationId || !e.klasseId || !e.stationName.trim() || !e.klasseName.trim()) return "BUCHUNG_UNGUELTIG";
  if (!ganz(e.mieteCent, 10_000_00) || !ganz(e.inklusivKm, 100_000) || !ganz(e.mehrkmSatzCent, 1_000)) return "BUCHUNG_UNGUELTIG";
  if (!Number.isInteger(e.geplanteAuftraege) || e.geplanteAuftraege < 1 || e.geplanteAuftraege > BUCHUNG_MAX_AUFTRAEGE) {
    return "BUCHUNG_UNGUELTIG";
  }
  return null;
}

export function buchungDeckt(b: Pick<TransporterBuchung, "von" | "bis" | "status">, tag: string): boolean {
  return b.status !== "storniert" && b.von <= tag && b.bis >= tag;
}

/** Was beim Sperren je Tag eingefroren wird (`Tagespreis.buchungsanteil`, E6). */
export interface BuchungsAnteil {
  buchungId: string;
  mieteCent: number;
  geplanteAuftraege: number;
  /** Miete ÷ geplante Aufträge (mindestens 1), auf den Cent aufgerundet. */
  anteilCent: number;
  /** Inklusive Kilometer ÷ geplante Aufträge, abgerundet; null = unbegrenzt bzw. Klassenwert. */
  inklusivKmAnteil: number | null;
  mehrkmSatzCent: number | null;
}

export function buchungsAnteil(
  b: Pick<TransporterBuchung, "id" | "mieteCent" | "geplanteAuftraege" | "inklusivKm" | "mehrkmSatzCent">,
): BuchungsAnteil {
  const n = Math.max(1, Math.floor(b.geplanteAuftraege));
  return {
    buchungId: b.id,
    mieteCent: b.mieteCent,
    geplanteAuftraege: n,
    anteilCent: Math.ceil(b.mieteCent / n),
    inklusivKmAnteil: b.inklusivKm === null ? null : Math.floor(b.inklusivKm / n),
    mehrkmSatzCent: b.mehrkmSatzCent,
  };
}

export function gleicherAnteil(a: BuchungsAnteil | null | undefined, b: BuchungsAnteil | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return (
    a.buchungId === b.buchungId &&
    a.anteilCent === b.anteilCent &&
    a.inklusivKmAnteil === b.inklusivKmAnteil &&
    a.mehrkmSatzCent === b.mehrkmSatzCent
  );
}

/**
 * Rechner-Feld `buchung` (Entscheidung 12b-6): JSON mit fester Feldfolge,
 * damit `eingabeHash` stabil bleibt. Euro mit zwei Nachkommastellen.
 */
export function rechnerBuchungFeld(b: Pick<TransporterBuchung, "von" | "bis" | "stationId" | "klasseId">, a: BuchungsAnteil): string {
  return JSON.stringify({
    id: a.buchungId,
    von: b.von,
    bis: b.bis,
    station: b.stationId,
    klasse: b.klasseId,
    anteil_eur: a.anteilCent / 100,
    inklusiv_km: a.inklusivKmAnteil,
    mehrkm_satz_eur: a.mehrkmSatzCent === null ? null : a.mehrkmSatzCent / 100,
  });
}

/**
 * Umkehrung von `rechnerBuchungFeld` für eine gespeicherte Anfrage
 * (`rechner_request.buchung` einer gesperrten Version). `mieteCent` und
 * `geplanteAuftraege` sind dort nicht enthalten und kommen als 0 zurück; der
 * Vergleich `gleicherAnteil` braucht sie nicht. Ungültig → null.
 */
export function anteilAusRechnerFeld(roh: unknown): BuchungsAnteil | null {
  if (typeof roh !== "string" || roh.trim() === "") return null;
  let w: unknown;
  try {
    w = JSON.parse(roh);
  } catch {
    return null;
  }
  if (!w || typeof w !== "object") return null;
  const o = w as Record<string, unknown>;
  const zahlOderNull = (x: unknown) => (x === null ? null : typeof x === "number" && Number.isFinite(x) ? x : undefined);
  const km = zahlOderNull(o.inklusiv_km);
  const satz = zahlOderNull(o.mehrkm_satz_eur);
  if (typeof o.id !== "string" || typeof o.anteil_eur !== "number" || !Number.isFinite(o.anteil_eur) || km === undefined || satz === undefined) {
    return null;
  }
  return {
    buchungId: o.id,
    mieteCent: 0,
    geplanteAuftraege: 0,
    anteilCent: Math.round(o.anteil_eur * 100),
    inklusivKmAnteil: km,
    mehrkmSatzCent: satz === null ? null : Math.round(satz * 100),
  };
}

export interface BuchungZuordnung {
  dealId: string;
  titel: string;
  /** Erster Tag des Umzugs laut Plan; null ohne Termin. */
  tag: string | null;
  geschaetzteKm: number | null;
}

/** Eingefrorener Preis, der auf einer Buchung beruht (gesperrte Version oder gesendetes Terminangebot). */
export interface EingefrorenerAnteil {
  dealId: string;
  titel: string;
  datum: string;
  anteil: BuchungsAnteil;
}

/** Rest-Kilometer der Buchung; null, wenn unbegrenzt oder eine Schätzung fehlt. */
export function restKm(b: Pick<TransporterBuchung, "inklusivKm">, zuordnungen: readonly BuchungZuordnung[]): number | null {
  if (b.inklusivKm === null || zuordnungen.some((z) => z.geschaetzteKm === null)) return null;
  return b.inklusivKm - zuordnungen.reduce((s, z) => s + (z.geschaetzteKm ?? 0), 0);
}

/**
 * Warnungen nach einer Änderung (E6): gesendete Preise ändern sich nie, der
 * Plan sagt nur, was nicht mehr passt. Reihenfolge fest, Texte ohne Gedankenstriche.
 */
export function buchungsWarnungen(input: {
  buchung: TransporterBuchung;
  zuordnungen: readonly BuchungZuordnung[];
  eingefroren: readonly EingefrorenerAnteil[];
}): string[] {
  const b = input.buchung;
  const aus: string[] = [];
  const jetzt = buchungsAnteil(b);
  const betroffen = input.eingefroren.filter((e) => e.anteil.buchungId === b.id);
  if (b.status === "storniert" && betroffen.length > 0) {
    aus.push(`Storniert, aber ${betroffen.length} gesendete Preise rechnen mit dieser Buchung (${namen(betroffen)}). Die Preise bleiben.`);
  } else {
    const anders = betroffen.filter((e) => !gleicherAnteil(e.anteil, jetzt) || !buchungDeckt(b, e.datum));
    if (anders.length > 0) {
      aus.push(`${anders.length} gesendete Preise beruhen auf dem alten Stand der Buchung (${namen(anders)}). Die Preise bleiben.`);
    }
  }
  const aktiv = b.status !== "storniert";
  if (aktiv && input.zuordnungen.length > b.geplanteAuftraege) {
    aus.push(`${input.zuordnungen.length} Aufträge zugeordnet, geplant waren ${b.geplanteAuftraege}.`);
  }
  const ausserhalb = input.zuordnungen.filter((z) => z.tag !== null && !(b.von <= z.tag && b.bis >= z.tag));
  if (aktiv && ausserhalb.length > 0) {
    aus.push(`Termin außerhalb der Buchung: ${ausserhalb.map((z) => z.titel).join(", ")}.`);
  }
  const rest = restKm(b, input.zuordnungen);
  if (aktiv && rest !== null && rest < 0) aus.push(`${-rest} km über den inklusiven Kilometern.`);
  return aus;
}

function namen(liste: readonly { titel: string }[]): string {
  const alle = [...new Set(liste.map((e) => e.titel))];
  return alle.length <= 3 ? alle.join(", ") : `${alle.slice(0, 3).join(", ")} und ${alle.length - 3} weitere`;
}

const WT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] as const;

function tagText(tag: string, mitMonat: boolean): string {
  const [j, m, d] = tag.split("-").map(Number) as [number, number, number];
  const wt = WT[new Date(Date.UTC(j, m - 1, d)).getUTCDay()]!;
  return mitMonat ? `${wt} ${d}.${m}.` : `${wt} ${d}.`;
}

/** Leiste im Plan: „Sprinter L · Sixt Feuerbach · Mo 17. bis So 23.11. · 450 € · 800 km inkl. · 3 von 4 Aufträgen“. */
export function buchungsLeisteText(b: TransporterBuchung, zuordnungen: readonly BuchungZuordnung[]): string {
  const zeitraum = b.von === b.bis ? tagText(b.von, true) : `${tagText(b.von, b.von.slice(5, 7) !== b.bis.slice(5, 7))} bis ${tagText(b.bis, true)}`;
  const rest = restKm(b, zuordnungen);
  const teile = [
    b.klasseName,
    b.stationName,
    zeitraum,
    euro(b.mieteCent).replace(",00 €", " €"),
    b.inklusivKm === null ? null : `${b.inklusivKm} km inkl.`,
    `${zuordnungen.length} von ${b.geplanteAuftraege} ${b.geplanteAuftraege === 1 ? "Auftrag" : "Aufträgen"}`,
    rest === null ? null : `Rest ${rest} km`,
    b.status === "storniert" ? "storniert" : null,
  ];
  return teile.filter((t): t is string => t !== null && t !== "").join(" · ");
}

/** Buchung im Plan (`PlanAntwort.buchungen`), ohne interne Zahlen außer der Miete. */
export interface PlanBuchung {
  id: string;
  firmaId: string;
  von: string;
  bis: string;
  text: string;
  status: BuchungStatus;
  zugeordnet: number;
  geplant: number;
  warnungen: string[];
}

// ─── Karten-Ansicht (12c) ────────────────────────────────────────────────────

/** [Längengrad, Breitengrad] wie MapLibre und GeoJSON. */
export type Punkt = [number, number];

/**
 * Person auf der Karte. `punkt` ist der Mittelpunkt von PLZ und Ort
 * (`einsatz_orte`, ohne Personenbezug), nie eine Straße. Kein Firmenfeld:
 * Mitarbeiter arbeiten für beide Firmen.
 */
export interface KartenPerson {
  employeeId: string;
  name: string;
  kuerzel: string;
  ortText: string | null;
  ortSchluessel: string | null;
  punkt: Punkt | null;
  lage: PersonLage;
}

export interface KartenAuftragPunkt {
  punkt: Punkt;
  /** Ort oder Ortsteil, z. B. „Stuttgart-West“. */
  text: string;
}

/** Antwort von `GET /api/v1/deals/[recordId]/einsatz/karte`. */
export interface EinsatzKarte {
  beladen: KartenAuftragPunkt | null;
  entladen: KartenAuftragPunkt | null;
  /** Hauptstrecke Beladen → Entladen aus `deal_calculation_routes`; leer ohne gespeicherte Route. */
  linie: Punkt[];
  /** „Noch keine Route: erst die Kalkulation rechnen.“ oder „3 Orte ohne Kartenpunkt.“ */
  hinweise: string[];
  personen: KartenPerson[];
}

export interface PinGruppe {
  schluessel: string;
  punkt: Punkt;
  ortText: string;
  /** Frei zuerst, dann belegt, dann abwesend; je Lage nach Name. */
  personen: KartenPerson[];
  freiZahl: number;
}

const LAGE_RANG: Record<PersonLage, number> = { frei: 0, belegt: 1, abwesend: 2 };

/**
 * Leute am selben Ort werden ein Pin: gleicher `ortSchluessel`, sonst gleicher
 * Punkt auf vier Nachkommastellen. Personen ohne Punkt stehen unter
 * `ohnePunkt` (Liste neben der Karte). Gruppen nach Schlüssel sortiert.
 */
export function pinGruppen(personen: readonly KartenPerson[]): { gruppen: PinGruppe[]; ohnePunkt: KartenPerson[] } {
  const map = new Map<string, PinGruppe>();
  const ohnePunkt: KartenPerson[] = [];
  for (const p of personen) {
    if (!p.punkt) {
      ohnePunkt.push(p);
      continue;
    }
    const schluessel = p.ortSchluessel ?? `${p.punkt[0].toFixed(4)},${p.punkt[1].toFixed(4)}`;
    const g = map.get(schluessel);
    if (g) g.personen.push(p);
    else map.set(schluessel, { schluessel, punkt: p.punkt, ortText: p.ortText ?? "", personen: [p], freiZahl: 0 });
  }
  const sortiere = (a: KartenPerson, b: KartenPerson) =>
    LAGE_RANG[a.lage] - LAGE_RANG[b.lage] || a.name.localeCompare(b.name, "de") || a.employeeId.localeCompare(b.employeeId);
  const gruppen = [...map.values()]
    .map((g) => ({ ...g, personen: [...g.personen].sort(sortiere), freiZahl: g.personen.filter((p) => p.lage === "frei").length }))
    .sort((a, b) => a.schluessel.localeCompare(b.schluessel));
  return { gruppen, ohnePunkt: [...ohnePunkt].sort(sortiere) };
}

/** Ausschnitt über Auftrag, Linie und alle Pins als [[West, Süd], [Ost, Nord]]; null ohne Punkt. */
export function kartenGrenzen(karte: Pick<EinsatzKarte, "beladen" | "entladen" | "linie">, gruppen: readonly PinGruppe[]): [Punkt, Punkt] | null {
  const alle: Punkt[] = [...karte.linie, ...gruppen.map((g) => g.punkt)];
  if (karte.beladen) alle.push(karte.beladen.punkt);
  if (karte.entladen) alle.push(karte.entladen.punkt);
  if (alle.length === 0) return null;
  let w = Infinity, s = Infinity, o = -Infinity, n = -Infinity;
  for (const [lng, lat] of alle) {
    w = Math.min(w, lng); o = Math.max(o, lng); s = Math.min(s, lat); n = Math.max(n, lat);
  }
  return [[w, s], [o, n]];
}

export type ZiehenErgebnis = "hinzufuegen" | "rueckfrage_belegt" | "rueckfrage_abwesend" | "schon_im_team";

/**
 * Was beim Ablegen einer Person auf dem Auftrag passiert (Karte und Liste
 * gleich). Ändert nur die Auswahl im Dialog; gespeichert wird erst mit
 * „Team bestätigen“ (E3). Inaktive erscheinen gar nicht auf der Karte.
 */
export function ziehenErgebnis(lage: PersonLage, imTeam: boolean): ZiehenErgebnis {
  if (imTeam) return "schon_im_team";
  if (lage === "abwesend") return "rueckfrage_abwesend";
  if (lage === "belegt") return "rueckfrage_belegt";
  return "hinzufuegen";
}
