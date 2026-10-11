import { db } from "@/db";
import { attributes, objects, statuses } from "@/db/schema/objects";
import { recordValues } from "@/db/schema/records";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { updateRecord } from "./records";
import { stufenKategorie } from "./lagekarte/status";

interface StufenZeile {
  id: string;
  title: string;
  isActive: boolean;
  stageCategory: string | null;
}

/**
 * Startstufe für neue Leads aus einer nach sortOrder sortierten Stufenliste.
 * Aktive Stufen gehen vor; eine englische Dublette aus dem Seed („Inquiry“)
 * gewinnt nie gegen „Neue Anfrage“.
 */
export function waehleNeueAnfrage<T extends StufenZeile>(zeilen: T[]): T | null {
  const aktiv = zeilen.filter((z) => z.isActive);
  return (
    aktiv.find((z) => /^neue anfrage$/i.test(z.title.trim())) ??
    aktiv.find((z) => z.stageCategory === "open_new") ??
    aktiv.find((z) => /^inquiry$/i.test(z.title.trim())) ??
    aktiv[0] ??
    zeilen[0] ??
    null
  );
}

const ohneZusatz = (titel: string) =>
  titel
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();

/**
 * Aktive Stufe zu einem KI-Vorschlag: erst nach Titel, dann über die
 * Kategorie, damit „Planned“ auf „Geplant“ landet und nie auf der
 * ausgeblendeten englischen Dublette.
 */
export function waehleVorgeschlageneStufe<T extends StufenZeile>(zeilen: T[], vorschlag: string): T | null {
  const aktiv = zeilen.filter((z) => z.isActive);
  const gesucht = ohneZusatz(vorschlag);
  const perTitel = aktiv.find((z) => ohneZusatz(z.title) === gesucht);
  if (perTitel) return perTitel;
  const kategorie = stufenKategorie({ titel: vorschlag, kategorie: null });
  if (!kategorie) return null;
  return aktiv.find((z) => stufenKategorie({ titel: z.title, kategorie: z.stageCategory }) === kategorie) ?? null;
}

/** statuses.id der Startstufe für das deals-Objekt, oder null ohne Stufen-Attribut. */
export async function neueAnfrageStufeId(dealsObjectId: string): Promise<string | null> {
  const [stufenAttr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, dealsObjectId), eq(attributes.slug, "stage")))
    .limit(1);
  if (!stufenAttr) return null;
  const zeilen = await db
    .select({
      id: statuses.id,
      title: statuses.title,
      isActive: statuses.isActive,
      stageCategory: statuses.stageCategory,
    })
    .from(statuses)
    .where(eq(statuses.attributeId, stufenAttr.id))
    .orderBy(asc(statuses.sortOrder));
  return waehleNeueAnfrage(zeilen)?.id ?? null;
}

/**
 * Setzt die Startstufe nur, wenn der Lead noch keine hat. Für Leads, die der
 * ImmoScout-Abgleich vor der passenden E-Mail ohne Stufe angelegt hat.
 */
export async function startStufeNachtragen(workspaceId: string, dealRecordId: string): Promise<boolean> {
  const [dealsObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  if (!dealsObj) return false;
  const [stufenAttr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, dealsObj.id), eq(attributes.slug, "stage")))
    .limit(1);
  if (!stufenAttr) return false;
  const [vorhanden] = await db
    .select({ id: recordValues.id })
    .from(recordValues)
    .where(
      and(
        eq(recordValues.recordId, dealRecordId),
        eq(recordValues.attributeId, stufenAttr.id),
        isNotNull(recordValues.textValue),
      ),
    )
    .limit(1);
  if (vorhanden) return false;
  const stufeId = await neueAnfrageStufeId(dealsObj.id);
  if (!stufeId) return false;
  await updateRecord(dealsObj.id, dealRecordId, { stage: stufeId }, null);
  return true;
}

/** Ergänzt die Stufe, wenn keine angegeben ist. */
export function startStufeErgaenzen(werte: Record<string, unknown>, stufeId: string | null): Record<string, unknown> {
  if (!stufeId) return werte;
  if (werte.stage !== undefined && werte.stage !== null && werte.stage !== "") return werte;
  return { ...werte, stage: stufeId };
}

/**
 * Werte für einen neuen Lead mit Startstufe, falls keine mitkommt. Gilt für
 * „Lead anlegen“, API und MCP; andere Objekte bleiben unverändert.
 */
export async function mitStartStufe(
  objectSlug: string,
  objectId: string,
  werte: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (objectSlug !== "deals") return werte;
  return startStufeErgaenzen(werte, await neueAnfrageStufeId(objectId));
}
