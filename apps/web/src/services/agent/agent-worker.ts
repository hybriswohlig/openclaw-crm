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
  inboxContacts,
  channelAccounts,
} from "@/db/schema/inbox";
import { activityEvents } from "@/db/schema";
import { z } from "zod";
import { runAITask, humanizeGerman } from "@/services/ai/run-task";
import { AI_TASK_SLUGS } from "@/services/ai/task-registry";
import { sendPush } from "@/services/push";
import { WhatsAppSessionExpiredError } from "@/services/inbox-whatsapp";
import { emitEvent } from "@/services/activity-events";
import { extractDealInsights } from "@/services/deal-insights";
import { applyDealInsights } from "@/services/deal-insights-apply";
import { getRecord } from "@/services/records";
import { getObjectBySlug } from "@/services/objects";
import {
  isSalesAgentEnabled,
  isSalesAgentDryRun,
  getAgentChannels,
  getAgentSignature,
  isDiscloseAiEnabled,
  getAgentDisclosure,
  getAgentHandoffAck,
} from "./agent-config";
import {
  sendOnChannel,
  appendSignature,
  ownerUserIds,
  agentHasSentCustomerMessage,
  withDisclosure,
  resolveBrandSignature,
  isMoveDatePast,
  looksDeclined,
  leaksPriceOrCommitment,
  isAgentSuppressed,
} from "./agent-shared";
import { ensureAgentPriceTask } from "./agent-tasks";

const MAX_CONVERSATIONS_PER_TICK = 8;
// Cap the slow crm-tools vision extraction per tick (30 to 90s each).
const MAX_VISION_EXTRACTIONS_PER_TICK = 3;
const MAX_TRANSCRIPT_MESSAGES = 30;
// Only act on conversations whose last customer message is recent. This is the
// guard against a stale backlog: turning the agent on must never drain weeks of
// already-closed, declined, or human-handled threads. Fresh inquiries only.
const MAX_LEAD_AGE_MS = 48 * 60 * 60 * 1000;

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
- Deutsch, kurz, freundlich, sachlich-warm. Schreib natürlich und persönlich, nicht maschinell.
- ANREDE: Übernimm die Form des bisherigen Gesprächsverlaufs. Haben WIR den Kunden bisher geduzt oder duzt der Kunde uns, bleib konsequent beim Du. Sonst Sie-Form. Wechsle NIE die Anrede innerhalb eines Gesprächs und mische nie Du und Sie im selben Text.
- Keine Gedankenstriche (keine "-" als Satzzeichen), keine Bot-Floskeln, keine Emojis-Flut. Erfinde KEINEN menschlichen Namen und gib dich nicht als bestimmte Person aus.
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
- KEIN echter Umzugs-Lead: Bewerbungen (jemand bewirbt sich als Mitarbeiter), Angebote von Lieferanten oder Partnern, Werbung, Spam oder reines Danke/Smalltalk -> action = "no_op". Schreibe in owner_note kurz, worum es geht (z.B. "Bewerbung, kein Kunde"). Sende NICHTS.
- Abgesagt oder bereits bedient: Wenn der Kunde abgesagt hat, kein Interesse mehr hat, oder bereits ein ausführliches Angebot bzw. eine Antwort von uns erhalten hat und nichts Neues fragt -> action = "no_op". Reaktiviere NIE abgeschlossene oder abgelehnte Gespräche.
- Vergangener Termin: Schlage NIE einen Umzugstermin vor und bestätige keinen, der vor dem heutigen Datum (oben angegeben) liegt. Liegt der besprochene Wunschtermin in der Vergangenheit, frage NICHT danach, sondern kurz, ob der Umzug noch ansteht und welcher Termin jetzt gilt, oder setze action = "handoff" mit einer Notiz.

AUSGABE: NUR ein JSON-Objekt mit { action, message_de, owner_note, reason }. message_de ist die fertige Kundennachricht (nur bei action=ask), inklusive einer kurzen Grußzeile am Ende. Erfinde KEINEN persönlichen Namen; die Signatur wird separat angehängt.`;

/** Style guidance appended to the system prompt, depending on the disclosure toggle. */
function disclosureClause(discloseAi: boolean, brand: string): string {
  if (discloseAi) {
    return "\n\nTRANSPARENZ: Wenn der Kunde fragt, ob er mit einem Menschen oder einer KI schreibt, antworte ehrlich (ein KI-Assistent nimmt vorab Infos auf, ein Mitarbeiter übernimmt für das Angebot). Die KI-Kennzeichnung wird der ersten Nachricht separat vorangestellt.";
  }
  return `\n\nDu bist Mitarbeiter von ${brand} und schreibst natürlich und persönlich. Thematisiere nicht von dir aus, ob du Mensch oder KI bist.`;
}

interface DueConversation {
  id: string;
  workspaceId: string;
  dealRecordId: string | null;
  aiLastInboundAt: Date | null;
  aiQuietWindowSeconds: number;
  channelType: string;
  waPhoneNumberId: string | null;
  baileysBridgeProvider: string | null;
  operatingCompanyRecordId: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
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
      operatingCompanyRecordId: channelAccounts.operatingCompanyRecordId,
      contactPhone: inboxContacts.phone,
      contactEmail: inboxContacts.email,
    })
    .from(inboxConversations)
    .innerJoin(channelAccounts, eq(inboxConversations.channelAccountId, channelAccounts.id))
    .leftJoin(inboxContacts, eq(inboxConversations.contactId, inboxContacts.id))
    .where(
      and(
        eq(inboxConversations.workspaceId, workspaceId),
        eq(inboxConversations.aiNeedsReply, true),
        eq(inboxConversations.aiPaused, false),
        eq(inboxConversations.lane, "lead"),
        or(isNull(inboxConversations.aiHoldUntil), lte(inboxConversations.aiHoldUntil, now)),
        // Freshness: only recent inbound. Prevents draining a stale backlog when
        // the agent is first switched on.
        sql`${inboxConversations.aiLastInboundAt} IS NOT NULL AND ${inboxConversations.aiLastInboundAt} >= ${new Date(now.getTime() - MAX_LEAD_AGE_MS)}`,
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
    if (!r.aiLastInboundAt) return false;
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
  system: string,
  prompt: string
): Promise<AgentTurn | null> {
  const result = await runAITask({
    workspaceId,
    taskSlug: AI_TASK_SLUGS.LEAD_ASSISTANT_REPLY,
    system,
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

/**
 * Atomically claim a conversation so two overlapping cron ticks never both send
 * (the every-minute cron plus slow turns made this a real duplicate-send bug).
 * Flips aiNeedsReply true -> false in one statement; returns true only for the
 * tick that won the flip.
 */
async function claimConversation(conversationId: string): Promise<boolean> {
  const claimed = await db
    .update(inboxConversations)
    .set({ aiNeedsReply: false, updatedAt: new Date() })
    .where(
      and(eq(inboxConversations.id, conversationId), eq(inboxConversations.aiNeedsReply, true))
    )
    .returning({ id: inboxConversations.id });
  return claimed.length > 0;
}

async function processConversation(
  conv: DueConversation,
  opts: {
    dryRun: boolean;
    signature: string;
    discloseAi: boolean;
    disclosure: string;
    handoffAck: string;
    dealsObjId: string | null;
    visionBudget: { left: number };
  },
  now: Date,
  summary: AgentRunSummary
): Promise<void> {
  // Claim atomically so no two ticks process (and send) the same conversation.
  if (!(await claimConversation(conv.id))) return;

  // Opted out? A STOP on any thread suppresses all automated outreach to this
  // person. Disarm and leave them alone (Art. 21 DSGVO).
  if (await isAgentSuppressed(conv.workspaceId, { phone: conv.contactPhone, email: conv.contactEmail })) {
    await stampInboundProcessed(conv.id, now);
    summary.noops += 1;
    return;
  }

  const messages = await loadRecentMessages(conv.id);

  // Only reply if the CUSTOMER wrote last. If our last message is outbound (we or
  // a human already responded), it is not our turn, so do nothing. This stops the
  // agent re-engaging threads a human already handled.
  const last = messages[messages.length - 1];
  if (!last || last.direction !== "inbound") {
    await stampInboundProcessed(conv.id, now);
    return;
  }

  const unprocessedInbound = messages.filter(
    (m) => m.direction === "inbound" && !m.aiProcessedAt
  );

  if (unprocessedInbound.length === 0) {
    // Flag set but nothing new to answer; disarm so we don't spin on it.
    await stampInboundProcessed(conv.id, now);
    return;
  }

  // ── Deterministic eligibility gate (runs BEFORE the LLM, so the model can
  // never override it) ──────────────────────────────────────────────────────
  // 1. Customer clearly declined -> leave them alone, send nothing.
  if (looksDeclined(last.body)) {
    await stampInboundProcessed(conv.id, now);
    summary.noops += 1;
    return;
  }
  // 2. Move date already passed -> never auto-text; flag the owner to check.
  if (opts.dealsObjId && conv.dealRecordId) {
    const deal = await getRecord(opts.dealsObjId, conv.dealRecordId);
    if (isMoveDatePast(deal)) {
      if (!opts.dryRun) {
        const owners = await ownerUserIds(conv.workspaceId);
        if (owners.length > 0) {
          await sendPush(
            {
              title: "Lead prüfen: Termin vorbei",
              body: "Der hinterlegte Wunschtermin liegt in der Vergangenheit. Bitte kurz prüfen.",
              url: `/objects/deals/${conv.dealRecordId}`,
              tag: `agent-pastdate-${conv.id}`,
            },
            { workspaceId: conv.workspaceId, userIds: owners }
          );
        }
      }
      await emitAgentEvent(conv, opts.dryRun ? "dry_run" : "live", {
        action: "no_op", message_de: "", owner_note: "Wunschtermin liegt in der Vergangenheit", reason: "past_move_date",
      }, "");
      await stampInboundProcessed(conv.id, now);
      summary.noops += 1;
      return;
    }
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

  // Resolve the brand by the conversation's own channel company, so a Ceylan
  // thread signs as Ceylan and never as Kottke.
  const brand = await resolveBrandSignature(
    conv.workspaceId,
    conv.operatingCompanyRecordId,
    opts.signature
  );
  const todayStr = now.toLocaleDateString("de-DE", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const transcript = formatTranscript(messages);
  const system =
    `Heute ist ${todayStr}. Du schreibst im Namen von ${brand}.\n\n` +
    SYSTEM_PROMPT +
    disclosureClause(opts.discloseAi, brand);
  const turn = await runTurn(conv.workspaceId, system, buildTurnPrompt(transcript, insights));
  if (!turn) {
    // The model failed (timeout/parse). The claim already cleared aiNeedsReply,
    // so re-arm it (without stamping the inbound) so the next tick retries this
    // due lead instead of silently dropping it.
    await db
      .update(inboxConversations)
      .set({ aiNeedsReply: true, updatedAt: new Date() })
      .where(eq(inboxConversations.id, conv.id));
    summary.errors += 1;
    return;
  }

  // Deterministic guard: the human ALWAYS makes the price/offer. If the model's
  // "ask" turn slipped in a price or a booking commitment, do not send it —
  // convert to a handoff so the customer gets the courtesy line and a human
  // takes over (owner rule 2026-06-11). The model can never override this.
  if (turn.action === "ask" && leaksPriceOrCommitment(turn.message_de)) {
    turn.owner_note =
      `KI-Entwurf enthielt Preis/Zusage, automatisch zur Übergabe umgeleitet: "${turn.message_de.slice(0, 140)}"`;
    turn.reason = "blocked_price_or_commitment";
    turn.action = "handoff";
    turn.message_de = "";
  }

  // If disclosure is ON and this is the agent's first customer-facing message on
  // this deal, the outgoing message gets the AI disclosure prepended
  // (deterministic, so the model can never skip it). Default is OFF.
  const isFirst = !(await agentHasSentCustomerMessage(conv.workspaceId, conv.dealRecordId));
  const wantDisclose = opts.discloseAi && isFirst;

  // Build the customer-facing message for this action (empty = send nothing).
  // Both the gather question and the handoff acknowledgment go through the
  // humanizer, then the signature, then the optional first-message disclosure.
  let outgoing = "";
  if (turn.action === "ask" && turn.message_de.trim()) {
    const humanized = await humanizeGerman(turn.message_de);
    outgoing = withDisclosure(appendSignature(humanized, brand), opts.disclosure, wantDisclose);
  } else if (turn.action === "handoff" && opts.handoffAck.trim()) {
    const humanizedAck = await humanizeGerman(opts.handoffAck);
    outgoing = withDisclosure(appendSignature(humanizedAck, brand), opts.disclosure, wantDisclose);
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
      if (err instanceof WhatsAppSessionExpiredError) {
        // WABA 24h customer-service window is closed: a free-form retry can
        // never succeed until the customer writes again (which re-arms the flag
        // at ingest). Do NOT re-arm, or the per-minute cron loops forever on a
        // doomed send. Stamp, flag the owner to reply manually or via template.
        await stampInboundProcessed(conv.id, now);
        const owners = await ownerUserIds(conv.workspaceId);
        if (owners.length > 0) {
          await sendPush(
            {
              title: "WhatsApp-Antwort nicht möglich",
              body: "Das 24-Stunden-Fenster ist zu. Bitte manuell oder per Vorlage antworten.",
              url: conv.dealRecordId ? `/objects/deals/${conv.dealRecordId}` : "/inbox",
              tag: `agent-waba-expired-${conv.id}`,
            },
            { workspaceId: conv.workspaceId, userIds: owners }
          );
        }
        summary.errors += 1;
        return;
      }
      console.error("[agent-worker] send failed:", err);
      // Transient failure: re-arm (the claim cleared the flag) so the next tick
      // retries; do not stamp the inbound.
      await db
        .update(inboxConversations)
        .set({ aiNeedsReply: true, updatedAt: new Date() })
        .where(eq(inboxConversations.id, conv.id));
      summary.errors += 1;
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
    // Create a task on the deal so it shows in the team's to-do list (deduped).
    if (conv.dealRecordId) {
      await ensureAgentPriceTask(conv.workspaceId, conv.dealRecordId, turn.owner_note);
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
  const [enabled, dryRun, channels, signature, discloseAi, disclosure, handoffAck, dealsObj] =
    await Promise.all([
      isSalesAgentEnabled(workspaceId),
      isSalesAgentDryRun(workspaceId),
      getAgentChannels(workspaceId),
      getAgentSignature(workspaceId),
      isDiscloseAiEnabled(workspaceId),
      getAgentDisclosure(workspaceId),
      getAgentHandoffAck(workspaceId),
      getObjectBySlug(workspaceId, "deals"),
    ]);
  if (!enabled) return;
  summary.enabledWorkspaces += 1;
  const dealsObjId = dealsObj?.id ?? null;

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
        { dryRun, signature, discloseAi, disclosure, handoffAck, dealsObjId, visionBudget },
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
