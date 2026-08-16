/**
 * Create approval-queue drafts on behalf of external agent runners (the
 * hosted Grok Bot or the VPS `grok-inbox-agent`). Draft-only by design: this
 * module can NEVER send. The existing approve_and_send flow
 * (api/v1/agent-drafts/[id]) re-runs agentMayContact and the price filter on
 * the FINAL text inside the send transaction, so a bot-authored draft gets
 * exactly the same send-time safety as an engine-authored one.
 *
 * Queue contract (shared with captureShadowDraft): at most one live pending
 * draft per (deal, messageClass); 72h expiry; price/commitment scan stored in
 * filterVerdicts; gate snapshot stored in gateResults (informational — the
 * authoritative check happens at send time).
 */

import { createHash } from "node:crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { agentDrafts, agentEvents } from "@/db/schema/agent";
import { inboxConversations, inboxContacts, channelAccounts } from "@/db/schema/inbox";
import { objects } from "@/db/schema/objects";
import { records } from "@/db/schema/records";
import { agentMayContact, toGateMessageClass, type GateVerdict } from "./agent-gate";
import { leaksPriceOrCommitment } from "./agent-suppress";
import { ownerUserIds } from "./agent-shared";
import { DRAFT_CLASS_LABELS, HUMAN_ACTIONABLE_BLOCKS } from "./agent-shadow";
import { sendPush } from "@/services/push";

/** Message classes accepted from external runners (the drafts table's vocabulary). */
const DRAFT_CLASSES: ReadonlySet<string> = new Set([
  "reply",
  "slot_question",
  "ack",
  "followup",
  "first_contact",
  "handoff_ack",
]);

const MAX_DRAFT_TEXT_CHARS = 8000;
const DEFAULT_EXPIRY_HOURS = 72; // matches captureShadowDraft
const SOURCE_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

export interface CreateAgentDraftInput {
  workspaceId: string;
  /** Preferred: the thread this draft answers. The deal is derived from it. */
  conversationId?: string;
  /** Required when there is no conversation yet (first_contact). */
  dealRecordId?: string;
  messageClass: string;
  draftText: string;
  /** Why the runner wrote this (mode rationale) — stored for reviewers. */
  reasoning?: string;
  /** customer-texting mode: qualify | answer | quote | defend | close | follow-up | recovery | graceful-close | silence */
  mode?: string;
  /** Which runner produced this: "grok-bot" (hosted) | "grok-vps" | … */
  source?: string;
  modelTag?: string;
  /** Caller-supplied idempotency key; defaults to a content-hash key. */
  idempotencyKey?: string;
  expiresInHours?: number;
}

export type CreateAgentDraftResult =
  | {
      ok: true;
      created: boolean;
      draft: {
        id: string;
        conversationId: string | null;
        dealRecordId: string;
        messageClass: string;
        status: string;
        expiresAt: string;
        gateAllowed: boolean | null;
        gateReasons: string[];
        priceFlag: boolean;
      };
    }
  | {
      ok: false;
      status: number;
      error: string;
      message: string;
      existingDraftId?: string;
    };

export async function createAgentDraft(
  input: CreateAgentDraftInput
): Promise<CreateAgentDraftResult> {
  // ── Validation ──────────────────────────────────────────────────────────
  if (!DRAFT_CLASSES.has(input.messageClass)) {
    return {
      ok: false,
      status: 400,
      error: "invalid_message_class",
      message: `messageClass must be one of ${[...DRAFT_CLASSES].join(", ")}`,
    };
  }
  const draftText = (input.draftText ?? "").trim();
  if (!draftText) {
    return { ok: false, status: 400, error: "draft_text_empty", message: "draftText is required" };
  }
  if (draftText.length > MAX_DRAFT_TEXT_CHARS) {
    return {
      ok: false,
      status: 400,
      error: "draft_too_long",
      message: `draftText exceeds ${MAX_DRAFT_TEXT_CHARS} chars`,
    };
  }
  const source = (input.source ?? "grok-vps").trim().toLowerCase();
  if (!SOURCE_PATTERN.test(source)) {
    return {
      ok: false,
      status: 400,
      error: "invalid_source",
      message: "source must be a short lowercase slug (e.g. 'grok-bot', 'grok-vps')",
    };
  }
  const reasoning = input.reasoning?.trim() || undefined;
  const mode = input.mode?.trim() || undefined;

  // ── Resolve the conversation (source of truth for deal + channel) ───────
  let conversationId: string | null = null;
  let dealRecordId: string | null = input.dealRecordId ?? null;
  let channelAccountId: string | null = null;
  let personRecordId: string | null = null;
  let contactPhone: string | null = null;
  let contactEmail: string | null = null;

  if (input.conversationId) {
    const [conv] = await db
      .select({
        id: inboxConversations.id,
        dealRecordId: inboxConversations.dealRecordId,
        channelAccountId: inboxConversations.channelAccountId,
        contactPhone: inboxContacts.phone,
        contactEmail: inboxContacts.email,
        personRecordId: inboxContacts.crmRecordId,
      })
      .from(inboxConversations)
      .innerJoin(channelAccounts, eq(inboxConversations.channelAccountId, channelAccounts.id))
      .leftJoin(inboxContacts, eq(inboxConversations.contactId, inboxContacts.id))
      .where(
        and(
          eq(inboxConversations.id, input.conversationId),
          eq(inboxConversations.workspaceId, input.workspaceId)
        )
      )
      .limit(1);
    if (!conv) {
      return {
        ok: false,
        status: 404,
        error: "conversation_not_found",
        message: "No conversation with that id in this workspace",
      };
    }
    conversationId = conv.id;
    dealRecordId = conv.dealRecordId ?? dealRecordId;
    channelAccountId = conv.channelAccountId;
    personRecordId = conv.personRecordId;
    contactPhone = conv.contactPhone;
    contactEmail = conv.contactEmail;
  }

  if (!dealRecordId) {
    return {
      ok: false,
      status: 400,
      error: "deal_required",
      message:
        "No deal linked. Link one first (crm_link_conversation_deal) or pass dealRecordId.",
    };
  }

  // When the deal did not come through the conversation join, prove it
  // belongs to this workspace (records → objects carry the workspace).
  if (!input.conversationId) {
    const [deal] = await db
      .select({ id: records.id })
      .from(records)
      .innerJoin(
        objects,
        and(eq(objects.id, records.objectId), eq(objects.workspaceId, input.workspaceId))
      )
      .where(and(eq(records.id, dealRecordId), isNull(records.deletedAt)))
      .limit(1);
    if (!deal) {
      return {
        ok: false,
        status: 404,
        error: "deal_not_found",
        message: "No deal with that id in this workspace",
      };
    }
  }

  // ── Queue contract: one live pending draft per (deal, class) ────────────
  const [alreadyPending] = await db
    .select({ id: agentDrafts.id })
    .from(agentDrafts)
    .where(
      and(
        eq(agentDrafts.workspaceId, input.workspaceId),
        eq(agentDrafts.dealRecordId, dealRecordId),
        eq(agentDrafts.messageClass, input.messageClass),
        eq(agentDrafts.status, "pending"),
        or(isNull(agentDrafts.expiresAt), gt(agentDrafts.expiresAt, new Date()))
      )
    )
    .limit(1);
  if (alreadyPending) {
    return {
      ok: false,
      status: 409,
      error: "draft_exists",
      message: "A live pending draft already exists for this deal and message class",
      existingDraftId: alreadyPending.id,
    };
  }

  // ── Deterministic scans (informational; authoritative re-check at send) ─
  const priceFlag = leaksPriceOrCommitment(draftText);
  let gate: GateVerdict | null = null;
  try {
    gate = await agentMayContact({
      workspaceId: input.workspaceId,
      dealRecordId,
      conversationId,
      messageClass: toGateMessageClass(input.messageClass),
      personRecordId,
      phone: contactPhone,
      email: contactEmail,
    });
  } catch (err) {
    console.error("[agent-drafts] gate snapshot failed (non-blocking):", err);
  }

  // ── Insert (idempotent) ─────────────────────────────────────────────────
  const contentHash = createHash("sha1").update(draftText).digest("hex").slice(0, 16);
  const threadKey = conversationId ?? dealRecordId;
  const idempotencyKey =
    input.idempotencyKey?.trim() || `grok:${source}:${threadKey}:${contentHash}`;
  const expiryHours = Math.min(Math.max(input.expiresInHours ?? DEFAULT_EXPIRY_HOURS, 1), DEFAULT_EXPIRY_HOURS);
  const expiresAt = new Date(Date.now() + expiryHours * 3600_000);
  const promptVersion = `grok-agent:${source}`;
  const modelTag = input.modelTag?.trim() || "grok-4.6";

  const inserted = await db
    .insert(agentDrafts)
    .values({
      workspaceId: input.workspaceId,
      dealRecordId,
      conversationId,
      channelAccountId,
      messageClass: input.messageClass,
      draftText,
      filterVerdicts: {
        priceOrCommitmentLeak: priceFlag,
        scannedText: "draft",
        ...(reasoning ? { reasoning } : {}),
        ...(mode ? { mode } : {}),
      },
      gateResults: gate ? { allowed: gate.allowed, reasons: gate.reasons } : null,
      status: "pending",
      idempotencyKey,
      expiresAt,
      promptVersion,
      modelTag,
    })
    .onConflictDoNothing()
    .returning({ id: agentDrafts.id });

  // Idempotent retry: the same key already produced a draft — return it.
  if (inserted.length === 0) {
    const [existing] = await db
      .select({
        id: agentDrafts.id,
        conversationId: agentDrafts.conversationId,
        dealRecordId: agentDrafts.dealRecordId,
        messageClass: agentDrafts.messageClass,
        status: agentDrafts.status,
        expiresAt: agentDrafts.expiresAt,
      })
      .from(agentDrafts)
      .where(eq(agentDrafts.idempotencyKey, idempotencyKey))
      .limit(1);
    if (!existing) {
      return {
        ok: false,
        status: 409,
        error: "idempotency_conflict",
        message: "Idempotency key exists but the row could not be read",
      };
    }
    return {
      ok: true,
      created: false,
      draft: {
        id: existing.id,
        conversationId: existing.conversationId,
        dealRecordId: existing.dealRecordId,
        messageClass: existing.messageClass,
        status: existing.status,
        expiresAt: existing.expiresAt?.toISOString() ?? expiresAt.toISOString(),
        gateAllowed: null,
        gateReasons: [],
        priceFlag,
      },
    };
  }

  const draftId = inserted[0].id;

  // ── Forensics event (append-only log; never blocks creation) ────────────
  try {
    await db
      .insert(agentEvents)
      .values({
        workspaceId: input.workspaceId,
        dealRecordId,
        conversationId,
        engine: "grok_agent",
        eventType: "draft_created",
        promptVersion,
        modelTag,
        gateResults: gate ? { allowed: gate.allowed, reasons: gate.reasons } : null,
        payload: { draftId, messageClass: input.messageClass, source, mode: mode ?? null },
        idempotencyKey: `grok-draft-created:${draftId}`,
      })
      .onConflictDoNothing();
  } catch (err) {
    console.error("[agent-drafts] event insert failed (non-blocking):", err);
  }

  // ── Owner push, same semantics as the shadow drafts (best effort) ───────
  try {
    const pushable =
      gate != null && (gate.allowed || gate.reasons.every((r) => HUMAN_ACTIONABLE_BLOCKS.has(r)));
    if (pushable) {
      const owners = await ownerUserIds(input.workspaceId);
      if (owners.length > 0) {
        const gateClass = toGateMessageClass(input.messageClass);
        await sendPush(
          {
            title: `KI-Entwurf: ${DRAFT_CLASS_LABELS[gateClass] ?? "Entwurf"}`,
            body: draftText.slice(0, 80),
            url: conversationId ? `/inbox?conversationId=${conversationId}` : "/inbox",
            tag: `agent-draft-${draftId}`,
          },
          { workspaceId: input.workspaceId, userIds: owners }
        );
      }
    }
  } catch (err) {
    console.error("[agent-drafts] draft push failed (non-blocking):", err);
  }

  return {
    ok: true,
    created: true,
    draft: {
      id: draftId,
      conversationId,
      dealRecordId,
      messageClass: input.messageClass,
      status: "pending",
      expiresAt: expiresAt.toISOString(),
      gateAllowed: gate?.allowed ?? null,
      gateReasons: gate?.reasons ?? [],
      priceFlag,
    },
  };
}
