/**
 * Per-conversation flagging (stage + priority + missing info) for the inbox.
 *
 * Fully DETERMINISTIC (no LLM cost), so it can run across the whole inbox
 * cheaply. Reuses what already exists: the deal's move_date, the latest
 * deal-insights criticalMissing, and who wrote last. Result is cached on
 * inbox_conversations.agent_state and rendered as badges.
 */

import { db } from "@/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { inboxConversations, inboxMessages } from "@/db/schema/inbox";
import type {
  AgentConversationState,
  AgentStage,
  AgentPriority,
} from "@/db/schema/inbox";
import { activityEvents } from "@/db/schema";
import { getObjectBySlug } from "@/services/objects";
import { getRecord } from "@/services/records";
import { looksDeclined, isMoveDatePast } from "./agent-shared";

const URGENCY = /(dringend|kurzfristig|schnellstmöglich|asap|diese woche|nächste woche|sofort|eilt|so schnell wie möglich)/i;
const MAX_CLASSIFY_PER_TICK = 60;

const MISSING_LABELS: Record<string, string> = {
  move_date: "Termin",
  move_from_address: "Auszugsadresse",
  move_to_address: "Einzugsadresse",
  floors_from: "Etage",
  floors_to: "Etage",
  elevator_from: "Aufzug",
  elevator_to: "Aufzug",
  volume_cbm: "Volumen",
  inventory_notes: "Inventar",
  customer_phone: "Telefon",
  customer_email: "E-Mail",
};

export interface ClassifyInput {
  lastDirection: "inbound" | "outbound" | null;
  lastCustomerText: string | null;
  recentText: string;
  moveDate: Date | null;
  movePast: boolean;
  criticalMissing: Array<{ field: string; question: string }>;
  now: Date;
}

export function computeConversationFlags(input: ClassifyInput): AgentConversationState {
  const declined = looksDeclined(input.lastCustomerText) || looksDeclined(input.recentText.slice(-400));
  const customerWroteLast = input.lastDirection === "inbound";

  const missingSet = new Set<string>();
  for (const c of input.criticalMissing) {
    missingSet.add(MISSING_LABELS[c.field] || (c.field ? c.field : "Infos"));
  }
  const missing = [...missingSet].slice(0, 4);

  // Stage
  let stage: AgentStage;
  if (declined) stage = "verloren";
  else if (input.criticalMissing.length === 0 && customerWroteLast) stage = "bereit_kalkulieren";
  else if (input.criticalMissing.length === 0) stage = "bereit_kalkulieren";
  else if (input.lastDirection === "outbound") stage = "wartet_kunde";
  else if (input.lastDirection === "inbound") stage = "sammelt_infos";
  else stage = "neu";

  // Priority
  let priority: AgentPriority = "mittel";
  if (declined || input.movePast) {
    priority = "niedrig";
  } else if (input.moveDate) {
    const days = Math.floor((input.moveDate.getTime() - input.now.getTime()) / 86_400_000);
    priority = days <= 7 ? "hoch" : days <= 21 ? "mittel" : "niedrig";
  }
  if (!declined && !input.movePast && URGENCY.test(input.recentText)) priority = "hoch";

  // Eligibility for auto-answer (a hint; the worker re-checks freshness etc.)
  const eligible = !declined && !input.movePast && customerWroteLast;
  let ineligibleReason: string | undefined;
  if (input.movePast) ineligibleReason = "Termin vorbei";
  else if (declined) ineligibleReason = "Abgesagt";
  else if (!customerWroteLast) ineligibleReason = "Wir am Zug";

  const nextAction =
    stage === "bereit_kalkulieren"
      ? "Angebot kalkulieren"
      : stage === "wartet_kunde"
        ? "Auf Antwort warten"
        : stage === "sammelt_infos"
          ? "Infos sammeln"
          : stage === "verloren"
            ? "Geschlossen"
            : "Anfrage prüfen";

  return {
    stage,
    priority,
    missing,
    eligible,
    ineligibleReason,
    nextAction,
    classifiedAt: input.now.toISOString(),
  };
}

async function latestCriticalMissing(
  workspaceId: string,
  dealRecordId: string
): Promise<Array<{ field: string; question: string }>> {
  const [latest] = await db
    .select({ payload: activityEvents.payload })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.workspaceId, workspaceId),
        eq(activityEvents.recordId, dealRecordId),
        eq(activityEvents.eventType, "ai.insights_extracted")
      )
    )
    .orderBy(desc(activityEvents.createdAt))
    .limit(1);
  const p = (latest?.payload ?? {}) as Record<string, unknown>;
  return Array.isArray(p.criticalMissing)
    ? (p.criticalMissing as Array<{ field?: string; question?: string }>).map((c) => ({
        field: typeof c.field === "string" ? c.field : "",
        question: typeof c.question === "string" ? c.question : "",
      }))
    : [];
}

async function classifyOne(
  workspaceId: string,
  conv: { id: string; dealRecordId: string | null },
  dealsObjId: string | null,
  now: Date
): Promise<void> {
  const msgs = await db
    .select({ direction: inboxMessages.direction, body: inboxMessages.body })
    .from(inboxMessages)
    .where(eq(inboxMessages.conversationId, conv.id))
    .orderBy(desc(inboxMessages.sentAt), desc(inboxMessages.createdAt))
    .limit(8);
  const lastDirection = (msgs[0]?.direction as "inbound" | "outbound" | undefined) ?? null;
  const lastCustomerText = msgs.find((m) => m.direction === "inbound")?.body ?? null;
  const recentText = msgs.map((m) => m.body ?? "").join(" \n ");

  let moveDate: Date | null = null;
  let movePast = false;
  let criticalMissing: Array<{ field: string; question: string }> = [];
  if (dealsObjId && conv.dealRecordId) {
    const deal = await getRecord(dealsObjId, conv.dealRecordId);
    const mv = (deal?.values as Record<string, unknown> | undefined)?.move_date;
    if (mv) {
      const d = new Date(mv as string | number | Date);
      if (!Number.isNaN(d.getTime())) moveDate = d;
    }
    movePast = isMoveDatePast(deal);
    criticalMissing = await latestCriticalMissing(workspaceId, conv.dealRecordId);
  }

  const flags = computeConversationFlags({
    lastDirection,
    lastCustomerText,
    recentText,
    moveDate,
    movePast,
    criticalMissing,
    now,
  });

  await db
    .update(inboxConversations)
    .set({ agentState: flags, updatedAt: new Date() })
    .where(eq(inboxConversations.id, conv.id));
}

export interface ClassifyRunSummary {
  workspaces: number;
  classified: number;
  errors: number;
}

/** Cron entry: (re)classify open lead conversations that changed since last classify. */
export async function runAgentClassify(): Promise<ClassifyRunSummary> {
  const now = new Date();
  const summary: ClassifyRunSummary = { workspaces: 0, classified: 0, errors: 0 };

  const wsRows = (await db.execute<{ id: string }>(
    sql`SELECT id FROM workspaces`
  )) as unknown as Array<{ id: string }>;
  summary.workspaces = wsRows.length;

  for (const w of wsRows) {
    const dealsObj = await getObjectBySlug(w.id, "deals");
    const dealsObjId = dealsObj?.id ?? null;

    // Open lead conversations never classified, or changed since last classify.
    const due = await db
      .select({ id: inboxConversations.id, dealRecordId: inboxConversations.dealRecordId })
      .from(inboxConversations)
      .where(
        and(
          eq(inboxConversations.workspaceId, w.id),
          eq(inboxConversations.lane, "lead"),
          eq(inboxConversations.status, "open"),
          // Never classified, or the thread changed since the last classify.
          sql`(${inboxConversations.agentState} IS NULL
               OR (${inboxConversations.agentState}->>'classifiedAt') IS NULL
               OR (${inboxConversations.agentState}->>'classifiedAt')::timestamptz < ${inboxConversations.lastMessageAt})`
        )
      )
      .orderBy(desc(inboxConversations.lastMessageAt))
      .limit(MAX_CLASSIFY_PER_TICK);

    for (const conv of due) {
      try {
        await classifyOne(w.id, conv, dealsObjId, now);
        summary.classified += 1;
      } catch (err) {
        console.error("[agent-classify] failed for", conv.id, err);
        summary.errors += 1;
      }
    }
  }

  return summary;
}
