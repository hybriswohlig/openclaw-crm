/**
 * Sales agent reply worker (CRM-native, the core of the on/off assistant).
 *
 * Consumes the AI control columns that ingest already writes on every inbound
 * message (inbox_conversations.aiNeedsReply / aiPaused / aiHoldUntil /
 * aiQuietWindowSeconds / aiLastInboundAt). For each DUE lead conversation it
 * runs ONE structured German turn and then, per the owner's decisions
 * (2026-06-03):
 *   - action "ask"     -> AUTO-SEND a short info-gathering question.
 *   - action "handoff" -> never sends a price/offer; pushes the owner and pauses
 *                         the agent on that thread (the owner sets the price).
 *   - action "no_op"   -> clears the flag, sends nothing.
 *
 * Safety: the whole thing only runs when the workspace master switch is ON
 * (default OFF). When dry-run is ON (default), it decides and records a visible
 * timeline preview but never sends, pushes, or pauses. Channel allow-list +
 * lane=="lead" + per-conversation aiPaused all gate it. Outbound always routes
 * by the conversation's own channel account, so it can never reply as the wrong
 * brand.
 */

import { db } from "@/db";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  inboxConversations,
  inboxMessages,
  inboxMessageAttachments,
  channelAccounts,
} from "@/db/schema/inbox";
import { activityEvents } from "@/db/schema";
import { z } from "zod";
import { runAITask, humanizeGerman } from "@/services/ai/run-task";
import { AI_TASK_SLUGS } from "@/services/ai/task-registry";
import { sendPush } from "@/services/push";
import { emitEvent } from "@/services/activity-events";
import { extractDealInsights } from "@/services/deal-insights";
import { applyDealInsights } from "@/services/deal-insights-apply";
import {
  isSalesAgentEnabled,
  isSalesAgentDryRun,
  getAgentChannels,
  getAgentSignature,
  getAgentDisclosure,
  getAgentHandoffAck,
} from "./agent-config";
import {
  sendOnChannel,
  appendSignature,
  ownerUserIds,
  agentHasSentCustomerMessage,
  withDisclosure,
} from "./agent-shared";

const MAX_CONVERSATIONS_PER_TICK = 8;
// Cap the slow crm-tools vision extraction per tick (30 to 90s each).
const MAX_VISION_EXTRACTIONS_PER_TICK = 3;
const MAX_TRANSCRIPT_MESSAGES = 30;

export interface AgentRunSummary {
  workspaces: number;
  enabledWorkspaces: number;
  due: number;
  processed: number;
  sent: number;
  handoffs: number;
  noops: number;
  dryRunPreviews: number;
  errors: number;
}

const AgentTurnSchema = z.object({
  action: z.enum(["ask", "handoff", "no_op"]).default("no_op"),
  // The customer-facing German message. Only sent when action === "ask".
  message_de: z.string().default(""),
  // Internal note for the owner (shown on handoff). Never sent to the customer.
  owner_note: z.string().default(""),
  reason: z.string().default(""),
});

type AgentTurn = z.infer<typeof AgentTurnSchema>;

const SYSTEM_PROMPT = `Du bist Mitarbeiter im Vertrieb eines Umzugsunternehmens (kein Chatbot). Du schreibst per WhatsApp, E-Mail oder Kleinanzeigen mit einem Interessenten, der einen Umzug anfragt.

STIL
- Deutsch, Sie-Form, kurz, freundlich, sachlich-warm. Schreibt natürlich und persönlich, nicht maschinell.
- Keine Gedankenstriche (keine "-" als Satzzeichen), keine Bot-Floskeln, keine Emojis-Flut. Erfinde KEINEN menschlichen Namen und gib dich nicht als bestimmte Person aus. Wenn der Kunde fragt, ob er mit einem Menschen oder einer KI schreibt, antworte ehrlich (KI-Assistent, ein Mitarbeiter übernimmt für das Angebot). Die nötige KI-Kennzeichnung wird separat ergänzt.
- Frage in EINER Nachricht nur die 1 bis 3 wichtigsten noch fehlenden Punkte ab, nicht alles auf einmal (zu viele Fragen schrecken ab).
- Wenn Umfang/Volumen unklar ist, bitte freundlich um 5 bis 10 Fotos der Möbel und Räume.

DEINE AUFGABE: die nötigen Infos für ein Festpreisangebot sammeln. Pflichtangaben:
- genaue Auszugs- und Einzugsadresse (Ort, Stockwerk, Aufzug ja/nein)
- Wunschtermin oder Zeitraum
- Wohnungsgröße (Zimmer oder qm) und grobe Möbelliste / Kartonzahl
- Besonderheiten (Klavier, schwere/empfindliche Möbel, Einbauschränke, Entsorgung, Halteverbot)

HARTE REGELN
- NENNE NIEMALS EINEN PREIS und mache KEIN Angebot. Du sammelst nur Infos. Den Preis macht ein Mensch.
- Wenn der Kunde nach Preis, Angebot oder einer verbindlichen Buchung fragt, ODER wenn alle Pflichtangaben vorliegen, ODER wenn die Lage einen Menschen braucht (Beschwerde, Sonderfall, Verhandlung): setze action = "handoff". Sende dann KEINE Nachricht mit Preis, schreibe stattdessen eine kurze interne Notiz in owner_note (was vorliegt, was der Kunde will).
- Wenn noch Pflichtangaben fehlen und der Kunde im Gespräch ist: action = "ask" und schreibe in message_de genau EINE kurze Nachricht, die die wichtigsten fehlenden Punkte erfragt.
- Wenn nichts zu tun ist (z.B. reines "Danke", Smalltalk, oder die Nachricht ist kein echter Lead): action = "no_op".

AUSGABE: NUR ein JSON-Objekt mit { action, message_de, owner_note, reason }. message_de ist die fertige Kundennachricht (nur bei action=ask), inklusive einer kurzen Grußzeile am Ende. Erfinde KEINEN persönlichen Namen; die Signatur wird separat angehängt.`;

interface DueConversation {
  id: string;
  workspaceId: string;
  dealRecordId: string | null;
  aiLastInboundAt: Date | null;
  aiQuietWindowSeconds: number;
  channelType: string;
  waPhoneNumberId: string | null;
  baileysBridgeProvider: string | null;
}

async function selectDueConversations(
  workspaceId: string,
  allowedChannels: string[],
  now: Date
): Promise<DueConversation[]> {
  const rows = await db
    .select({
      id: inboxConversations.id,
      workspaceId: inboxConversations.workspaceId,
      dealRecordId: inboxConversations.dealRecordId,
      aiLastInboundAt: inboxConversations.aiLastInboundAt,
      aiQuietWindowSeconds: inboxConversations.aiQuietWindowSeconds,
      channelType: channelAccounts.channelType,
      waPhoneNumberId: channelAccounts.waPhoneNumberId,
      baileysBridgeProvider: channelAccounts.baileysBridgeProvider,
    })
    .from(inboxConversations)
    .innerJoin(channelAccounts, eq(inboxConversations.channelAccountId, channelAccounts.id))
    .where(
      and(
        eq(inboxConversations.workspaceId, workspaceId),
        eq(inboxConversations.aiNeedsReply, true),
        eq(inboxConversations.aiPaused, false),
        eq(inboxConversations.lane, "lead"),
        or(isNull(inboxConversations.aiHoldUntil), lte(inboxConversations.aiHoldUntil, now)),
      )
    )
    .orderBy(asc(inboxConversations.aiLastInboundAt))
    .limit(MAX_CONVERSATIONS_PER_TICK * 4);

  const allowed = new Set(allowedChannels);
  // Debounce in JS: skip conversations still inside their quiet window so we wait
  // for a multi-message burst to settle before replying. Also enforce the
  // channel allow-list here (avoids enum/string[] typing friction in SQL).
  const due = rows.filter((r) => {
    if (!allowed.has(r.channelType)) return false;
    if (!r.aiLastInboundAt) return true;
    const elapsedMs = now.getTime() - r.aiLastInboundAt.getTime();
    return elapsedMs >= (r.aiQuietWindowSeconds ?? 160) * 1000;
  });
  return due.slice(0, MAX_CONVERSATIONS_PER_TICK) as DueConversation[];
}

interface RecentMessage {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  aiProcessedAt: Date | null;
  sentAt: Date | null;
}

async function loadRecentMessages(conversationId: string): Promise<RecentMessage[]> {
  const rows = await db
    .select({
      id: inboxMessages.id,
      direction: inboxMessages.direction,
      body: inboxMessages.body,
      aiProcessedAt: inboxMessages.aiProcessedAt,
      sentAt: inboxMessages.sentAt,
      createdAt: inboxMessages.createdAt,
    })
    .from(inboxMessages)
    .where(eq(inboxMessages.conversationId, conversationId))
    .orderBy(asc(inboxMessages.sentAt), asc(inboxMessages.createdAt))
    .limit(200);
  return rows.slice(-MAX_TRANSCRIPT_MESSAGES) as RecentMessage[];
}

function formatTranscript(messages: RecentMessage[]): string {
  return messages
    .map((m) => `${m.direction === "inbound" ? "Kunde" : "Wir"}: ${(m.body ?? "").trim()}`)
    .filter((l) => l.length > 7)
    .join("\n");
}

async function hasUnprocessedInboundImages(
  conversationId: string,
  unprocessedIds: string[]
): Promise<boolean> {
  if (unprocessedIds.length === 0) return false;
  const [row] = await db
    .select({ id: inboxMessageAttachments.id })
    .from(inboxMessageAttachments)
    .where(
      and(
        inArray(inboxMessageAttachments.messageId, unprocessedIds),
        sql`${inboxMessageAttachments.mimeType} LIKE 'image/%'`
      )
    )
    .limit(1);
  return Boolean(row);
}

interface InsightsContext {
  summary: string;
  criticalMissing: Array<{ field: string; question: string }>;
  openCustomerQuestions: string[];
}

async function readLatestInsights(
  workspaceId: string,
  dealRecordId: string
): Promise<InsightsContext | null> {
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
    .orderBy(sql`${activityEvents.createdAt} DESC`)
    .limit(1);
  if (!latest) return null;
  const p = (latest.payload ?? {}) as Record<string, unknown>;
  return {
    summary: typeof p.summary === "string" ? p.summary : "",
    criticalMissing: Array.isArray(p.criticalMissing)
      ? (p.criticalMissing as Array<{ field?: string; question?: string }>).map((c) => ({
          field: typeof c.field === "string" ? c.field : "",
          question: typeof c.question === "string" ? c.question : "",
        }))
      : [],
    openCustomerQuestions: Array.isArray(p.openCustomerQuestions)
      ? (p.openCustomerQuestions as unknown[]).filter((x): x is string => typeof x === "string")
      : [],
  };
}

function buildTurnPrompt(transcript: string, insights: InsightsContext | null): string {
  const parts: string[] = [];
  parts.push("# Gesprächsverlauf\n" + (transcript || "(noch keine Nachrichten)"));
  if (insights) {
    if (insights.summary) parts.push("# Bisheriger Stand\n" + insights.summary);
    if (insights.criticalMissing.length > 0) {
      parts.push(
        "# Noch kritisch fehlende Angaben\n" +
          insights.criticalMissing
            .map((c) => `- ${c.field || "?"}: ${c.question || ""}`)
            .join("\n")
      );
    }
    if (insights.openCustomerQuestions.length > 0) {
      parts.push(
        "# Offene Fragen des Kunden (bitte beantworten, aber keinen Preis nennen)\n" +
          insights.openCustomerQuestions.map((q) => `- ${q}`).join("\n")
      );
    }
  }
  parts.push(
    "Entscheide die nächste Aktion (ask / handoff / no_op) und liefere das JSON."
  );
  return parts.join("\n\n");
}

async function runTurn(
  workspaceId: string,
  prompt: string
): Promise<AgentTurn | null> {
  const result = await runAITask({
    workspaceId,
    taskSlug: AI_TASK_SLUGS.LEAD_ASSISTANT_REPLY,
    system: SYSTEM_PROMPT,
    prompt,
    schema: AgentTurnSchema,
  });
  if (!result.ok) {
    console.error("[agent-worker] turn failed:", result.error);
    return null;
  }
  return result.output;
}

async function stampInboundProcessed(conversationId: string, now: Date): Promise<void> {
  await db
    .update(inboxMessages)
    .set({ aiProcessedAt: now })
    .where(
      and(
        eq(inboxMessages.conversationId, conversationId),
        eq(inboxMessages.direction, "inbound"),
        isNull(inboxMessages.aiProcessedAt)
      )
    );
}

async function clearNeedsReply(conversationId: string, pause: boolean): Promise<void> {
  await db
    .update(inboxConversations)
    .set({ aiNeedsReply: false, ...(pause ? { aiPaused: true } : {}), updatedAt: new Date() })
    .where(eq(inboxConversations.id, conversationId));
}

async function emitAgentEvent(
  conv: DueConversation,
  mode: "live" | "dry_run",
  turn: AgentTurn,
  sentMessage: string
): Promise<void> {
  if (!conv.dealRecordId) return;
  await emitEvent({
    workspaceId: conv.workspaceId,
    recordId: conv.dealRecordId,
    objectSlug: "deals",
    eventType: "agent.action",
    payload: {
      mode,
      action: turn.action,
      channel: conv.channelType,
      message: sentMessage,
      ownerNote: turn.owner_note,
      reason: turn.reason,
    },
    actorId: null,
  });
}

async function processConversation(
  conv: DueConversation,
  opts: {
    dryRun: boolean;
    signature: string;
    disclosure: string;
    handoffAck: string;
    visionBudget: { left: number };
  },
  now: Date,
  summary: AgentRunSummary
): Promise<void> {
  const messages = await loadRecentMessages(conv.id);
  const unprocessedInbound = messages.filter(
    (m) => m.direction === "inbound" && !m.aiProcessedAt
  );

  if (unprocessedInbound.length === 0) {
    // Flag set but nothing new to answer; disarm so we don't spin on it.
    if (!opts.dryRun) await clearNeedsReply(conv.id, false);
    return;
  }

  // Fold any newly received customer photos into the structured slots first,
  // using the existing extraction brain (it reads images via the VPS crm-tools
  // provider). Bounded per tick because that call is slow.
  let insights: InsightsContext | null = null;
  if (conv.dealRecordId && opts.visionBudget.left > 0) {
    const hasImages = await hasUnprocessedInboundImages(
      conv.id,
      unprocessedInbound.map((m) => m.id)
    );
    if (hasImages) {
      opts.visionBudget.left -= 1;
      try {
        const res = await extractDealInsights(conv.workspaceId, conv.dealRecordId);
        if (res.insights) {
          await applyDealInsights({
            workspaceId: conv.workspaceId,
            dealRecordId: conv.dealRecordId,
            insights: res.insights,
            appliedBy: null,
            applyStage: false,
            applyNote: false,
            onlyFillEmpty: true,
          });
          insights = {
            summary: res.insights.summary ?? "",
            criticalMissing: res.insights.criticalMissing ?? [],
            openCustomerQuestions: res.insights.openCustomerQuestions ?? [],
          };
        }
      } catch (err) {
        console.error("[agent-worker] vision extraction failed (non-blocking):", err);
      }
    }
  }
  if (!insights && conv.dealRecordId) {
    insights = await readLatestInsights(conv.workspaceId, conv.dealRecordId);
  }

  const transcript = formatTranscript(messages);
  const turn = await runTurn(conv.workspaceId, buildTurnPrompt(transcript, insights));
  if (!turn) {
    summary.errors += 1;
    return;
  }

  // Is this the agent's first customer-facing message on this deal? If so, the
  // outgoing message gets the required AI disclosure prepended (deterministic,
  // so the model can never skip it).
  const isFirst = !(await agentHasSentCustomerMessage(conv.workspaceId, conv.dealRecordId));

  // Build the customer-facing message for this action (empty = send nothing).
  // Both the gather question and the handoff acknowledgment go through the
  // humanizer, then the signature, then the first-message disclosure.
  let outgoing = "";
  if (turn.action === "ask" && turn.message_de.trim()) {
    const humanized = await humanizeGerman(turn.message_de);
    outgoing = withDisclosure(appendSignature(humanized, opts.signature), opts.disclosure, isFirst);
  } else if (turn.action === "handoff" && opts.handoffAck.trim()) {
    const humanizedAck = await humanizeGerman(opts.handoffAck);
    outgoing = withDisclosure(appendSignature(humanizedAck, opts.signature), opts.disclosure, isFirst);
  }

  if (opts.dryRun) {
    // Decide and record a visible preview, but never send/push/pause.
    await emitAgentEvent(conv, "dry_run", turn, outgoing || turn.owner_note || turn.message_de);
    await stampInboundProcessed(conv.id, now);
    await clearNeedsReply(conv.id, false);
    summary.dryRunPreviews += 1;
    return;
  }

  // Live mode.
  if (turn.action === "ask") {
    if (!outgoing) {
      await stampInboundProcessed(conv.id, now);
      await clearNeedsReply(conv.id, false);
      summary.noops += 1;
      return;
    }
    try {
      await sendOnChannel(conv, outgoing);
      summary.sent += 1;
    } catch (err) {
      console.error("[agent-worker] send failed:", err);
      summary.errors += 1;
      // Leave aiNeedsReply set so a retry/human can pick it up; do not stamp.
      return;
    }
    await emitAgentEvent(conv, "live", turn, outgoing);
    await stampInboundProcessed(conv.id, now);
    await clearNeedsReply(conv.id, false);
    return;
  }

  if (turn.action === "handoff") {
    // Warm transfer: tell the customer a colleague will follow up (no price),
    // then notify the owner and pause the agent on this thread.
    if (outgoing) {
      try {
        await sendOnChannel(conv, outgoing);
      } catch (err) {
        console.error("[agent-worker] handoff ack send failed:", err);
      }
    }
    const owners = await ownerUserIds(conv.workspaceId);
    if (owners.length > 0) {
      await sendPush(
        {
          title: "KI-Assistent: bitte übernehmen",
          body: turn.owner_note?.slice(0, 160) || "Ein Lead ist bereit für Ihr Angebot.",
          url: conv.dealRecordId ? `/objects/deals/${conv.dealRecordId}` : "/inbox",
          tag: `agent-handoff-${conv.id}`,
        },
        { workspaceId: conv.workspaceId, userIds: owners }
      );
    }
    await emitAgentEvent(conv, "live", turn, outgoing);
    await stampInboundProcessed(conv.id, now);
    // Hand the thread to the human: pause the agent until it is handed back.
    await clearNeedsReply(conv.id, true);
    summary.handoffs += 1;
    return;
  }

  // no_op
  await stampInboundProcessed(conv.id, now);
  await clearNeedsReply(conv.id, false);
  summary.noops += 1;
}

async function runForWorkspace(
  workspaceId: string,
  now: Date,
  deadlineMs: number,
  summary: AgentRunSummary
): Promise<void> {
  const [enabled, dryRun, channels, signature, disclosure, handoffAck] = await Promise.all([
    isSalesAgentEnabled(workspaceId),
    isSalesAgentDryRun(workspaceId),
    getAgentChannels(workspaceId),
    getAgentSignature(workspaceId),
    getAgentDisclosure(workspaceId),
    getAgentHandoffAck(workspaceId),
  ]);
  if (!enabled) return;
  summary.enabledWorkspaces += 1;

  const due = await selectDueConversations(workspaceId, channels, now);
  summary.due += due.length;

  const visionBudget = { left: MAX_VISION_EXTRACTIONS_PER_TICK };
  for (const conv of due) {
    // Time budget: the vision + humanizer steps can each be slow, so bail before
    // the cron times out. Unprocessed conversations keep aiNeedsReply and are
    // picked up on the next tick.
    if (Date.now() > deadlineMs) break;
    try {
      await processConversation(
        conv,
        { dryRun, signature, disclosure, handoffAck, visionBudget },
        now,
        summary
      );
      summary.processed += 1;
    } catch (err) {
      console.error("[agent-worker] conversation failed:", conv.id, err);
      summary.errors += 1;
    }
  }
}

/** Entry point for the cron: run the agent across every workspace that enabled it. */
export async function runAgentReplies(): Promise<AgentRunSummary> {
  const now = new Date();
  // Leave headroom under the route's maxDuration (300s) for slow vision/humanize.
  const deadlineMs = now.getTime() + 240_000;
  const summary: AgentRunSummary = {
    workspaces: 0,
    enabledWorkspaces: 0,
    due: 0,
    processed: 0,
    sent: 0,
    handoffs: 0,
    noops: 0,
    dryRunPreviews: 0,
    errors: 0,
  };

  const wsRows = (await db.execute<{ id: string }>(
    sql`SELECT id FROM workspaces`
  )) as unknown as Array<{ id: string }>;

  summary.workspaces = wsRows.length;
  for (const w of wsRows) {
    if (Date.now() > deadlineMs) break;
    try {
      await runForWorkspace(w.id, now, deadlineMs, summary);
    } catch (err) {
      console.error("[agent-worker] workspace failed:", w.id, err);
      summary.errors += 1;
    }
  }
  return summary;
}
