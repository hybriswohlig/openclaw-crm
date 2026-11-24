/**
 * JSON-Attribut `dokument_empfaenger` am Deal. Anlegen beim Schreiben, damit
 * MCP und die Akte funktionieren, bevor ein Sync der Standardobjekte lief.
 * Keine Migration, keine neue Spalte.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { attributes } from "@/db/schema/objects";
import { recordValues } from "@/db/schema/records";
import { createAttribute, getAttributeBySlug } from "@/services/attributes";
import { getObjectBySlug } from "@/services/objects";
import { getRecord, updateRecord } from "@/services/records";
import {
  DOKUMENT_EMPFAENGER_SLUG,
  LEERER_EMPFAENGER,
  parseDokumentEmpfaenger,
  pruefeDokumentEmpfaenger,
  type DokumentEmpfaenger,
  type DokumentAnrede,
  type DokumentPruefung,
} from "@/lib/dokument-empfaenger";

export async function sicherstellenDokumentAttribut(objectId: string) {
  const vorhanden = await getAttributeBySlug(objectId, DOKUMENT_EMPFAENGER_SLUG);
  if (vorhanden) return vorhanden;
  try {
    return await createAttribute(objectId, {
      slug: DOKUMENT_EMPFAENGER_SLUG,
      title: "Name auf Dokument",
      type: "json",
    });
  } catch {
    return getAttributeBySlug(objectId, DOKUMENT_EMPFAENGER_SLUG);
  }
}

export async function liesDokumentEmpfaenger(workspaceId: string, dealId: string): Promise<DokumentEmpfaenger> {
  const obj = await getObjectBySlug(workspaceId, "deals");
  if (!obj) return { ...LEERER_EMPFAENGER };
  const record = await getRecord(obj.id, dealId);
  if (!record) return { ...LEERER_EMPFAENGER };
  return parseDokumentEmpfaenger((record.values as Record<string, unknown>).dokument_empfaenger);
}

export async function speichereDokumentEmpfaenger(
  workspaceId: string,
  dealId: string,
  roh: unknown,
  userId: string | null
): Promise<DokumentPruefung & { fehlt?: boolean }> {
  const geprueft = pruefeDokumentEmpfaenger(roh);
  if (!geprueft.ok) return geprueft;
  const obj = await getObjectBySlug(workspaceId, "deals");
  if (!obj) return { ok: false, fehler: "Deal-Objekt fehlt." };
  await sicherstellenDokumentAttribut(obj.id);
  const record = await updateRecord(obj.id, dealId, { dokument_empfaenger: geprueft.wert }, userId);
  if (!record) return { ok: false, fehler: "Deal nicht gefunden.", fehlt: true };
  return geprueft;
}

/** Gesetzte Sie/Du-Anrede je Deal. Fehlt das Attribut, ist die Map leer. */
export async function anredenAmDeal(dealIds: readonly string[]): Promise<Map<string, DokumentAnrede>> {
  const ids = [...new Set(dealIds.filter(Boolean))];
  const aus = new Map<string, DokumentAnrede>();
  if (ids.length === 0) return aus;
  try {
    const rows = await db
      .select({ recordId: recordValues.recordId, jsonValue: recordValues.jsonValue })
      .from(recordValues)
      .innerJoin(attributes, eq(attributes.id, recordValues.attributeId))
      .where(and(eq(attributes.slug, DOKUMENT_EMPFAENGER_SLUG), inArray(recordValues.recordId, ids)));
    for (const row of rows) {
      const anrede = parseDokumentEmpfaenger(row.jsonValue).anrede;
      if (anrede) aus.set(row.recordId, anrede);
    }
  } catch (err) {
    console.error("[dokument-empfaenger] Anrede nicht gelesen", err);
  }
  return aus;
}

export async function anredeAmDeal(dealId: string): Promise<DokumentAnrede | null> {
  return (await anredenAmDeal([dealId])).get(dealId) ?? null;
}
