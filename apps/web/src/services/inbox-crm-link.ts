/**
 * The single ingest contract that resolves an inbound contact to ONE golden
 * CRM "people" record (KOT-IDENTITY).
 *
 * resolveOrCreatePerson canonicalizes the inbound identifiers (E.164 phone,
 * lowercased email), looks up an existing person by HARD canonical key via the
 * person_identifiers graph (plus a legacy exact-value fallback), attaches to it
 * or creates a new person, fires a DETERMINISTIC auto-merge (D1) when the same
 * human turns out to own two person records, and records every identifier on the
 * graph. ensureCrmPerson is kept as a thin backward-compatible wrapper so the
 * existing email / Kleinanzeigen / WhatsApp call sites get the upgrade with no
 * changes.
 *
 * Failures are logged but never thrown — CRM resolution must never block ingest.
 */

import { db } from "@/db";
import { inboxContacts } from "@/db/schema/inbox";
import { personIdentifiers } from "@/db/schema/identity";
import { objects, attributes, selectOptions } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import { eq, and, or, inArray, asc } from "drizzle-orm";
import { createRecord, updateRecord } from "./records";
import { canonicalizePhone, canonicalizeEmail, isRelayEmail } from "@/lib/identity/canonical";
import { mergePersons } from "./person-merge";

type IdentifierSource = "email" | "kleinanzeigen" | "whatsapp" | "sms" | "operator" | "import";
type IdentifierTrust = "verified" | "operator" | "claimed";

export interface ResolvePersonCtx {
  workspaceId: string;
  /** inbox_contacts row to link to the resolved person (optional). */
  contactId: string | null;
  displayName: string;
  /** raw email; may be a Kleinanzeigen relay address. */
  email?: string | null;
  /** raw phone in any format. */
  phone?: string | null;
  /** additional phones rescued from message text (KA "(Tel.: ...)", operator-pasted). */
  extraPhones?: string[];
  /**
   * WhatsApp LID JID (`<digits>@lid`) this contact messaged from, if the
   * thread is LID-routed. Recorded as a `wa_lid` identifier (a hard key for
   * the SAME WhatsApp identity), never as a phone. Lets a later message from
   * the same LID find this person even when no phone could be resolved.
   */
  waLid?: string | null;
  /**
   * Known-same-human person records discovered outside the identifier graph
   * (e.g. the person of the contact that owns the conversation this message
   * landed in). Joined into the candidate set so the deterministic merge can
   * unify them.
   */
  extraCandidatePersonIds?: string[];
  leadSource: string;
  source: IdentifierSource;
  trust?: IdentifierTrust;
}

export interface ResolvePersonResult {
  personRecordId: string | null;
  isNew: boolean;
  autoMerged: boolean;
}

interface PeopleCtx {
  peopleObjectId: string;
  attrBySlug: Map<string, string>;
}

/**
 * Canonical form of a WhatsApp LID identity key: `<digits>@lid`, no device
 * suffix. `@hosted.lid` collapses to the same canonical (same identity space);
 * accepts bare digits too (defensively), rejects everything else.
 */
function canonicalizeWaLid(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  const m = s.match(/^(\d{6,20})(?::\d+)?(?:@(?:hosted\.)?lid)?$/);
  if (!m) return null;
  return `${m[1]}@lid`;
}

async function loadPeople(workspaceId: string): Promise<PeopleCtx | null> {
  const [peopleObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "people")))
    .limit(1);
  if (!peopleObj) return null;
  const attrRows = await db
    .select({ id: attributes.id, slug: attributes.slug })
    .from(attributes)
    .where(eq(attributes.objectId, peopleObj.id));
  return { peopleObjectId: peopleObj.id, attrBySlug: new Map(attrRows.map((a) => [a.slug, a.id])) };
}

/** Find existing people whose person_identifiers carry one of the given HARD keys. */
export async function findPersonsByCanonical(
  workspaceId: string,
  phoneCanons: string[],
  emailCanon: string | null,
  waLidCanon?: string | null
): Promise<string[]> {
  const clauses = [];
  if (phoneCanons.length > 0) {
    clauses.push(and(eq(personIdentifiers.kind, "phone"), inArray(personIdentifiers.valueCanonical, phoneCanons)));
  }
  if (emailCanon) {
    clauses.push(and(eq(personIdentifiers.kind, "email"), eq(personIdentifiers.valueCanonical, emailCanon)));
  }
  if (waLidCanon) {
    clauses.push(and(eq(personIdentifiers.kind, "wa_lid"), eq(personIdentifiers.valueCanonical, waLidCanon)));
  }
  if (clauses.length === 0) return [];
  const rows = await db
    .selectDistinct({ p: personIdentifiers.personRecordId })
    .from(personIdentifiers)
    .where(and(eq(personIdentifiers.workspaceId, workspaceId), clauses.length === 1 ? clauses[0] : or(...clauses)));
  return rows.map((r) => r.p);
}

/** Insert or refresh a person_identifier, deduped by hard canonical key (or raw for soft kinds). */
export async function upsertIdentifier(
  workspaceId: string,
  personRecordId: string,
  kind: "phone" | "email" | "ka_relay_email" | "ka_pseudonym" | "wa_name" | "wa_lid",
  valueRaw: string,
  valueCanonical: string | null,
  source: IdentifierSource,
  trust: IdentifierTrust
): Promise<void> {
  if (valueCanonical) {
    const [ex] = await db
      .select({ id: personIdentifiers.id })
      .from(personIdentifiers)
      .where(and(eq(personIdentifiers.workspaceId, workspaceId), eq(personIdentifiers.kind, kind), eq(personIdentifiers.valueCanonical, valueCanonical)))
      .limit(1);
    if (ex) {
      await db.update(personIdentifiers).set({ lastSeen: new Date(), personRecordId }).where(eq(personIdentifiers.id, ex.id));
      return;
    }
  } else {
    const [ex] = await db
      .select({ id: personIdentifiers.id })
      .from(personIdentifiers)
      .where(and(eq(personIdentifiers.workspaceId, workspaceId), eq(personIdentifiers.personRecordId, personRecordId), eq(personIdentifiers.kind, kind), eq(personIdentifiers.valueRaw, valueRaw)))
      .limit(1);
    if (ex) {
      await db.update(personIdentifiers).set({ lastSeen: new Date() }).where(eq(personIdentifiers.id, ex.id));
      return;
    }
  }
  await db.insert(personIdentifiers).values({ workspaceId, personRecordId, kind, valueRaw, valueCanonical, source, trust });
}

/** Create a fresh people record from the inbound contact. */
async function createPersonRecord(
  people: PeopleCtx,
  displayName: string,
  email: string | null,
  phone: string | null,
  leadSource: string
): Promise<string | null> {
  let leadSourceOptionId: string | null = null;
  const leadSourceAttrId = people.attrBySlug.get("lead_source");
  if (leadSourceAttrId) {
    const options = await db
      .select({ id: selectOptions.id, title: selectOptions.title })
      .from(selectOptions)
      .where(eq(selectOptions.attributeId, leadSourceAttrId));
    leadSourceOptionId = options.find((o) => o.title === leadSource)?.id ?? null;
  }
  const input: Record<string, unknown> = { name: parsePersonalName(displayName) };
  if (email) input.email_addresses = email;
  if (phone) input.phone_numbers = phone;
  if (leadSourceOptionId) input.lead_source = leadSourceOptionId;
  const record = await createRecord(people.peopleObjectId, input, null);
  return record?.id ?? null;
}

/** Add any missing email/phone values to an existing person. */
async function enrichPerson(
  people: PeopleCtx,
  recordId: string,
  email: string | null,
  phone: string | null
): Promise<void> {
  const enrich: Record<string, unknown> = {};
  const emailAttrId = people.attrBySlug.get("email_addresses");
  const phoneAttrId = people.attrBySlug.get("phone_numbers");
  if (email && emailAttrId && !(await hasAttributeValue(recordId, emailAttrId, email))) {
    enrich.email_addresses = email;
  }
  if (phone && phoneAttrId && !(await hasAttributeValue(recordId, phoneAttrId, phone))) {
    enrich.phone_numbers = phone;
  }
  if (Object.keys(enrich).length > 0) {
    await updateRecord(people.peopleObjectId, recordId, enrich, null);
  }
}

/**
 * THE single mandated ingest contract. Resolves an inbound contact to one golden
 * person, auto-merging duplicates on a hard-key collision (D1).
 */
export async function resolveOrCreatePerson(ctx: ResolvePersonCtx): Promise<ResolvePersonResult> {
  const trust = ctx.trust ?? "claimed";
  try {
    const people = await loadPeople(ctx.workspaceId);
    if (!people) {
      console.warn(`[inbox-crm-link] no people object for workspace ${ctx.workspaceId}`);
      return { personRecordId: null, isNew: false, autoMerged: false };
    }

    // ── Canonicalize inbound identifiers ─────────────────────────────────────
    const emailRaw = ctx.email ?? null;
    const phoneRaw = ctx.phone ?? null;
    const emailCanon = canonicalizeEmail(emailRaw);
    const relay = emailRaw && isRelayEmail(emailRaw) ? emailRaw : null;
    const phoneCanons = Array.from(
      new Set(
        [phoneRaw, ...(ctx.extraPhones ?? [])]
          .map((p) => (p ? canonicalizePhone(p) : null))
          .filter((p): p is string => !!p)
      )
    );
    const waLidCanon = canonicalizeWaLid(ctx.waLid);

    // ── Find candidate person records (graph hard-key + legacy exact match) ──
    const matched = await findPersonsByCanonical(ctx.workspaceId, phoneCanons, emailCanon, waLidCanon);
    const legacy = await findExistingPerson(
      people.peopleObjectId,
      emailCanon ?? emailRaw,
      phoneRaw,
      people.attrBySlug.get("email_addresses") ?? null,
      people.attrBySlug.get("phone_numbers") ?? null
    );
    let p0: string | null = null;
    if (ctx.contactId) {
      const [c] = await db.select({ crm: inboxContacts.crmRecordId }).from(inboxContacts).where(eq(inboxContacts.id, ctx.contactId)).limit(1);
      p0 = c?.crm ?? null;
    }
    const candidates = Array.from(
      new Set(
        [p0, ...matched, legacy, ...(ctx.extraCandidatePersonIds ?? [])].filter(
          (v): v is string => !!v
        )
      )
    );

    // ── Resolve target + deterministic auto-merge ────────────────────────────
    let target: string | null = null;
    let isNew = false;
    let autoMerged = false;

    if (candidates.length === 0) {
      target = await createPersonRecord(people, ctx.displayName, emailCanon ?? null, phoneRaw, ctx.leadSource);
      isNew = !!target;
    } else if (candidates.length === 1) {
      target = candidates[0];
    } else {
      // Multiple person records for one human -> merge into the OLDEST (survivor).
      const rows = await db
        .select({ id: records.id })
        .from(records)
        .where(inArray(records.id, candidates))
        .orderBy(asc(records.createdAt));
      const ordered = rows.map((r) => r.id).filter((id) => candidates.includes(id));
      const survivor = ordered[0] ?? candidates[0];
      for (const other of candidates) {
        if (other === survivor) continue;
        try {
          await mergePersons({
            workspaceId: ctx.workspaceId,
            survivorId: survivor,
            absorbedId: other,
            method: "deterministic",
            confidence: 1,
            evidence: { reason: "ingest hard-key collision", phoneCanons, emailCanon, waLidCanon, source: ctx.source },
          });
          autoMerged = true;
        } catch (err) {
          console.error("[inbox-crm-link] auto-merge failed:", err);
        }
      }
      target = survivor;
    }

    if (!target) return { personRecordId: null, isNew: false, autoMerged };

    // ── Link the contact + enrich the person ─────────────────────────────────
    if (ctx.contactId) {
      await db.update(inboxContacts).set({ crmRecordId: target, updatedAt: new Date() }).where(eq(inboxContacts.id, ctx.contactId));
    }
    if (!isNew) await enrichPerson(people, target, emailCanon ?? null, phoneRaw);

    // ── Record identifiers on the graph ──────────────────────────────────────
    for (const canon of phoneCanons) {
      await upsertIdentifier(ctx.workspaceId, target, "phone", canon, canon, ctx.source, trust);
    }
    if (emailCanon) await upsertIdentifier(ctx.workspaceId, target, "email", emailRaw ?? emailCanon, emailCanon, ctx.source, trust);
    if (relay) await upsertIdentifier(ctx.workspaceId, target, "ka_relay_email", relay, null, ctx.source, "claimed");
    if (waLidCanon) await upsertIdentifier(ctx.workspaceId, target, "wa_lid", ctx.waLid ?? waLidCanon, waLidCanon, ctx.source, trust);

    return { personRecordId: target, isNew, autoMerged };
  } catch (err) {
    console.error("[inbox-crm-link] resolveOrCreatePerson failed:", err);
    return { personRecordId: null, isNew: false, autoMerged: false };
  }
}

/**
 * Backward-compatible wrapper. Idempotent: if the contact is already linked,
 * returns that record id. Otherwise delegates to resolveOrCreatePerson.
 */
export async function ensureCrmPerson(params: {
  workspaceId: string;
  contactId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  leadSource: "WhatsApp / Website" | "Kleinanzeigen";
  /** phones rescued from message text (KA "(Tel.: ...)", operator-pasted). */
  extraPhones?: string[];
  /** See ResolvePersonCtx.waLid: the `<digits>@lid` JID for LID-routed threads. */
  waLid?: string | null;
  /** See ResolvePersonCtx.extraCandidatePersonIds. */
  extraCandidatePersonIds?: string[];
}): Promise<string | null> {
  try {
    const [contact] = await db
      .select({ crmRecordId: inboxContacts.crmRecordId })
      .from(inboxContacts)
      .where(eq(inboxContacts.id, params.contactId))
      .limit(1);
    if (contact?.crmRecordId) {
      // Already linked. Still record the LID on the graph: the linked case is
      // exactly the one where a LID-routed reply just matched an existing
      // phone contact, and the wa_lid key is what lets the NEXT message from
      // this LID find the person even if no phone can be resolved then.
      const waLidCanon = canonicalizeWaLid(params.waLid);
      if (waLidCanon) {
        const owners = await findPersonsByCanonical(params.workspaceId, [], null, waLidCanon);
        const foreignOwner = owners.some((o) => o !== contact.crmRecordId);
        if (!foreignOwner) {
          await upsertIdentifier(
            params.workspaceId,
            contact.crmRecordId,
            "wa_lid",
            params.waLid ?? waLidCanon,
            waLidCanon,
            "whatsapp",
            "verified"
          );
          return contact.crmRecordId;
        }
        // The wa_lid already belongs to ANOTHER person: the same WhatsApp
        // identity owns two person records. Do NOT silently reassign the
        // identifier (that bypasses the merge and ping-pongs ownership) —
        // fall through to the full resolution below so the hard-key
        // collision enters the candidate set and the deterministic merge
        // unifies the records.
      } else {
        return contact.crmRecordId;
      }
    }

    const source: IdentifierSource =
      params.leadSource === "Kleinanzeigen"
        ? "kleinanzeigen"
        : params.phone || params.waLid
          ? "whatsapp"
          : "email";
    const { personRecordId } = await resolveOrCreatePerson({
      workspaceId: params.workspaceId,
      contactId: params.contactId,
      displayName: params.displayName,
      email: params.email,
      phone: params.phone,
      extraPhones: params.extraPhones,
      waLid: params.waLid,
      extraCandidatePersonIds: params.extraCandidatePersonIds,
      leadSource: params.leadSource,
      source,
      trust: "verified",
    });
    return personRecordId;
  } catch (err) {
    console.error("[inbox-crm-link] ensureCrmPerson failed:", err);
    return null;
  }
}

/**
 * Search for an existing CRM people record that has a matching email
 * or phone stored in its record_values (legacy exact match).
 */
async function findExistingPerson(
  peopleObjectId: string,
  email: string | null,
  phone: string | null,
  emailAttrId: string | null,
  phoneAttrId: string | null
): Promise<string | null> {
  if (email && emailAttrId) {
    const [match] = await db
      .select({ recordId: recordValues.recordId })
      .from(recordValues)
      .innerJoin(records, eq(records.id, recordValues.recordId))
      .where(and(eq(records.objectId, peopleObjectId), eq(recordValues.attributeId, emailAttrId), eq(recordValues.textValue, email)))
      .limit(1);
    if (match) return match.recordId;
  }
  if (phone && phoneAttrId) {
    const [match] = await db
      .select({ recordId: recordValues.recordId })
      .from(recordValues)
      .innerJoin(records, eq(records.id, recordValues.recordId))
      .where(and(eq(records.objectId, peopleObjectId), eq(recordValues.attributeId, phoneAttrId), eq(recordValues.textValue, phone)))
      .limit(1);
    if (match) return match.recordId;
  }
  return null;
}

/** Check if a record already has a specific text value for an attribute. */
async function hasAttributeValue(recordId: string, attributeId: string, value: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: recordValues.id })
    .from(recordValues)
    .where(and(eq(recordValues.recordId, recordId), eq(recordValues.attributeId, attributeId), eq(recordValues.textValue, value)))
    .limit(1);
  return !!existing;
}

/** Parse a display name string into the personal_name JSON format. */
function parsePersonalName(displayName: string): { first_name: string; last_name: string; full_name: string } {
  const trimmed = (displayName || "").trim();
  if (!trimmed) return { first_name: "", last_name: "", full_name: "" };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { first_name: parts[0], last_name: "", full_name: trimmed };
  return { first_name: parts[0], last_name: parts.slice(1).join(" "), full_name: trimmed };
}
