/**
 * Person merge / un-merge engine (KOT-IDENTITY, D3).
 *
 * mergePersons collapses an ABSORBED people record into a SURVIVOR people record:
 * it copies the loser's clean phone/email values, rewrites every person-level
 * reference (record_values.referenced_record_id, inbox_contacts.crm_record_id,
 * person_identifiers, activity_events.record_id) to the survivor, recomputes
 * multi_company_flag, coalesces the AI debounce + writes the 15-minute hold, then
 * SOFT-DELETES the loser. A full pre-merge snapshot is stored on the merge edge so
 * splitPersons can losslessly reverse it.
 *
 * IMPORTANT: this is a PERSON merge. It never merges deals (one person may have
 * several legitimate deals). It therefore does NOT touch the deal blast-radius;
 * deal records keep pointing at the survivor via the rewritten associated_people
 * reference rows.
 *
 * Not yet integration-tested against a live database — verified by tsc + the pure
 * survivorship/canonical unit tests. Run against a Neon branch before prod use.
 */

import { db } from "@/db";
import {
  records,
  recordValues,
  objects,
  attributes,
  personIdentifiers,
  personMergeEdges,
  inboxContacts,
  inboxConversations,
  activityEvents,
} from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { emitEvent } from "./activity-events";
import { newValuesToAdd } from "@/lib/identity/survivorship";
import { recomputeMultiCompanyForPerson } from "./multi-company";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const HOLD_MS = 15 * 60 * 1000; // D1 post-merge hold window

export interface MergePersonsInput {
  workspaceId: string;
  /** people record id that survives */
  survivorId: string;
  /** people record id that is absorbed and soft-deleted */
  absorbedId: string;
  method: "deterministic" | "suggested" | "manual";
  confidence?: number | null;
  signals?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  actorId?: string | null;
}

export interface MergePersonsResult {
  mergeEdgeId: string;
}

interface MergeSnapshot {
  survivorId: string;
  absorbedId: string;
  /** new survivor record_value rows added (loser's unique phones/emails) */
  copiedValueIds: string[];
  /** record_value rows whose referenced_record_id was rewritten loser->survivor */
  rewrittenRefValueIds: string[];
  /** ref rows DELETED as dedupe (a deal that referenced both) — recreate on split */
  deletedDupRefValues: Array<{ recordId: string; attributeId: string; sortOrder: number }>;
  rewrittenContactIds: string[];
  rewrittenIdentifierIds: string[];
  rewrittenActivityIds: string[];
  /** conversations whose AI state we touched, with their prior values */
  affectedConversations: Array<{ id: string; aiPaused: boolean; aiHoldUntil: string | null }>;
}

interface PeopleAttrs {
  peopleObjectId: string;
  nameAttrId: string | null;
  phoneAttrId: string | null;
  emailAttrId: string | null;
  multiFlagAttrId: string | null;
}

async function loadPeopleAttrs(tx: Tx, workspaceId: string): Promise<PeopleAttrs | null> {
  const [peopleObj] = await tx
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "people")))
    .limit(1);
  if (!peopleObj) return null;
  const attrRows = await tx
    .select({ id: attributes.id, slug: attributes.slug })
    .from(attributes)
    .where(eq(attributes.objectId, peopleObj.id));
  const bySlug = new Map(attrRows.map((a) => [a.slug, a.id]));
  return {
    peopleObjectId: peopleObj.id,
    nameAttrId: bySlug.get("name") ?? null,
    phoneAttrId: bySlug.get("phone_numbers") ?? null,
    emailAttrId: bySlug.get("email_addresses") ?? null,
    multiFlagAttrId: bySlug.get("multi_company_flag") ?? null,
  };
}

/** Copy the loser's genuinely-new phone/email values onto the survivor. Returns
 *  the ids of the newly-inserted survivor record_value rows. */
async function copyMultiselectValues(
  tx: Tx,
  survivorId: string,
  absorbedId: string,
  attrId: string,
  kind: "phone" | "email",
  actorId: string | null
): Promise<string[]> {
  const survivorRows = await tx
    .select({ textValue: recordValues.textValue, sortOrder: recordValues.sortOrder })
    .from(recordValues)
    .where(and(eq(recordValues.recordId, survivorId), eq(recordValues.attributeId, attrId)));
  const loserRows = await tx
    .select({ textValue: recordValues.textValue })
    .from(recordValues)
    .where(and(eq(recordValues.recordId, absorbedId), eq(recordValues.attributeId, attrId)));

  const survivorRaw = survivorRows.map((r) => r.textValue).filter((v): v is string => !!v);
  const loserRaw = loserRows.map((r) => r.textValue).filter((v): v is string => !!v);
  const additions = newValuesToAdd(survivorRaw, loserRaw, kind);
  if (additions.length === 0) return [];

  const maxSort = survivorRows.reduce((m, r) => Math.max(m, r.sortOrder), -1);
  const inserted = await tx
    .insert(recordValues)
    .values(
      additions.map((raw, i) => ({
        recordId: survivorId,
        attributeId: attrId,
        textValue: raw,
        sortOrder: maxSort + 1 + i,
        createdBy: actorId,
      }))
    )
    .returning({ id: recordValues.id });
  return inserted.map((r) => r.id);
}

export async function mergePersons(input: MergePersonsInput): Promise<MergePersonsResult> {
  const { workspaceId, survivorId, absorbedId, method } = input;
  const actorId = input.actorId ?? null;

  if (survivorId === absorbedId) {
    throw new Error("[person-merge] survivor and absorbed are the same record");
  }

  const mergeEdgeId = await db.transaction(async (tx) => {
    const peopleAttrs = await loadPeopleAttrs(tx, workspaceId);
    if (!peopleAttrs) throw new Error("[person-merge] no people object for workspace");

    // Validate both records are LIVE people in this workspace.
    const recs = await tx
      .select({ id: records.id, objectId: records.objectId, deletedAt: records.deletedAt })
      .from(records)
      .where(inArray(records.id, [survivorId, absorbedId]));
    const survivor = recs.find((r) => r.id === survivorId);
    const absorbed = recs.find((r) => r.id === absorbedId);
    if (!survivor || !absorbed) throw new Error("[person-merge] survivor or absorbed record not found");
    if (survivor.objectId !== peopleAttrs.peopleObjectId || absorbed.objectId !== peopleAttrs.peopleObjectId) {
      throw new Error("[person-merge] both records must be people");
    }
    if (absorbed.deletedAt) throw new Error("[person-merge] absorbed record is already merged/deleted");

    // ── Copy the loser's clean values onto the survivor ──────────────────────
    const copiedValueIds: string[] = [];
    if (peopleAttrs.phoneAttrId) {
      copiedValueIds.push(
        ...(await copyMultiselectValues(tx, survivorId, absorbedId, peopleAttrs.phoneAttrId, "phone", actorId))
      );
    }
    if (peopleAttrs.emailAttrId) {
      copiedValueIds.push(
        ...(await copyMultiselectValues(tx, survivorId, absorbedId, peopleAttrs.emailAttrId, "email", actorId))
      );
    }

    // ── Rewrite person references loser -> survivor, dedupe collisions ────────
    const absorbedRefRows = await tx
      .select({ id: recordValues.id, recordId: recordValues.recordId, attributeId: recordValues.attributeId, sortOrder: recordValues.sortOrder })
      .from(recordValues)
      .where(eq(recordValues.referencedRecordId, absorbedId));
    const survivorRefRows = await tx
      .select({ recordId: recordValues.recordId, attributeId: recordValues.attributeId })
      .from(recordValues)
      .where(eq(recordValues.referencedRecordId, survivorId));
    const survivorRefKeys = new Set(survivorRefRows.map((r) => `${r.recordId}::${r.attributeId}`));
    const toRewrite = absorbedRefRows.filter((r) => !survivorRefKeys.has(`${r.recordId}::${r.attributeId}`));
    const toDelete = absorbedRefRows.filter((r) => survivorRefKeys.has(`${r.recordId}::${r.attributeId}`));

    if (toRewrite.length > 0) {
      await tx
        .update(recordValues)
        .set({ referencedRecordId: survivorId })
        .where(inArray(recordValues.id, toRewrite.map((r) => r.id)));
    }
    if (toDelete.length > 0) {
      await tx.delete(recordValues).where(inArray(recordValues.id, toDelete.map((r) => r.id)));
    }

    // ── Re-point inbox_contacts, person_identifiers, activity_events ─────────
    const contactRows = await tx
      .select({ id: inboxContacts.id })
      .from(inboxContacts)
      .where(eq(inboxContacts.crmRecordId, absorbedId));
    const rewrittenContactIds = contactRows.map((r) => r.id);
    if (rewrittenContactIds.length > 0) {
      await tx
        .update(inboxContacts)
        .set({ crmRecordId: survivorId, updatedAt: new Date() })
        .where(inArray(inboxContacts.id, rewrittenContactIds));
    }

    const identifierRows = await tx
      .select({ id: personIdentifiers.id })
      .from(personIdentifiers)
      .where(eq(personIdentifiers.personRecordId, absorbedId));
    const rewrittenIdentifierIds = identifierRows.map((r) => r.id);
    if (rewrittenIdentifierIds.length > 0) {
      await tx
        .update(personIdentifiers)
        .set({ personRecordId: survivorId })
        .where(inArray(personIdentifiers.id, rewrittenIdentifierIds));
    }

    const activityRows = await tx
      .select({ id: activityEvents.id })
      .from(activityEvents)
      .where(eq(activityEvents.recordId, absorbedId));
    const rewrittenActivityIds = activityRows.map((r) => r.id);
    if (rewrittenActivityIds.length > 0) {
      await tx
        .update(activityEvents)
        .set({ recordId: survivorId })
        .where(inArray(activityEvents.id, rewrittenActivityIds));
    }

    // ── AI coalesce + 15-minute hold across the survivor's conversations ─────
    const convRows = await tx
      .select({ id: inboxConversations.id, aiPaused: inboxConversations.aiPaused, aiHoldUntil: inboxConversations.aiHoldUntil })
      .from(inboxConversations)
      .innerJoin(inboxContacts, eq(inboxConversations.contactId, inboxContacts.id))
      .where(eq(inboxContacts.crmRecordId, survivorId));
    const affectedConversations = convRows.map((c) => ({
      id: c.id,
      aiPaused: c.aiPaused,
      aiHoldUntil: c.aiHoldUntil ? c.aiHoldUntil.toISOString() : null,
    }));
    const anyPaused = convRows.some((c) => c.aiPaused);
    if (convRows.length > 0) {
      await tx
        .update(inboxConversations)
        .set({ aiHoldUntil: new Date(Date.now() + HOLD_MS), ...(anyPaused ? { aiPaused: true } : {}) })
        .where(inArray(inboxConversations.id, convRows.map((c) => c.id)));
    }

    // ── Soft-delete the loser ────────────────────────────────────────────────
    await tx
      .update(records)
      .set({ deletedAt: new Date(), mergedIntoRecordId: survivorId })
      .where(eq(records.id, absorbedId));

    // ── Recompute multi_company_flag on the survivor ─────────────────────────
    await recomputeMultiCompanyForPerson(tx, workspaceId, survivorId, {
      multiFlagAttrId: peopleAttrs.multiFlagAttrId,
      actorId,
    });

    // ── Record the merge edge with the reversal snapshot ─────────────────────
    const snapshot: MergeSnapshot = {
      survivorId,
      absorbedId,
      copiedValueIds,
      rewrittenRefValueIds: toRewrite.map((r) => r.id),
      deletedDupRefValues: toDelete.map((r) => ({ recordId: r.recordId, attributeId: r.attributeId, sortOrder: r.sortOrder })),
      rewrittenContactIds,
      rewrittenIdentifierIds,
      rewrittenActivityIds,
      affectedConversations,
    };

    const [edge] = await tx
      .insert(personMergeEdges)
      .values({
        workspaceId,
        survivorRecordId: survivorId,
        absorbedRecordId: absorbedId,
        method,
        status: "applied",
        confidence: input.confidence ?? (method === "deterministic" ? 1 : null),
        signals: input.signals ?? {},
        evidence: input.evidence ?? {},
        snapshot: snapshot as unknown as Record<string, unknown>,
        createdBy: actorId,
        decidedAt: new Date(),
      })
      .returning({ id: personMergeEdges.id });
    return edge.id;
  });

  // Audit outside the transaction (telemetry must never roll back the merge).
  await emitEvent({
    workspaceId,
    recordId: survivorId,
    objectSlug: "people",
    eventType: "person.merge",
    payload: { mergeEdgeId, absorbedId, method, confidence: input.confidence ?? null, signals: input.signals ?? {} },
    actorId,
  });

  return { mergeEdgeId };
}

/**
 * Reverse an applied merge from its snapshot. Restores the absorbed person, its
 * references, identifiers, contacts and activity, undoes the value copy and the
 * AI hold, and recomputes multi_company_flag for both records.
 */
export async function splitPersons(mergeEdgeId: string, actorId: string | null = null): Promise<void> {
  const survivorId = await db.transaction(async (tx) => {
    const [edge] = await tx
      .select()
      .from(personMergeEdges)
      .where(eq(personMergeEdges.id, mergeEdgeId))
      .limit(1);
    if (!edge) throw new Error("[person-merge] merge edge not found");
    if (edge.status !== "applied") throw new Error(`[person-merge] cannot split a ${edge.status} merge`);

    const snap = edge.snapshot as unknown as MergeSnapshot;
    const survivor = edge.survivorRecordId;
    const absorbed = edge.absorbedRecordId;
    const peopleAttrs = await loadPeopleAttrs(tx, edge.workspaceId);

    // Restore the absorbed record.
    await tx.update(records).set({ deletedAt: null, mergedIntoRecordId: null }).where(eq(records.id, absorbed));

    // Undo the value copy.
    if (snap.copiedValueIds?.length) {
      await tx.delete(recordValues).where(inArray(recordValues.id, snap.copiedValueIds));
    }
    // Restore rewritten references to the absorbed record.
    if (snap.rewrittenRefValueIds?.length) {
      await tx
        .update(recordValues)
        .set({ referencedRecordId: absorbed })
        .where(inArray(recordValues.id, snap.rewrittenRefValueIds));
    }
    // Recreate the dedupe-deleted reference rows (pointing back at the absorbed).
    if (snap.deletedDupRefValues?.length) {
      await tx.insert(recordValues).values(
        snap.deletedDupRefValues.map((r) => ({
          recordId: r.recordId,
          attributeId: r.attributeId,
          referencedRecordId: absorbed,
          sortOrder: r.sortOrder,
          createdBy: actorId,
        }))
      );
    }
    // Re-point contacts / identifiers / activity.
    if (snap.rewrittenContactIds?.length) {
      await tx
        .update(inboxContacts)
        .set({ crmRecordId: absorbed, updatedAt: new Date() })
        .where(inArray(inboxContacts.id, snap.rewrittenContactIds));
    }
    if (snap.rewrittenIdentifierIds?.length) {
      await tx
        .update(personIdentifiers)
        .set({ personRecordId: absorbed })
        .where(inArray(personIdentifiers.id, snap.rewrittenIdentifierIds));
    }
    if (snap.rewrittenActivityIds?.length) {
      await tx
        .update(activityEvents)
        .set({ recordId: absorbed })
        .where(inArray(activityEvents.id, snap.rewrittenActivityIds));
    }
    // Restore each touched conversation's AI state.
    for (const c of snap.affectedConversations ?? []) {
      await tx
        .update(inboxConversations)
        .set({ aiPaused: c.aiPaused, aiHoldUntil: c.aiHoldUntil ? new Date(c.aiHoldUntil) : null })
        .where(eq(inboxConversations.id, c.id));
    }
    // Recompute the derived flag for both records.
    await recomputeMultiCompanyForPerson(tx, edge.workspaceId, survivor, {
      multiFlagAttrId: peopleAttrs?.multiFlagAttrId ?? null,
      actorId,
    });
    await recomputeMultiCompanyForPerson(tx, edge.workspaceId, absorbed, {
      multiFlagAttrId: peopleAttrs?.multiFlagAttrId ?? null,
      actorId,
    });

    await tx
      .update(personMergeEdges)
      .set({ status: "reverted", revertedAt: new Date() })
      .where(eq(personMergeEdges.id, mergeEdgeId));

    return survivor;
  });

  await emitEvent({
    workspaceId: (await db.select({ w: personMergeEdges.workspaceId }).from(personMergeEdges).where(eq(personMergeEdges.id, mergeEdgeId)).limit(1))[0]?.w ?? "",
    recordId: survivorId,
    objectSlug: "people",
    eventType: "person.unmerge",
    payload: { mergeEdgeId },
    actorId,
  });
}
