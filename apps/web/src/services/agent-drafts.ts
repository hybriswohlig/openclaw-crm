/**
 * Cross-record approval queue for Sales-Outreach-Agent "Antwort-Entwurf"
 * draft notes. Backs the GET/POST routes under
 * `app/api/v1/inbox/drafts` and the `/inbox/drafts` page.
 *
 * Why this exists: drafts land as notes on whichever record the agent picked
 * (`people`, `companies`, `deals`). The per-conversation banner only surfaces
 * a draft to the operator when they have already opened that record's chat
 * view. For the 60-min first-reply SLA Dario needs a single inbox listing
 * every pending draft across every record so he can approve & send without
 * hunting. See parent KOT-627 plan.
 */

import { db } from "@/db";
import { notes } from "@/db/schema/notes";
import { records, recordValues } from "@/db/schema/records";
import { objects, attributes, selectOptions } from "@/db/schema/objects";
import {
  inboxConversations,
  inboxContacts,
  channelAccounts,
} from "@/db/schema/inbox";
import { and, desc, eq, ilike, inArray, isNotNull, like, not } from "drizzle-orm";
import {
  DRAFT_TITLE_PREFIX,
  CONSUMED_TITLE_MARKER,
  consumedTitle,
  extractDraftMessage,
  isAgentDraft,
} from "@/lib/agent-drafts";
import { batchGetRecordDisplayNames } from "./display-names";
import { sendEmailReply } from "./inbox-email";
import { sendWhatsAppReply, WhatsAppSessionExpiredError } from "./inbox-whatsapp";

export interface PendingDraft {
  noteId: string;
  recordId: string;
  recordDisplayName: string;
  objectSlug: string;
  objectName: string;
  conversationId: string | null;
  channelType: "email" | "whatsapp" | null;
  contactName: string | null;
  contactAddress: string | null;
  subject: string | null;
  leadSource: string | null;
  body: string;
  snippet: string;
  createdAt: string;
  updatedAt: string;
}

const MAX_SNIPPET_CHARS = 220;

function snippetFromBody(body: string): string {
  const collapsed = body.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_SNIPPET_CHARS) return collapsed;
  return collapsed.slice(0, MAX_SNIPPET_CHARS - 1).trimEnd() + "…";
}

/**
 * List every Sales-Outreach-Agent draft note in the workspace whose title
 * still indicates "pending" (matches the prefix and does NOT contain the
 * consumed marker). Returns rows newest-first with the data needed to render
 * the queue: record/contact info, lead_source label, body snippet,
 * conversation pointer for the eventual send.
 */
export async function listPendingDrafts(workspaceId: string): Promise<PendingDraft[]> {
  // 1. Pull candidate notes (workspace-scoped via records → objects).
  //    SQL filter narrows to draft titles before app-level isAgentDraft check.
  const candidateRows = await db
    .select({
      noteId: notes.id,
      recordId: notes.recordId,
      title: notes.title,
      content: notes.content,
      createdAt: notes.createdAt,
      updatedAt: notes.updatedAt,
      objectId: records.objectId,
      objectSlug: objects.slug,
      objectName: objects.singularName,
    })
    .from(notes)
    .innerJoin(records, eq(notes.recordId, records.id))
    .innerJoin(objects, eq(records.objectId, objects.id))
    .where(
      and(
        eq(objects.workspaceId, workspaceId),
        like(notes.title, `${DRAFT_TITLE_PREFIX}%`),
        not(ilike(notes.title, `%${CONSUMED_TITLE_MARKER}%`))
      )
    )
    .orderBy(desc(notes.createdAt));

  // Defensive re-check (the consumed marker check above is case-insensitive
  // and broad; isAgentDraft has the canonical rule).
  const candidates = candidateRows.filter((r) =>
    isAgentDraft({ title: r.title })
  );
  if (candidates.length === 0) return [];

  const recordIds = [...new Set(candidates.map((r) => r.recordId))];
  const objectIds = [...new Set(candidates.map((r) => r.objectId))];

  // 2. Resolve display names for the parent records.
  const displayMap = await batchGetRecordDisplayNames(recordIds);

  // 3. Resolve lead_source attribute IDs per object, then map record → option title.
  const leadSourceAttrRows = await db
    .select({ id: attributes.id, objectId: attributes.objectId })
    .from(attributes)
    .where(
      and(
        inArray(attributes.objectId, objectIds),
        eq(attributes.slug, "lead_source")
      )
    );
  const leadSourceAttrIdByObject = new Map(
    leadSourceAttrRows.map((r) => [r.objectId, r.id])
  );
  const leadSourceAttrIds = leadSourceAttrRows.map((r) => r.id);

  const leadSourceByRecord = new Map<string, string>();
  if (leadSourceAttrIds.length > 0) {
    const valueRows = await db
      .select({
        recordId: recordValues.recordId,
        attributeId: recordValues.attributeId,
        textValue: recordValues.textValue,
        referencedRecordId: recordValues.referencedRecordId,
      })
      .from(recordValues)
      .where(
        and(
          inArray(recordValues.recordId, recordIds),
          inArray(recordValues.attributeId, leadSourceAttrIds)
        )
      );

    // For select attributes the option ID is in textValue; resolve to title.
    const optionIds = valueRows
      .map((v) => v.textValue)
      .filter((v): v is string => Boolean(v));
    const optionTitles = new Map<string, string>();
    if (optionIds.length > 0) {
      const opts = await db
        .select({ id: selectOptions.id, title: selectOptions.title })
        .from(selectOptions)
        .where(inArray(selectOptions.id, optionIds));
      for (const o of opts) optionTitles.set(o.id, o.title);
    }
    for (const v of valueRows) {
      if (!v.textValue) continue;
      const title = optionTitles.get(v.textValue) ?? v.textValue;
      leadSourceByRecord.set(v.recordId, title);
    }
  }

  // 4. Resolve a conversation per record for the eventual approve action.
  //    Two paths because notes can hang off either a deal record (linked by
  //    inboxConversations.dealRecordId) or a people/companies record (linked
  //    via inboxContacts.crmRecordId → inboxConversations.contactId). Both
  //    queries are workspace-scoped via inboxConversations.workspaceId.
  const convByRecord = new Map<
    string,
    {
      conversationId: string;
      channelType: "email" | "whatsapp";
      contactName: string | null;
      contactAddress: string | null;
      subject: string | null;
      lastMessageAt: Date | null;
    }
  >();

  function maybeAdoptConv(
    recordId: string,
    row: {
      conversationId: string;
      channelType: "email" | "whatsapp";
      contactName: string | null;
      contactAddress: string | null;
      subject: string | null;
      lastMessageAt: Date | null;
    }
  ) {
    const existing = convByRecord.get(recordId);
    if (!existing) {
      convByRecord.set(recordId, row);
      return;
    }
    const a = row.lastMessageAt?.getTime() ?? 0;
    const b = existing.lastMessageAt?.getTime() ?? 0;
    if (a > b) convByRecord.set(recordId, row);
  }

  // 4a. Conversations linked directly via dealRecordId.
  const dealLinked = await db
    .select({
      recordId: inboxConversations.dealRecordId,
      conversationId: inboxConversations.id,
      channelType: channelAccounts.channelType,
      contactName: inboxContacts.displayName,
      contactEmail: inboxContacts.email,
      contactPhone: inboxContacts.phone,
      subject: inboxConversations.subject,
      lastMessageAt: inboxConversations.lastMessageAt,
    })
    .from(inboxConversations)
    .innerJoin(channelAccounts, eq(inboxConversations.channelAccountId, channelAccounts.id))
    .leftJoin(inboxContacts, eq(inboxConversations.contactId, inboxContacts.id))
    .where(
      and(
        eq(inboxConversations.workspaceId, workspaceId),
        isNotNull(inboxConversations.dealRecordId),
        inArray(inboxConversations.dealRecordId, recordIds)
      )
    );
  for (const row of dealLinked) {
    if (!row.recordId) continue;
    maybeAdoptConv(row.recordId, {
      conversationId: row.conversationId,
      channelType: row.channelType,
      contactName: row.contactName,
      contactAddress:
        row.channelType === "whatsapp"
          ? row.contactPhone
          : row.contactEmail,
      subject: row.subject,
      lastMessageAt: row.lastMessageAt,
    });
  }

  // 4b. Conversations linked via inboxContacts.crmRecordId (people/companies).
  const contactLinked = await db
    .select({
      recordId: inboxContacts.crmRecordId,
      conversationId: inboxConversations.id,
      channelType: channelAccounts.channelType,
      contactName: inboxContacts.displayName,
      contactEmail: inboxContacts.email,
      contactPhone: inboxContacts.phone,
      subject: inboxConversations.subject,
      lastMessageAt: inboxConversations.lastMessageAt,
    })
    .from(inboxConversations)
    .innerJoin(channelAccounts, eq(inboxConversations.channelAccountId, channelAccounts.id))
    .innerJoin(inboxContacts, eq(inboxConversations.contactId, inboxContacts.id))
    .where(
      and(
        eq(inboxConversations.workspaceId, workspaceId),
        isNotNull(inboxContacts.crmRecordId),
        inArray(inboxContacts.crmRecordId, recordIds)
      )
    );
  for (const row of contactLinked) {
    if (!row.recordId) continue;
    maybeAdoptConv(row.recordId, {
      conversationId: row.conversationId,
      channelType: row.channelType,
      contactName: row.contactName,
      contactAddress:
        row.channelType === "whatsapp"
          ? row.contactPhone
          : row.contactEmail,
      subject: row.subject,
      lastMessageAt: row.lastMessageAt,
    });
  }

  // 5. Assemble.
  return candidates.map((row) => {
    const body = extractDraftMessage(row.content);
    const conv = convByRecord.get(row.recordId) ?? null;
    const display = displayMap.get(row.recordId);
    return {
      noteId: row.noteId,
      recordId: row.recordId,
      recordDisplayName: display?.displayName || "Unbenannt",
      objectSlug: row.objectSlug,
      objectName: display?.objectName || row.objectName,
      conversationId: conv?.conversationId ?? null,
      channelType: conv?.channelType ?? null,
      contactName: conv?.contactName ?? null,
      contactAddress: conv?.contactAddress ?? null,
      subject: conv?.subject ?? null,
      leadSource: leadSourceByRecord.get(row.recordId) ?? null,
      body,
      snippet: snippetFromBody(body),
      createdAt: (row.createdAt instanceof Date
        ? row.createdAt
        : new Date(row.createdAt as unknown as string)).toISOString(),
      updatedAt: (row.updatedAt instanceof Date
        ? row.updatedAt
        : new Date(row.updatedAt as unknown as string)).toISOString(),
    };
  });
}

export interface ApproveDraftResult {
  noteId: string;
  conversationId: string;
  channelType: "email" | "whatsapp";
  sentMessageId: string;
}

export class DraftApprovalError extends Error {
  code: "NOTE_NOT_FOUND" | "ALREADY_CONSUMED" | "NO_CONVERSATION" | "EMPTY_BODY" | "WA_SESSION_EXPIRED" | "SEND_FAILED";
  status: number;
  constructor(
    code: DraftApprovalError["code"],
    message: string,
    status = 400
  ) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * Approve a draft: send the body via the existing send pipeline on the
 * resolved conversation, mark the note consumed (title rewrite — same
 * pattern the per-record banner uses), and best-effort set `first_reply_at`
 * on the parent record if the attribute exists.
 *
 * The optional `bodyOverride` lets the operator tweak the draft before
 * sending. Without it we re-extract the body from the current note content
 * (so an "Edit" save followed by approve uses the latest text).
 */
export async function approveDraft(params: {
  workspaceId: string;
  noteId: string;
  bodyOverride?: string;
}): Promise<ApproveDraftResult> {
  const { workspaceId, noteId, bodyOverride } = params;

  // 1. Load note + verify workspace membership in one query.
  const [noteRow] = await db
    .select({
      id: notes.id,
      recordId: notes.recordId,
      title: notes.title,
      content: notes.content,
      objectId: records.objectId,
    })
    .from(notes)
    .innerJoin(records, eq(notes.recordId, records.id))
    .innerJoin(objects, eq(records.objectId, objects.id))
    .where(and(eq(notes.id, noteId), eq(objects.workspaceId, workspaceId)))
    .limit(1);

  if (!noteRow) {
    throw new DraftApprovalError("NOTE_NOT_FOUND", "Note not found", 404);
  }
  if (!isAgentDraft({ title: noteRow.title })) {
    throw new DraftApprovalError(
      "ALREADY_CONSUMED",
      "Draft has already been consumed or is not a Sales-Outreach-Agent draft",
      409
    );
  }

  const body = (bodyOverride ?? extractDraftMessage(noteRow.content)).trim();
  if (!body) {
    throw new DraftApprovalError("EMPTY_BODY", "Draft body is empty");
  }

  // 2. Resolve conversation (re-uses the same lookup as listPendingDrafts).
  const conv = await resolveConversationForRecord(workspaceId, noteRow.recordId);
  if (!conv) {
    throw new DraftApprovalError(
      "NO_CONVERSATION",
      "No inbox conversation is linked to this record yet — cannot send",
      409
    );
  }

  // 3. Send via the existing pipeline.
  let sentMessageId: string;
  try {
    const stored =
      conv.channelType === "whatsapp"
        ? await sendWhatsAppReply({
            conversationId: conv.conversationId,
            workspaceId,
            body,
          })
        : await sendEmailReply({
            conversationId: conv.conversationId,
            workspaceId,
            body,
          });
    sentMessageId = stored.id;
  } catch (err) {
    if (err instanceof WhatsAppSessionExpiredError) {
      throw new DraftApprovalError(
        "WA_SESSION_EXPIRED",
        err.message,
        409
      );
    }
    throw new DraftApprovalError(
      "SEND_FAILED",
      err instanceof Error ? err.message : "Send failed",
      500
    );
  }

  // 4. Mark note consumed (best-effort: failure here would leave a "ghost"
  //    pending draft, but the message is already out so we shouldn't 500).
  try {
    await db
      .update(notes)
      .set({ title: consumedTitle(), updatedAt: new Date() })
      .where(eq(notes.id, noteId));
  } catch (err) {
    console.warn(`[agent-drafts] failed to flip title on note ${noteId}`, err);
  }

  // 5. Best-effort first_reply_at: only if the parent object has the
  //    attribute (set up later by the field-mapping work in KOT-654).
  try {
    await setFirstReplyAtIfMissing(noteRow.objectId, noteRow.recordId);
  } catch (err) {
    console.warn(
      `[agent-drafts] failed to set first_reply_at for record ${noteRow.recordId}`,
      err
    );
  }

  return {
    noteId,
    conversationId: conv.conversationId,
    channelType: conv.channelType,
    sentMessageId,
  };
}

async function resolveConversationForRecord(
  workspaceId: string,
  recordId: string
): Promise<{ conversationId: string; channelType: "email" | "whatsapp" } | null> {
  // Deal-link path.
  const dealHit = await db
    .select({
      conversationId: inboxConversations.id,
      channelType: channelAccounts.channelType,
      lastMessageAt: inboxConversations.lastMessageAt,
    })
    .from(inboxConversations)
    .innerJoin(channelAccounts, eq(inboxConversations.channelAccountId, channelAccounts.id))
    .where(
      and(
        eq(inboxConversations.workspaceId, workspaceId),
        eq(inboxConversations.dealRecordId, recordId)
      )
    )
    .orderBy(desc(inboxConversations.lastMessageAt))
    .limit(1);
  if (dealHit[0]) return dealHit[0];

  // Contact-link path (people / companies).
  const contactHit = await db
    .select({
      conversationId: inboxConversations.id,
      channelType: channelAccounts.channelType,
      lastMessageAt: inboxConversations.lastMessageAt,
    })
    .from(inboxConversations)
    .innerJoin(channelAccounts, eq(inboxConversations.channelAccountId, channelAccounts.id))
    .innerJoin(inboxContacts, eq(inboxConversations.contactId, inboxContacts.id))
    .where(
      and(
        eq(inboxConversations.workspaceId, workspaceId),
        eq(inboxContacts.crmRecordId, recordId)
      )
    )
    .orderBy(desc(inboxConversations.lastMessageAt))
    .limit(1);
  if (contactHit[0]) return contactHit[0];

  return null;
}

/**
 * Set `first_reply_at` on the record if the attribute exists on the object
 * AND the value isn't already set. Idempotent and forward-compatible: if the
 * attribute hasn't been seeded yet (KOT-654 will add it via standard-objects),
 * this is a no-op and returns silently.
 */
async function setFirstReplyAtIfMissing(
  objectId: string,
  recordId: string
): Promise<void> {
  const [attr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(
      and(eq(attributes.objectId, objectId), eq(attributes.slug, "first_reply_at"))
    )
    .limit(1);
  if (!attr) return;

  const existing = await db
    .select({ id: recordValues.id })
    .from(recordValues)
    .where(
      and(
        eq(recordValues.recordId, recordId),
        eq(recordValues.attributeId, attr.id)
      )
    )
    .limit(1);
  if (existing[0]) return;

  await db.insert(recordValues).values({
    recordId,
    attributeId: attr.id,
    timestampValue: new Date(),
  });
}

