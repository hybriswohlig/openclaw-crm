/**
 * Shared helpers for the sales agent workers (reply + follow-up).
 *
 * Outbound ALWAYS routes by the conversation's own channel account, so the
 * agent can never reply as the wrong brand. The agent calls the send services
 * directly (not the inbox route), so its sends do not trigger the route's
 * human-takeover auto-pause.
 */

import { db } from "@/db";
import { and, eq, sql } from "drizzle-orm";
import { workspaceMembers, activityEvents } from "@/db/schema";
import { sendWhatsAppReply, sendBaileysReply } from "@/services/inbox-whatsapp";
import { sendEmailReply } from "@/services/inbox-email";

export interface AgentChannelRow {
  id: string;
  workspaceId: string;
  channelType: string;
  waPhoneNumberId: string | null;
  baileysBridgeProvider: string | null;
}

export async function sendOnChannel(row: AgentChannelRow, body: string): Promise<void> {
  if (row.channelType === "whatsapp") {
    if (row.waPhoneNumberId) {
      await sendWhatsAppReply({ conversationId: row.id, workspaceId: row.workspaceId, body });
      return;
    }
    if (row.baileysBridgeProvider === "inhouse") {
      await sendBaileysReply({ conversationId: row.id, workspaceId: row.workspaceId, body });
      return;
    }
    throw new Error("WhatsApp channel is receive-only (OpenClaw); cannot auto-send.");
  }
  // email + kleinanzeigen (KA rides on the email transport)
  await sendEmailReply({ conversationId: row.id, workspaceId: row.workspaceId, body });
}

export function appendSignature(message: string, signature: string): string {
  const trimmed = message.trim();
  if (!trimmed) return trimmed;
  if (trimmed.toLowerCase().includes(signature.toLowerCase())) return trimmed;
  return `${trimmed}\n${signature}`;
}

export async function ownerUserIds(workspaceId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, "admin"))
    );
  return rows.map((r) => r.userId);
}

/**
 * Has the agent already sent a customer-facing message on this deal? Used to
 * decide whether to prepend the legally-required AI disclosure (only on the
 * agent's FIRST customer message). Derived from the agent.action timeline events
 * (mode "live" with a non-empty message), so it needs no extra column. Returns
 * false when the deal is unknown, so the disclosure is included (fail-safe).
 */
export async function agentHasSentCustomerMessage(
  workspaceId: string,
  dealRecordId: string | null
): Promise<boolean> {
  if (!dealRecordId) return false;
  const rows = await db
    .select({ payload: activityEvents.payload })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.workspaceId, workspaceId),
        eq(activityEvents.recordId, dealRecordId),
        eq(activityEvents.eventType, "agent.action")
      )
    )
    .orderBy(sql`${activityEvents.createdAt} DESC`)
    .limit(25);
  return rows.some((r) => {
    const p = (r.payload ?? {}) as Record<string, unknown>;
    return p.mode === "live" && typeof p.message === "string" && p.message.trim().length > 0;
  });
}

/** Prepend the AI disclosure when this is the agent's first customer message. */
export function withDisclosure(message: string, disclosure: string, isFirst: boolean): string {
  const d = disclosure.trim();
  if (!isFirst || !d || !message.trim()) return message;
  return `${d}\n\n${message}`;
}
