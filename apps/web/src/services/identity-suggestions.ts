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
import { objects, attributes, records, recordValues, personIdentifiers, personMergeEdges } from "@/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { extractPersonalName } from "@/lib/display-name";
import { jaroWinkler, normalizeName } from "@/lib/identity/jaro-winkler";

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
