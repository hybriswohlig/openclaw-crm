/**
 * Stammdaten und Ausnahmen der Mitarbeiter für den Einsatz (Plan 12a).
 * PLZ, Ort und Straße verlassen diesen Dienst nur über `/api/v1/einsatz/*` und den
 * Einsatz-Dialog; nie über `listEmployees`, MCP, Portal oder Mitarbeiter-App.
 */
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { employeeAbsences, employees } from "@/db/schema";
import { kuerzelAus } from "@/lib/akte";
import {
  hourlyRateAusCent,
  istFuehrerschein,
  SATZ_ARBEIT_CENT_VORGABE,
  SATZ_FAHRT_CENT_VORGABE,
  type Abwesenheit,
  type AbwesenheitArt,
  type EinsatzPerson,
  type StammdatenEingabe,
} from "@/lib/einsatz";
import type { CrewLocale } from "@/lib/crew/contract";
import { istCrewLocale, telefonE164 } from "@/lib/crew/telefon";

export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

type PersonZeile = Pick<
  typeof employees.$inferSelect,
  "id" | "name" | "active" | "homePlz" | "homeTown" | "canDriveSprinter" | "ownCar" | "rateDriveCents" | "rateWorkCents"
> &
  Partial<Pick<typeof employees.$inferSelect, "phone" | "locale" | "photoConsentAt" | "homeStreet" | "licenseClass">>;

export function personAus(z: PersonZeile): EinsatzPerson {
  const name = z.name?.trim() || "Ohne Namen";
  return {
    id: z.id,
    name,
    kuerzel: kuerzelAus(name),
    aktiv: z.active,
    plz: z.homePlz,
    wohnort: z.homeTown,
    strasse: z.homeStreet ?? null,
    fuehrerschein: istFuehrerschein(z.licenseClass) ? z.licenseClass : null,
    kannSprinter: z.canDriveSprinter,
    eigenerPkw: z.ownCar,
    satzFahrtCent: z.rateDriveCents,
    satzArbeitCent: z.rateWorkCents,
    telefon: z.phone ?? null,
    sprache: z.locale ?? "de",
    fotoEinwilligungAm: z.photoConsentAt ? z.photoConsentAt.toISOString() : null,
  };
}

export const PERSON_SPALTEN = {
  id: employees.id,
  name: employees.name,
  active: employees.active,
  homePlz: employees.homePlz,
  homeTown: employees.homeTown,
  homeStreet: employees.homeStreet,
  licenseClass: employees.licenseClass,
  canDriveSprinter: employees.canDriveSprinter,
  ownCar: employees.ownCar,
  rateDriveCents: employees.rateDriveCents,
  rateWorkCents: employees.rateWorkCents,
  phone: employees.phone,
  locale: employees.locale,
  photoConsentAt: employees.photoConsentAt,
} as const;

/** Alle Personen des Workspace (auch inaktive), nach Name. */
export async function ladePersonen(ws: string, ex: DbExecutor = db): Promise<EinsatzPerson[]> {
  const rows = await ex
    .select(PERSON_SPALTEN)
    .from(employees)
    .where(eq(employees.workspaceId, ws))
    .orderBy(asc(employees.name), asc(employees.id));
  return rows.map(personAus).sort((a, b) => a.name.localeCompare(b.name, "de") || a.id.localeCompare(b.id));
}

type AbwesenheitZeile = typeof employeeAbsences.$inferSelect;

export function abwesenheitAus(z: AbwesenheitZeile): Abwesenheit {
  return { id: z.id, employeeId: z.employeeId, von: z.von, bis: z.bis, art: z.art as AbwesenheitArt, notiz: z.notiz };
}

/** Ausnahmen, die das Fenster `von..bis` schneiden (inklusiv), nach Beginn. */
export async function ladeAbwesenheiten(ws: string, von: string, bis: string, ex: DbExecutor = db): Promise<Abwesenheit[]> {
  const rows = await ex
    .select()
    .from(employeeAbsences)
    .where(and(eq(employeeAbsences.workspaceId, ws), lte(employeeAbsences.von, bis), gte(employeeAbsences.bis, von)))
    .orderBy(asc(employeeAbsences.von), asc(employeeAbsences.id));
  return rows.map(abwesenheitAus);
}

function wohnfeld(wert: string | null | undefined): string | null {
  if (wert === undefined || wert === null) return null;
  const text = wert.trim();
  return text === "" ? null : text;
}

/** Telefon wie eingegeben plus E.164; leer löscht beides. Der Aufrufer hat die Form geprüft. */
function telefonFelder(telefon: string | null | undefined): { phone?: string | null; phoneCanonical?: string | null } {
  if (telefon === undefined) return {};
  const roh = telefon?.trim() ?? "";
  if (roh === "") return { phone: null, phoneCanonical: null };
  return { phone: roh, phoneCanonical: telefonE164(roh) };
}

/** Unique-Verletzung der Telefonnummer je Workspace (0066). */
export function istTelefonDoppelt(err: unknown): boolean {
  for (let x: unknown = err, i = 0; x && i < 4; x = (x as { cause?: unknown }).cause, i++) {
    const e = x as { code?: unknown; constraint_name?: unknown; constraint?: unknown; message?: unknown };
    if (e.code === "23505" && [e.constraint_name, e.constraint, e.message].some((v) => typeof v === "string" && v.includes("employees_phone_canonical_uq"))) {
      return true;
    }
  }
  return false;
}

function notizAus(notiz: string | null | undefined): string | null {
  if (notiz === undefined || notiz === null) return null;
  const text = notiz.trim().slice(0, 200);
  return text === "" ? null : text;
}

/** Person liegt in diesem Workspace (auch inaktiv). */
export async function mitarbeiterImWorkspace(ws: string, employeeId: string, ex: DbExecutor = db): Promise<boolean> {
  const [row] = await ex
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.workspaceId, ws)))
    .limit(1);
  return !!row;
}

/**
 * Neue Person. Der Aufrufer hat `pruefeStammdaten(e, true)` schon geprüft.
 * Satz und `hourly_rate` stammen aus einer Zahl (E8).
 */
export async function personAnlegen(ws: string, e: StammdatenEingabe, ex: DbExecutor = db): Promise<EinsatzPerson> {
  const rateWorkCents = e.satzArbeitCent ?? SATZ_ARBEIT_CENT_VORGABE;
  const [row] = await ex
    .insert(employees)
    .values({
      workspaceId: ws,
      name: (e.name ?? "").trim(),
      homePlz: wohnfeld(e.plz),
      homeTown: wohnfeld(e.wohnort),
      homeStreet: wohnfeld(e.strasse),
      licenseClass: istFuehrerschein(e.fuehrerschein) ? e.fuehrerschein : null,
      canDriveSprinter: e.kannSprinter ?? false,
      ownCar: e.eigenerPkw ?? false,
      rateDriveCents: e.satzFahrtCent ?? SATZ_FAHRT_CENT_VORGABE,
      rateWorkCents,
      hourlyRate: hourlyRateAusCent(rateWorkCents),
      active: e.aktiv ?? true,
      ...telefonFelder(e.telefon),
      ...(e.sprache !== undefined && istCrewLocale(e.sprache) ? { locale: e.sprache } : {}),
      ...(e.fotoEinwilligung === true ? { photoConsentAt: new Date() } : {}),
    })
    .returning();
  return personAus(row);
}

/** Nur gesetzte Felder. `satzArbeitCent` schreibt auch `hourly_rate`. null, wenn die Id nicht im Workspace liegt. */
export async function personAendern(ws: string, id: string, e: StammdatenEingabe, ex: DbExecutor = db): Promise<EinsatzPerson | null> {
  const [aktuell] = await ex
    .select({ active: employees.active, photoConsentAt: employees.photoConsentAt })
    .from(employees)
    .where(and(eq(employees.id, id), eq(employees.workspaceId, ws)))
    .limit(1);
  if (!aktuell) return null;

  const set: {
    updatedAt: Date;
    name?: string;
    homePlz?: string | null;
    homeTown?: string | null;
    homeStreet?: string | null;
    licenseClass?: string | null;
    canDriveSprinter?: boolean;
    ownCar?: boolean;
    rateDriveCents?: number;
    rateWorkCents?: number;
    hourlyRate?: string;
    active?: boolean;
    deactivatedAt?: Date | null;
    phone?: string | null;
    phoneCanonical?: string | null;
    locale?: CrewLocale;
    photoConsentAt?: Date | null;
  } = { updatedAt: new Date() };
  if (e.name !== undefined) set.name = e.name.trim();
  if (e.plz !== undefined) set.homePlz = wohnfeld(e.plz);
  if (e.wohnort !== undefined) set.homeTown = wohnfeld(e.wohnort);
  if (e.strasse !== undefined) set.homeStreet = wohnfeld(e.strasse);
  if (e.fuehrerschein !== undefined) set.licenseClass = istFuehrerschein(e.fuehrerschein) ? e.fuehrerschein : null;
  if (e.kannSprinter !== undefined) set.canDriveSprinter = e.kannSprinter;
  if (e.eigenerPkw !== undefined) set.ownCar = e.eigenerPkw;
  if (e.satzFahrtCent !== undefined) set.rateDriveCents = e.satzFahrtCent;
  if (e.satzArbeitCent !== undefined) {
    set.rateWorkCents = e.satzArbeitCent;
    set.hourlyRate = hourlyRateAusCent(e.satzArbeitCent);
  }
  if (e.telefon !== undefined) Object.assign(set, telefonFelder(e.telefon));
  if (e.sprache !== undefined && istCrewLocale(e.sprache)) set.locale = e.sprache;
  if (e.fotoEinwilligung === true && !aktuell.photoConsentAt) set.photoConsentAt = new Date();
  if (e.fotoEinwilligung === false) set.photoConsentAt = null;
  if (e.aktiv === false) {
    set.active = false;
    if (aktuell.active) set.deactivatedAt = new Date();
  } else if (e.aktiv === true) {
    set.active = true;
    set.deactivatedAt = null;
  }

  const [row] = await ex
    .update(employees)
    .set(set)
    .where(and(eq(employees.id, id), eq(employees.workspaceId, ws)))
    .returning();
  return row ? personAus(row) : null;
}

/**
 * Ausnahme anlegen. Der Aufrufer hat `pruefeAbwesenheit` geprüft.
 * Wirft, wenn die Person nicht im Workspace liegt.
 */
export async function abwesenheitAnlegen(
  ws: string,
  employeeId: string,
  eingabe: { von: string; bis: string; art: AbwesenheitArt; notiz?: string | null },
  autor: string,
  ex: DbExecutor = db,
): Promise<Abwesenheit> {
  if (!(await mitarbeiterImWorkspace(ws, employeeId, ex))) throw new Error("Mitarbeiter nicht im Workspace");
  const [row] = await ex
    .insert(employeeAbsences)
    .values({
      id: crypto.randomUUID(),
      workspaceId: ws,
      employeeId,
      von: eingabe.von,
      bis: eingabe.bis,
      art: eingabe.art,
      notiz: notizAus(eingabe.notiz),
      createdBy: autor,
    })
    .returning();
  return abwesenheitAus(row);
}

export async function abwesenheitLoeschen(ws: string, id: string, ex: DbExecutor = db): Promise<boolean> {
  const rows = await ex
    .delete(employeeAbsences)
    .where(and(eq(employeeAbsences.id, id), eq(employeeAbsences.workspaceId, ws)))
    .returning({ id: employeeAbsences.id });
  return rows.length > 0;
}

/** Ausnahmen einer Person, die das Fenster `von..bis` schneiden. */
export async function ladeAbwesenheitenPerson(
  ws: string,
  employeeId: string,
  von: string,
  bis: string,
  ex: DbExecutor = db,
): Promise<Abwesenheit[]> {
  const rows = await ex
    .select()
    .from(employeeAbsences)
    .where(
      and(
        eq(employeeAbsences.workspaceId, ws),
        eq(employeeAbsences.employeeId, employeeId),
        lte(employeeAbsences.von, bis),
        gte(employeeAbsences.bis, von),
      ),
    )
    .orderBy(asc(employeeAbsences.von), asc(employeeAbsences.id));
  return rows.map(abwesenheitAus);
}
