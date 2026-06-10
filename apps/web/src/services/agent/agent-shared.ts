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
import { getSetting } from "@/services/workspace-settings";

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

/**
 * Resolve the brand signature for a conversation by its channel's operating
 * company, so a Ceylan thread never signs as Kottke. Priority:
 *   1. per-company override setting `sales_agent_signature:<ocId>`,
 *   2. the operating company's own name (hyphens/underscores cleaned),
 *   3. the workspace-wide fallback signature.
 */
export async function resolveBrandSignature(
  workspaceId: string,
  operatingCompanyRecordId: string | null,
  fallback: string
): Promise<string> {
  if (!operatingCompanyRecordId) return fallback;
  const override = await getSetting(workspaceId, `sales_agent_signature:${operatingCompanyRecordId}`);
  if (override && override.trim()) return override.trim();
  try {
    const rows = (await db.execute(
      sql`SELECT rv.text_value AS name
          FROM record_values rv
          JOIN attributes a ON a.id = rv.attribute_id
          WHERE rv.record_id = ${operatingCompanyRecordId} AND a.slug = 'name'
          LIMIT 1`
    )) as unknown as Array<{ name: string | null }>;
    const name = rows?.[0]?.name;
    if (name && name.trim()) {
      return name.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
    }
  } catch {
    // fall through to fallback
  }
  return fallback;
}

/**
 * Deterministic pre-answer eligibility checks ("logical approach before it
 * answers"). These run BEFORE the LLM so the agent can never text a dead or
 * past-date thread, regardless of what the model decides.
 */

/** True only if the deal's move_date is a real date in the past. Unknown/unparseable -> false. */
export function isMoveDatePast(
  record: { values?: Record<string, unknown> } | null | undefined
): boolean {
  const mv = record?.values?.move_date;
  if (!mv) return false;
  const d = new Date(mv as string | number | Date);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d.getTime() < today.getTime();
}

// Conservative: only clear, unambiguous declines, to avoid silencing real leads.
// Includes opt-out keywords (STOP etc.): an advertising objection under Art. 21
// DSGVO / §7 UWG is absolute, so the agent must fall silent immediately.
const DECLINE_PATTERNS =
  /(kein interesse|zu teuer|doch nicht|anderweitig|anderen anbieter|bereits (beauftragt|gebucht|vergeben|organisiert)|schon (beauftragt|gebucht|jemanden)|abgesagt|hat sich erledigt|erledigt sich|brauche (keine|nichts|nicht mehr)|nicht mehr (nötig|notwendig|relevant|aktuell|gebraucht)|keine (weiteren )?nachrichten|nicht mehr (schreiben|kontaktieren)|^\s*stopp?\s*[.!]?\s*$|abbestellen|abmelden)/i;

/** Heuristic safety net: does the customer's last message clearly decline? */
export function looksDeclined(text: string | null | undefined): boolean {
  if (!text) return false;
  return DECLINE_PATTERNS.test(text);
}

/** Prepend the AI disclosure when this is the agent's first customer message. */
export function withDisclosure(message: string, disclosure: string, isFirst: boolean): string {
  const d = disclosure.trim();
  if (!isFirst || !d || !message.trim()) return message;
  return `${d}\n\n${message}`;
}
