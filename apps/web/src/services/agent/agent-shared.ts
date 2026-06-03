/**
 * Shared helpers for the sales agent workers (reply + follow-up).
 *
 * Outbound ALWAYS routes by the conversation's own channel account, so the
 * agent can never reply as the wrong brand. The agent calls the send services
 * directly (not the inbox route), so its sends do not trigger the route's
 * human-takeover auto-pause.
 */

import { db } from "@/db";
import { and, eq } from "drizzle-orm";
import { workspaceMembers } from "@/db/schema";
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
