/**
 * Close agent drafts without sending them.
 *
 * A manual reply (inbox composer or Baileys first-contact) must retire every
 * still-pending draft on that conversation or deal. Otherwise a later
 * approve_and_send would deliver a second, stale message.
 */
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { agentDrafts } from "@/db/schema/agent";
import { decideDraftClose, parseCloseAction } from "./draft-freigabe";

export interface CloseDraftResult {
  updated: boolean;
  status?: string;
  /** True when the draft was already closed and this call changed nothing. */
  idempotent?: boolean;
}

function verdictPatch(patch: Record<string, unknown>): SQL {
  return sql`coalesce(${agentDrafts.filterVerdicts}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`;
}

/**
 * Pending drafts for this conversation and/or deal become 'superseded'.
 * Idempotent: a second call matches nothing. Returns how many rows moved.
 */
export async function supersedePendingDrafts(input: {
  workspaceId: string;
  conversationId?: string | null;
  dealRecordId?: string | null;
  userId?: string | null;
  /** Why they were closed: manual_send | human_owned */
  supersededBy?: string;
}): Promise<number> {
  const parts: SQL[] = [];
  if (input.conversationId) parts.push(eq(agentDrafts.conversationId, input.conversationId));
  if (input.dealRecordId) parts.push(eq(agentDrafts.dealRecordId, input.dealRecordId));
  if (parts.length === 0) return 0;
  const scope = parts.length === 1 ? parts[0]! : or(...parts)!;

  const now = new Date();
  const updated = await db
    .update(agentDrafts)
    .set({
      status: "superseded",
      reviewerUserId: input.userId ?? null,
      reviewedAt: now,
      updatedAt: now,
      filterVerdicts: verdictPatch({
        supersededBy: input.supersededBy ?? "manual_send",
        supersededAt: now.toISOString(),
      }),
    })
    .where(
      and(
        eq(agentDrafts.workspaceId, input.workspaceId),
        eq(agentDrafts.status, "pending"),
        scope
      )
    )
    .returning({ id: agentDrafts.id });
  return updated.length;
}

/**
 * PATCH action dismiss / mark_taken / mark_sent_manually / taken.
 * Does not send. Idempotent on an already closed draft (updated: true).
 */
export async function closeDraftWithoutSending(input: {
  workspaceId: string;
  draftId: string;
  userId: string | null;
  action: string;
}): Promise<CloseDraftResult> {
  const plan = parseCloseAction(input.action);
  if (!plan) return { updated: false };

  const load = async () => {
    const [row] = await db
      .select({ status: agentDrafts.status })
      .from(agentDrafts)
      .where(and(eq(agentDrafts.id, input.draftId), eq(agentDrafts.workspaceId, input.workspaceId)))
      .limit(1);
    return row ?? null;
  };

  const row = await load();
  if (!row) return { updated: false };

  const decision = decideDraftClose(plan, row.status);
  if (decision.kind === "idempotent") {
    return { updated: true, status: row.status, idempotent: true };
  }
  if (decision.kind === "noop") {
    return { updated: false, status: row.status };
  }

  const now = new Date();
  const updated = await db
    .update(agentDrafts)
    .set({
      status: decision.status,
      reviewerUserId: input.userId,
      reviewedAt: now,
      updatedAt: now,
      ...(decision.status === "superseded"
        ? {
            filterVerdicts: verdictPatch({
              supersededBy: plan.action,
              supersededAt: now.toISOString(),
            }),
          }
        : {}),
    })
    .where(
      and(
        eq(agentDrafts.id, input.draftId),
        eq(agentDrafts.workspaceId, input.workspaceId),
        inArray(agentDrafts.status, [...plan.from])
      )
    )
    .returning({ id: agentDrafts.id });

  if (updated.length > 0) return { updated: true, status: decision.status };

  // Lost the race: someone else closed it. Treat a terminal row as success.
  const again = await load();
  if (!again) return { updated: false };
  const retry = decideDraftClose(plan, again.status);
  if (retry.kind === "idempotent") {
    return { updated: true, status: again.status, idempotent: true };
  }
  return { updated: false, status: again.status };
}
