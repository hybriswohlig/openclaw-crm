import { db } from "@/db";
import {
  activityEvents,
  attributes,
  objects,
  personIdentifiers,
  phoneCalls,
  recordValues,
  records,
} from "@/db/schema";
import { canonicalizePhone } from "@/lib/identity/canonical";
import {
  decideCallMatch,
  replayFill,
  type CallMatchStatus,
  type TelefonCallInput,
} from "@/lib/phone-calls";
import { findPersonsByCanonical } from "@/services/inbox-crm-link";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

export type PhoneCallRow = typeof phoneCalls.$inferSelect;

export interface IngestPhoneCallResult {
  id: string;
  duplicate: boolean;
  filled: boolean;
  matchStatus: CallMatchStatus;
  personRecordId: string | null;
}

function isUniqueViolation(err: unknown): boolean {
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    if ("code" in cur && (cur as { code?: string }).code === "23505") return true;
    cur = "cause" in cur ? (cur as { cause?: unknown }).cause : null;
  }
  return false;
}

async function livePersonIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: records.id })
    .from(records)
    .where(and(inArray(records.id, ids), isNull(records.deletedAt)));
  return rows.map((row) => row.id);
}

/** People whose phone_numbers text canonicalizes to this E.164. One scan per call. */
async function personIdsFromPhoneValues(workspaceId: string, e164: string): Promise<string[]> {
  const rows = await db
    .select({ recordId: recordValues.recordId, text: recordValues.textValue })
    .from(recordValues)
    .innerJoin(records, eq(records.id, recordValues.recordId))
    .innerJoin(attributes, eq(attributes.id, recordValues.attributeId))
    .innerJoin(objects, eq(objects.id, attributes.objectId))
    .where(
      and(
        eq(objects.workspaceId, workspaceId),
        eq(objects.slug, "people"),
        eq(attributes.slug, "phone_numbers"),
        isNull(records.deletedAt)
      )
    );
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.text && canonicalizePhone(row.text) === e164) ids.add(row.recordId);
  }
  return [...ids];
}

export async function livePersonIdsForE164(workspaceId: string, e164: string): Promise<string[]> {
  const [fromGraph, fromValues] = await Promise.all([
    findPersonsByCanonical(workspaceId, [e164], null),
    personIdsFromPhoneValues(workspaceId, e164),
  ]);
  return livePersonIds([...new Set([...fromGraph, ...fromValues])]);
}

async function canonicalPhonesForPerson(personId: string): Promise<string[]> {
  const [identifierRows, valueRows] = await Promise.all([
    db
      .select({ value: personIdentifiers.valueCanonical })
      .from(personIdentifiers)
      .where(and(eq(personIdentifiers.personRecordId, personId), eq(personIdentifiers.kind, "phone"))),
    db
      .select({ text: recordValues.textValue })
      .from(recordValues)
      .innerJoin(attributes, eq(attributes.id, recordValues.attributeId))
      .where(and(eq(recordValues.recordId, personId), eq(attributes.slug, "phone_numbers"))),
  ]);
  const phones = new Set<string>();
  for (const row of identifierRows) {
    if (row.value) phones.add(row.value);
  }
  for (const row of valueRows) {
    const canon = canonicalizePhone(row.text);
    if (canon) phones.add(canon);
  }
  return [...phones];
}

async function associatedPeopleIds(workspaceId: string, dealRecordId: string): Promise<string[]> {
  const [attr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .innerJoin(objects, eq(attributes.objectId, objects.id))
    .where(
      and(
        eq(objects.workspaceId, workspaceId),
        eq(objects.slug, "deals"),
        eq(attributes.slug, "associated_people")
      )
    )
    .limit(1);
  if (!attr) return [];
  const links = await db
    .select({ personId: recordValues.referencedRecordId })
    .from(recordValues)
    .where(and(eq(recordValues.recordId, dealRecordId), eq(recordValues.attributeId, attr.id)));
  return links.map((link) => link.personId).filter((id): id is string => !!id);
}

async function callsAttachedToPerson(workspaceId: string, personId: string): Promise<PhoneCallRow[]> {
  const direct = await db
    .select()
    .from(phoneCalls)
    .where(and(eq(phoneCalls.workspaceId, workspaceId), eq(phoneCalls.personRecordId, personId)))
    .orderBy(desc(phoneCalls.startedAt))
    .limit(50);

  const phones = await canonicalPhonesForPerson(personId);
  if (phones.length === 0) return direct;

  const loose = await db
    .select()
    .from(phoneCalls)
    .where(
      and(
        eq(phoneCalls.workspaceId, workspaceId),
        isNull(phoneCalls.personRecordId),
        eq(phoneCalls.matchStatus, "unmatched"),
        inArray(phoneCalls.callerE164, phones)
      )
    )
    .orderBy(desc(phoneCalls.startedAt))
    .limit(50);

  const visible: PhoneCallRow[] = [];
  const owners = new Map<string, string[]>();
  for (const row of loose) {
    if (!row.callerE164) continue;
    let ids = owners.get(row.callerE164);
    if (!ids) {
      ids = await livePersonIdsForE164(workspaceId, row.callerE164);
      owners.set(row.callerE164, ids);
    }
    if (ids.length === 1 && ids[0] === personId) visible.push(row);
  }

  const byId = new Map<string, PhoneCallRow>();
  for (const row of [...direct, ...visible]) byId.set(row.id, row);
  return [...byId.values()].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()).slice(0, 50);
}

/** Calls on a person, or on the people linked to a deal. Other objects get none. */
export async function listCallsForRecord(
  workspaceId: string,
  objectSlug: string,
  recordId: string
): Promise<PhoneCallRow[]> {
  if (objectSlug === "people") return callsAttachedToPerson(workspaceId, recordId);
  if (objectSlug !== "deals") return [];
  const people = await associatedPeopleIds(workspaceId, recordId);
  const groups = await Promise.all(people.map((personId) => callsAttachedToPerson(workspaceId, personId)));
  const byId = new Map<string, PhoneCallRow>();
  for (const row of groups.flat()) byId.set(row.id, row);
  return [...byId.values()].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()).slice(0, 50);
}

export async function listRecentPhoneCalls(workspaceId: string, limit: number): Promise<PhoneCallRow[]> {
  return db
    .select()
    .from(phoneCalls)
    .where(eq(phoneCalls.workspaceId, workspaceId))
    .orderBy(desc(phoneCalls.startedAt))
    .limit(limit);
}

async function insertCall(
  workspaceId: string,
  input: TelefonCallInput,
  callerE164: string | null,
  calledE164: string | null,
  match: { status: CallMatchStatus; personRecordId: string | null }
): Promise<PhoneCallRow> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(phoneCalls)
      .values({
        workspaceId,
        externalId: input.externalId,
        callerRaw: input.callerRaw,
        callerE164,
        calledRaw: input.calledRaw,
        calledE164,
        lineLabel: input.lineLabel,
        answeredBy: input.answeredBy,
        startedAt: input.startedAt,
        durationSeconds: input.durationSeconds,
        transcript: input.transcript,
        summary: input.summary,
        keywords: input.keywords,
        personRecordId: match.personRecordId,
        matchStatus: match.status,
      })
      .returning();
    await tx.insert(activityEvents).values({
      workspaceId,
      recordId: match.personRecordId,
      objectSlug: match.personRecordId ? "people" : null,
      eventType: "call.received",
      payload: {
        callId: row.id,
        matchStatus: match.status,
      },
    });
    return row;
  });
}

/**
 * Store one call. The same externalId a second time does not create a second
 * row. Empty text fields may be filled. The caller number and the match stay
 * as they were on the first write. Throws on a database error so the sender retries.
 */
export async function ingestPhoneCall(
  workspaceId: string,
  input: TelefonCallInput
): Promise<IngestPhoneCallResult> {
  const callerE164 = canonicalizePhone(input.callerRaw);
  const calledE164 = canonicalizePhone(input.calledRaw);
  const personIds = callerE164 ? await livePersonIdsForE164(workspaceId, callerE164) : [];
  const match = decideCallMatch(callerE164, personIds);

  try {
    const row = await insertCall(workspaceId, input, callerE164, calledE164, match);
    return {
      id: row.id,
      duplicate: false,
      filled: false,
      matchStatus: row.matchStatus as CallMatchStatus,
      personRecordId: row.personRecordId,
    };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }

  const [existing] = await db
    .select()
    .from(phoneCalls)
    .where(and(eq(phoneCalls.workspaceId, workspaceId), eq(phoneCalls.externalId, input.externalId)))
    .limit(1);
  if (!existing) throw new Error("[phone-calls] unique conflict without a row");

  const patch = replayFill(
    {
      transcript: existing.transcript,
      summary: existing.summary,
      keywords: existing.keywords ?? [],
      durationSeconds: existing.durationSeconds,
    },
    {
      transcript: input.transcript,
      summary: input.summary,
      keywords: input.keywords,
      durationSeconds: input.durationSeconds,
    }
  );
  if (!patch) {
    return {
      id: existing.id,
      duplicate: true,
      filled: false,
      matchStatus: existing.matchStatus as CallMatchStatus,
      personRecordId: existing.personRecordId,
    };
  }

  const [updated] = await db
    .update(phoneCalls)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(phoneCalls.id, existing.id))
    .returning();
  return {
    id: updated.id,
    duplicate: true,
    filled: true,
    matchStatus: updated.matchStatus as CallMatchStatus,
    personRecordId: updated.personRecordId,
  };
}
