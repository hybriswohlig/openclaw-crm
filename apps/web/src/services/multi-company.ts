/**
 * multi_company_flag maintenance (KOT-IDENTITY).
 *
 * One shared recompute for the "this client talks to more than one of our
 * operating companies" badge, used by every path that changes the underlying
 * facts: email ingest, WhatsApp ingest, person merge/split and the backfill
 * script. Historically the email ingest had its own set-only variant and the
 * merge engine its own recompute, while the WhatsApp ingest set nothing — so
 * WhatsApp-only cross-company clients (the common case) never got the badge,
 * but newsletter senders that mail both companies' inboxes did.
 *
 * Lane gate: only conversations in a CUSTOMER lane (`lead`, `review`) count.
 * `info`/`spam` is system mail — PayPal writing to both companies' mailboxes
 * is not a cross-company customer.
 */

import { db } from "@/db";
import {
  inboxContacts,
  inboxConversations,
  channelAccounts,
  objects,
  attributes,
  recordValues,
} from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

/** Conversation lanes that represent a real customer relationship. */
export const MULTI_COMPANY_LANES = ["lead", "review"] as const;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbLike = typeof db | Tx;

/** Resolve the people-object `multi_company_flag` attribute id, or null when
 *  the workspace's schema doesn't have it (attr write is then skipped). */
export async function findMultiFlagAttrId(
  ex: DbLike,
  workspaceId: string
): Promise<string | null> {
  const [peopleObj] = await ex
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "people")))
    .limit(1);
  if (!peopleObj) return null;
  const [attr] = await ex
    .select({ id: attributes.id })
    .from(attributes)
    .where(
      and(
        eq(attributes.objectId, peopleObj.id),
        eq(attributes.slug, "multi_company_flag")
      )
    )
    .limit(1);
  return attr?.id ?? null;
}

/**
 * Person-scoped recompute: distinct operating companies over the person's
 * customer-lane conversations. Writes the people boolean record_value (source
 * of truth) and mirrors ALL inbox_contacts rows of the person. Derived state,
 * so safe to call from merge, split, ingest and backfill alike.
 *
 * `opts.multiFlagAttrId`: pass the already-resolved attr id (merge engine),
 * `null` to skip the attr write, or omit to have it resolved here.
 */
export async function recomputeMultiCompanyForPerson(
  ex: DbLike,
  workspaceId: string,
  personId: string,
  opts?: { multiFlagAttrId?: string | null; actorId?: string | null }
): Promise<boolean> {
  const ocRows = await ex
    .selectDistinct({ oc: channelAccounts.operatingCompanyRecordId })
    .from(inboxConversations)
    .innerJoin(inboxContacts, eq(inboxConversations.contactId, inboxContacts.id))
    .innerJoin(
      channelAccounts,
      eq(inboxConversations.channelAccountId, channelAccounts.id)
    )
    .where(
      and(
        eq(inboxContacts.crmRecordId, personId),
        sql`${channelAccounts.operatingCompanyRecordId} is not null`,
        inArray(inboxConversations.lane, [...MULTI_COMPANY_LANES])
      )
    );
  const distinct = new Set(
    ocRows.map((r) => r.oc).filter((v): v is string => !!v)
  );
  const flag = distinct.size >= 2;

  const multiFlagAttrId =
    opts && "multiFlagAttrId" in (opts as object)
      ? (opts.multiFlagAttrId ?? null)
      : await findMultiFlagAttrId(ex, workspaceId);

  if (multiFlagAttrId) {
    await ex
      .delete(recordValues)
      .where(
        and(
          eq(recordValues.recordId, personId),
          eq(recordValues.attributeId, multiFlagAttrId)
        )
      );
    await ex.insert(recordValues).values({
      recordId: personId,
      attributeId: multiFlagAttrId,
      booleanValue: flag,
      sortOrder: 0,
      createdBy: opts?.actorId ?? null,
    });
  }
  await ex
    .update(inboxContacts)
    .set({ multiCompanyFlag: flag })
    .where(eq(inboxContacts.crmRecordId, personId));
  return flag;
}

/**
 * Contact-scoped entry point for the ingest paths. Person-linked contacts are
 * recomputed person-wide (the flag is a person property); unlinked contacts
 * fall back to their own conversations. Never throws — flag maintenance must
 * not block message ingest.
 */
export async function recomputeMultiCompanyForContact(
  workspaceId: string,
  contactId: string
): Promise<boolean> {
  try {
    const [contact] = await db
      .select({
        id: inboxContacts.id,
        crmRecordId: inboxContacts.crmRecordId,
        multiCompanyFlag: inboxContacts.multiCompanyFlag,
      })
      .from(inboxContacts)
      .where(
        and(
          eq(inboxContacts.id, contactId),
          eq(inboxContacts.workspaceId, workspaceId)
        )
      )
      .limit(1);
    if (!contact) return false;

    if (contact.crmRecordId) {
      return await recomputeMultiCompanyForPerson(
        db,
        workspaceId,
        contact.crmRecordId
      );
    }

    const ocRows = await db
      .selectDistinct({ oc: channelAccounts.operatingCompanyRecordId })
      .from(inboxConversations)
      .innerJoin(
        channelAccounts,
        eq(inboxConversations.channelAccountId, channelAccounts.id)
      )
      .where(
        and(
          eq(inboxConversations.contactId, contactId),
          sql`${channelAccounts.operatingCompanyRecordId} is not null`,
          inArray(inboxConversations.lane, [...MULTI_COMPANY_LANES])
        )
      );
    const distinct = new Set(
      ocRows.map((r) => r.oc).filter((v): v is string => !!v)
    );
    const flag = distinct.size >= 2;
    if (flag !== contact.multiCompanyFlag) {
      await db
        .update(inboxContacts)
        .set({ multiCompanyFlag: flag, updatedAt: new Date() })
        .where(eq(inboxContacts.id, contactId));
    }
    return flag;
  } catch (err) {
    console.error("[multi-company] recompute failed (non-blocking):", err);
    return false;
  }
}
