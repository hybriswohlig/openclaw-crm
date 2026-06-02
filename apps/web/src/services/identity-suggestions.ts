/**
 * Soft merge-suggestion matcher (KOT-IDENTITY Phase 4). Finds people who look
 * like the same human but share NO hard identifier (e.g. a Kleinanzeigen contact
 * and a WhatsApp contact with the same name, different/absent phones), scores the
 * name similarity, and writes person_merge_edges with status='suggested' for an
 * operator to confirm. NEVER auto-merges — soft signals only suggest.
 *
 * Precision-biased: a pair where BOTH people have phone identifiers that differ
 * is vetoed (two different numbers = almost certainly two different humans). The
 * cross-channel case (one side has no phone yet) is exactly what we surface.
 */
import { db } from "@/db";
import { objects, attributes, records, recordValues, personIdentifiers, personMergeEdges, inboxConversations, inboxContacts, channelAccounts } from "@/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { extractPersonalName } from "@/lib/display-name";
import { jaroWinkler, normalizeName } from "@/lib/identity/jaro-winkler";
import { batchGetRecordDisplayNames } from "./display-names";
import { mergePersons } from "./person-merge";

const NAME_THRESHOLD = 0.9; // JW >= this to even consider a suggestion

export interface SuggestionPair {
  survivor: string;
  absorbed: string;
  jw: number;
  nameA: string;
  nameB: string;
}

export async function scanForSuggestions(workspaceId: string, opts: { apply?: boolean } = {}): Promise<SuggestionPair[]> {
  const [peopleObj] = await db.select({ id: objects.id }).from(objects).where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "people"))).limit(1);
  if (!peopleObj) return [];
  const [nameAttr] = await db.select({ id: attributes.id }).from(attributes).where(and(eq(attributes.objectId, peopleObj.id), eq(attributes.slug, "name"))).limit(1);
  if (!nameAttr) return [];

  const people = await db.select({ id: records.id }).from(records).where(and(eq(records.objectId, peopleObj.id), isNull(records.deletedAt)));
  const ids = people.map((p) => p.id);
  if (ids.length < 2) return [];

  const nameRows = await db.select({ recordId: recordValues.recordId, jsonValue: recordValues.jsonValue }).from(recordValues).where(and(inArray(recordValues.recordId, ids), eq(recordValues.attributeId, nameAttr.id)));
  const nameByPerson = new Map<string, string>();
  for (const r of nameRows) {
    const dn = extractPersonalName(r.jsonValue);
    if (dn) nameByPerson.set(r.recordId, normalizeName(dn));
  }

  const phoneRows = await db.select({ personRecordId: personIdentifiers.personRecordId, v: personIdentifiers.valueCanonical }).from(personIdentifiers).where(and(eq(personIdentifiers.workspaceId, workspaceId), eq(personIdentifiers.kind, "phone")));
  const phonesByPerson = new Map<string, Set<string>>();
  for (const r of phoneRows) {
    if (!r.v) continue;
    (phonesByPerson.get(r.personRecordId) ?? phonesByPerson.set(r.personRecordId, new Set()).get(r.personRecordId)!).add(r.v);
  }

  const found: SuggestionPair[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i], b = ids[j];
      const nA = nameByPerson.get(a), nB = nameByPerson.get(b);
      if (!nA || !nB) continue;
      const jw = jaroWinkler(nA, nB);
      if (jw < NAME_THRESHOLD) continue;
      // Veto: both have phones and they are disjoint -> different humans.
      const pa = phonesByPerson.get(a), pb = phonesByPerson.get(b);
      if (pa && pb && pa.size > 0 && pb.size > 0) {
        const shares = [...pa].some((x) => pb.has(x));
        if (!shares) continue; // disjoint phones -> veto
      }
      const [survivor, absorbed] = a < b ? [a, b] : [b, a]; // lexicographic placeholder
      found.push({ survivor, absorbed, jw, nameA: nA, nameB: nB });
    }
  }

  if (opts.apply) {
    for (const p of found) {
      await db
        .insert(personMergeEdges)
        .values({
          workspaceId,
          survivorRecordId: p.survivor,
          absorbedRecordId: p.absorbed,
          method: "suggested",
          status: "suggested",
          confidence: p.jw,
          signals: { jaroWinkler: p.jw, nameA: p.nameA, nameB: p.nameB },
          evidence: { kind: "name-similarity" },
        })
        .onConflictDoNothing();
    }
  }
  return found;
}

interface PersonInboxInfo {
  channels: string;
  lastPreview: string | null;
  convCount: number;
  hasLead: boolean;
}

/** Per-person inbox summary: channels, last preview, count, and whether the
 *  person is a real LEAD (has a conversation in the lead lane). */
async function personInboxInfo(workspaceId: string, personIds: string[]): Promise<Map<string, PersonInboxInfo>> {
  const out = new Map<string, PersonInboxInfo>();
  if (personIds.length === 0) return out;
  const rows = await db
    .select({
      crm: inboxContacts.crmRecordId,
      channelType: channelAccounts.channelType,
      lane: inboxConversations.lane,
      lastMessageAt: inboxConversations.lastMessageAt,
      lastPreview: inboxConversations.lastMessagePreview,
      ext: inboxConversations.externalThreadId,
    })
    .from(inboxConversations)
    .innerJoin(inboxContacts, eq(inboxConversations.contactId, inboxContacts.id))
    .innerJoin(channelAccounts, eq(inboxConversations.channelAccountId, channelAccounts.id))
    .where(and(eq(inboxConversations.workspaceId, workspaceId), inArray(inboxContacts.crmRecordId, personIds)));

  const acc = new Map<string, { channels: Set<string>; lastAt: string; lastPreview: string | null; count: number; hasLead: boolean }>();
  for (const r of rows) {
    if (!r.crm) continue;
    const a = acc.get(r.crm) ?? { channels: new Set<string>(), lastAt: "", lastPreview: null, count: 0, hasLead: false };
    const isKa = /@mail\.kleinanzeigen\.de$/i.test(r.ext ?? "");
    a.channels.add(isKa ? "Kleinanzeigen" : r.channelType === "whatsapp" ? "WhatsApp" : r.channelType === "sms" ? "SMS" : "E-Mail");
    a.count += 1;
    if (r.lane === "lead") a.hasLead = true;
    const at = r.lastMessageAt ? new Date(r.lastMessageAt).toISOString() : "";
    if (at >= a.lastAt) { a.lastAt = at; a.lastPreview = r.lastPreview; }
    acc.set(r.crm, a);
  }
  for (const [id, a] of acc) out.set(id, { channels: [...a.channels].join(", "), lastPreview: a.lastPreview, convCount: a.count, hasLead: a.hasLead });
  return out;
}

export interface MergeSuggestionView {
  survivorId: string;
  survivorName: string;
  survivorChannels: string;
  survivorPreview: string | null;
  survivorConvCount: number;
  absorbedId: string;
  absorbedName: string;
  absorbedChannels: string;
  absorbedPreview: string | null;
  absorbedConvCount: number;
  jw: number;
}

/** Live merge suggestions, LEADS only (bots / marketing whose chats are in the
 *  Info lane are excluded), enriched with per-person details for a preview, and
 *  excluding pairs already decided. */
export async function getMergeSuggestions(workspaceId: string): Promise<MergeSuggestionView[]> {
  const pairs = await scanForSuggestions(workspaceId, { apply: false });
  if (pairs.length === 0) return [];
  const decided = await db
    .select({ s: personMergeEdges.survivorRecordId, a: personMergeEdges.absorbedRecordId })
    .from(personMergeEdges)
    .where(and(eq(personMergeEdges.workspaceId, workspaceId), inArray(personMergeEdges.status, ["rejected", "applied", "reverted"])));
  const skip = new Set(decided.map((d) => `${d.s}|${d.a}`));
  const fresh = pairs.filter((p) => !skip.has(`${p.survivor}|${p.absorbed}`));
  if (fresh.length === 0) return [];
  const ids = [...new Set(fresh.flatMap((p) => [p.survivor, p.absorbed]))];
  const [names, info] = await Promise.all([batchGetRecordDisplayNames(ids), personInboxInfo(workspaceId, ids)]);
  const leadOnly = fresh.filter((p) => info.get(p.survivor)?.hasLead && info.get(p.absorbed)?.hasLead);
  return leadOnly.map((p) => {
    const si = info.get(p.survivor);
    const ai = info.get(p.absorbed);
    return {
      survivorId: p.survivor,
      survivorName: names.get(p.survivor)?.displayName ?? "Unbekannt",
      survivorChannels: si?.channels ?? "",
      survivorPreview: si?.lastPreview ?? null,
      survivorConvCount: si?.convCount ?? 0,
      absorbedId: p.absorbed,
      absorbedName: names.get(p.absorbed)?.displayName ?? "Unbekannt",
      absorbedChannels: ai?.channels ?? "",
      absorbedPreview: ai?.lastPreview ?? null,
      absorbedConvCount: ai?.convCount ?? 0,
      jw: p.jw,
    };
  });
}

/** Accept a suggested merge. Survivor = the older record (more established). */
export async function acceptMergeSuggestion(workspaceId: string, idA: string, idB: string, actorId: string | null): Promise<void> {
  const rows = await db.select({ id: records.id, createdAt: records.createdAt, deletedAt: records.deletedAt }).from(records).where(inArray(records.id, [idA, idB]));
  const a = rows.find((r) => r.id === idA);
  const b = rows.find((r) => r.id === idB);
  if (!a || !b || a.deletedAt || b.deletedAt) throw new Error("one of the records is missing or already merged");
  const survivor = a.createdAt <= b.createdAt ? idA : idB;
  const absorbed = survivor === idA ? idB : idA;
  await mergePersons({ workspaceId, survivorId: survivor, absorbedId: absorbed, method: "manual", confidence: 1, evidence: { reason: "operator confirmed name-similarity suggestion" }, actorId });
}

/** Remember a rejected suggestion so it is not surfaced again. */
export async function rejectMergeSuggestion(workspaceId: string, survivorId: string, absorbedId: string, actorId: string | null): Promise<void> {
  await db
    .insert(personMergeEdges)
    .values({ workspaceId, survivorRecordId: survivorId, absorbedRecordId: absorbedId, method: "suggested", status: "rejected", evidence: { kind: "name-similarity", rejectedBy: actorId }, decidedAt: new Date(), createdBy: actorId })
    .onConflictDoNothing();
}
