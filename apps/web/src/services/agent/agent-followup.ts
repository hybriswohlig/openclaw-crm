/**
 * Sales agent follow-up engine (Phase 3a).
 *
 * Re-engages quiet leads: conversations where WE sent the last message and the
 * customer has gone silent for a few days. Sends at most ONE gentle nudge per
 * waiting state (capped via the trailing-outbound message count, so no DB
 * migration is needed), never names a price, and SKIPS any lead whose move date
 * has already passed (the owner's explicit rule).
 *
 * Independent on/off (sales_followup_enabled, default OFF) so it can run with or
 * without the reply agent. Honors the same dry-run flag, channel allow-list,
 * per-conversation aiPaused, and lane=="lead" gate as the reply worker.
 */

import { db } from "@/db";
import { and, asc, eq, lt, sql } from "drizzle-orm";
import { inboxConversations, inboxMessages, inboxContacts, channelAccounts } from "@/db/schema/inbox";
import { z } from "zod";
import { runAITask, humanizeGerman } from "@/services/ai/run-task";
import { AI_TASK_SLUGS } from "@/services/ai/task-registry";
import { emitEvent } from "@/services/activity-events";
import { sendPush } from "@/services/push";
import { getObjectBySlug } from "@/services/objects";
import { getRecord } from "@/services/records";
import {
  isSalesFollowupEnabled,
  isSalesAgentDryRun,
  getAgentChannels,
  getAgentSignature,
  isDiscloseAiEnabled,
  getAgentDisclosure,
  isOptOutLineEnabled,
} from "./agent-config";
import {
  sendOnChannel,
  appendSignature,
  ownerUserIds,
  agentHasSentCustomerMessage,
  withDisclosure,
  resolveBrandSignature,
  isMoveDatePast,
  getDecidedStageIds,
  getDealStageId,
  leaksPriceOrCommitment,
  isAgentSuppressed,
  OPT_OUT_LINE,
  type AgentChannelRow,
} from "./agent-shared";

// Wait this long after OUR last message before nudging.
const FOLLOWUP_AFTER_DAYS = 3;
// But never nudge threads older than this (avoids draining a stale backlog when
// follow-ups are first switched on).
const FOLLOWUP_MAX_AGE_DAYS = 21;
const MAX_PER_TICK = 10;
// At most one automated nudge per waiting state (our reply + one follow-up).
const MAX_TRAILING_OUTBOUND = 2;
const MAX_TRANSCRIPT_MESSAGES = 15;

export interface FollowupRunSummary {
  enabledWorkspaces: number;
  candidates: number;
  sent: number;
  skipped: number;
  dryRunPreviews: number;
  errors: number;
}

const FollowupSchema = z.object({
  should_followup: z.boolean().default(true),
  message_de: z.string().default(""),
  reason: z.string().default(""),
});

const FOLLOWUP_SYSTEM = `Du bist Mitarbeiter im Vertrieb eines Umzugsunternehmens (kein Chatbot). Ein Interessent hat sich nach unserer letzten Nachricht einige Tage nicht mehr gemeldet. Schreibe HÖCHSTENS eine kurze, freundliche Nachfass-Nachricht.

STIL: Deutsch, kurz, locker, kein Druck, keine Gedankenstriche, keine Bot-Floskeln. ANREDE: übernimm die Form des bisherigen Verlaufs (haben wir den Kunden geduzt oder duzt er uns, bleib beim Du, sonst Sie; nie wechseln oder mischen). Erfinde KEINEN menschlichen Namen und gib dich nicht als bestimmte Person aus. Die Signatur und die nötige KI-Kennzeichnung werden separat angehängt.

REGELN
- NENNE KEINEN PREIS und mache KEIN Angebot.
- Frage einfach freundlich nach, ob der Umzug noch ansteht und ob wir mit den Infos weitermachen sollen. Optional kurz an die noch fehlende Angabe erinnern.
- Wenn der Verlauf zeigt, dass der Kunde ABGESAGT hat, kein Interesse mehr hat, bereits woanders gebucht hat, oder es gar kein echter Umzugs-Lead ist: setze should_followup = false und lass message_de leer.

AUSGABE: NUR ein JSON-Objekt { should_followup, message_de, reason }.`;

interface FollowupCandidate {
  id: string;
  workspaceId: string;
  dealRecordId: string | null;
  channelType: string;
  waPhoneNumberId: string | null;
  baileysBridgeProvider: string | null;
  operatingCompanyRecordId: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
}


async function trailingOutboundCount(conversationId: string): Promise<{
  trailing: number;
  lastIsOutbound: boolean;
  transcript: string;
}> {
  const rows = await db
    .select({
      direction: inboxMessages.direction,
      body: inboxMessages.body,
      sentAt: inboxMessages.sentAt,
      createdAt: inboxMessages.createdAt,
    })
    .from(inboxMessages)
    .where(eq(inboxMessages.conversationId, conversationId))
    .orderBy(asc(inboxMessages.sentAt), asc(inboxMessages.createdAt))
    .limit(200);
  const recent = rows.slice(-MAX_TRANSCRIPT_MESSAGES);
  let trailing = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].direction === "outbound") trailing++;
    else break;
  }
  const transcript = recent
    .map((m) => `${m.direction === "inbound" ? "Kunde" : "Wir"}: ${(m.body ?? "").trim()}`)
    .filter((l) => l.length > 7)
    .join("\n");
  return { trailing, lastIsOutbound: recent.length > 0 && recent[recent.length - 1].direction === "outbound", transcript };
}

async function runForWorkspace(
  workspaceId: string,
  now: Date,
  deadlineMs: number,
  summary: FollowupRunSummary
): Promise<void> {
  if (!(await isSalesFollowupEnabled(workspaceId))) return;
  summary.enabledWorkspaces += 1;

  const [dryRun, channels, signature, discloseAi, disclosure, optOutLine, dealsObj] = await Promise.all([
    isSalesAgentDryRun(workspaceId),
    getAgentChannels(workspaceId),
    getAgentSignature(workspaceId),
    isDiscloseAiEnabled(workspaceId),
    getAgentDisclosure(workspaceId),
    isOptOutLineEnabled(workspaceId),
    getObjectBySlug(workspaceId, "deals"),
  ]);
  // Fail-safe: without the deals object we cannot check move_date, so do not
  // follow up at all (better silent than nudging a passed-date lead).
  if (!dealsObj) return;

  // Stage gate: deals that are already decided (Geplant/Durchgeführt/Bezahlt =
  // booked or done with us, Verloren = gone) never get a nudge, regardless of
  // how the conversation looks. This is what keeps old customers and closed
  // leads out of the follow-up loop even when the decision only happened in
  // the CRM and never in the chat.
  const decidedStages = await getDecidedStageIds(dealsObj.id);

  const allowed = new Set(channels);
  const cutoff = new Date(now.getTime() - FOLLOWUP_AFTER_DAYS * 86_400_000);

  const rows = await db
    .select({
      id: inboxConversations.id,
      workspaceId: inboxConversations.workspaceId,
      dealRecordId: inboxConversations.dealRecordId,
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
        eq(inboxConversations.aiNeedsReply, false), // a pending reply is the reply worker's job
        eq(inboxConversations.aiPaused, false),
        eq(inboxConversations.lane, "lead"),
        eq(inboxConversations.status, "open"),
        lt(inboxConversations.lastMessageAt, cutoff),
        // Upper age bound: do not nudge stale backlog threads.
        sql`${inboxConversations.lastMessageAt} > ${new Date(now.getTime() - FOLLOWUP_MAX_AGE_DAYS * 86_400_000)}`
      )
    )
    .orderBy(asc(inboxConversations.lastMessageAt))
    .limit(MAX_PER_TICK * 4);

  const candidates = rows
    .filter(
      (r) =>
        r.dealRecordId &&
        allowed.has(r.channelType) &&
        // A follow-up is days later, so a WABA WhatsApp number is always outside
        // the 24h window and the free-form send would throw and silently fail.
        // Only the in-house Baileys path (no window) and email can be nudged.
        !(r.channelType === "whatsapp" && r.waPhoneNumberId)
    )
    .slice(0, MAX_PER_TICK) as FollowupCandidate[];
  summary.candidates += candidates.length;

  for (const conv of candidates) {
    if (Date.now() > deadlineMs) break;
    try {
      const { trailing, lastIsOutbound, transcript } = await trailingOutboundCount(conv.id);
      // Only nudge when WE are the ones waiting and we have not already nudged.
      if (!lastIsOutbound) continue;
      if (trailing >= MAX_TRAILING_OUTBOUND) continue;

      // Opted out? A STOP on any thread suppresses all automated outreach
      // (Art. 21 DSGVO). Never nudge a person who declined.
      if (await isAgentSuppressed(workspaceId, { phone: conv.contactPhone, email: conv.contactEmail })) {
        summary.skipped += 1;
        continue;
      }

      // Decided deal (booked/done/paid or lost)? Leave them alone.
      if (decidedStages.size > 0 && conv.dealRecordId) {
        const stageId = await getDealStageId(dealsObj.id, conv.dealRecordId);
        if (stageId && decidedStages.has(stageId)) {
          summary.skipped += 1;
          continue;
        }
      }

      const deal = conv.dealRecordId ? await getRecord(dealsObj.id, conv.dealRecordId) : null;
      if (isMoveDatePast(deal)) {
        summary.skipped += 1;
        continue;
      }

      const result = await runAITask({
        workspaceId,
        taskSlug: AI_TASK_SLUGS.LEAD_FOLLOWUP,
        system: FOLLOWUP_SYSTEM,
        prompt: `# Gesprächsverlauf\n${transcript || "(leer)"}\n\nEntscheide, ob ein Nachfassen sinnvoll ist, und liefere das JSON.`,
        schema: FollowupSchema,
      });
      if (!result.ok) {
        summary.errors += 1;
        continue;
      }
      const out = result.output;
      if (!out.should_followup || !out.message_de.trim()) {
        summary.skipped += 1;
        continue;
      }

      // Deterministic guard: the human always makes the price/offer. A nudge that
      // slipped in a price or a booking commitment is never sent; flag the owner.
      if (leaksPriceOrCommitment(out.message_de)) {
        summary.skipped += 1;
        const owners = await ownerUserIds(workspaceId);
        if (owners.length > 0 && !dryRun) {
          await sendPush(
            {
              title: "Nachfass blockiert (Preis/Zusage)",
              body: "Ein KI-Nachfassentwurf enthielt einen Preis. Bitte selbst nachfassen.",
              url: conv.dealRecordId ? `/objects/deals/${conv.dealRecordId}` : "/inbox",
              tag: `agent-followup-blocked-${conv.id}`,
            },
            { workspaceId, userIds: owners }
          );
        }
        continue;
      }

      // Humanize the nudge (crm-tools humanizer-de) and add the AI disclosure if
      // the agent has not yet sent a customer message on this deal. Brand is
      // routed by the conversation's channel company. The opt-out line is only
      // appended when the owner enabled it (OFF by default = human test tone);
      // an inbound STOP is honored regardless.
      const isFirst = !(await agentHasSentCustomerMessage(workspaceId, conv.dealRecordId));
      const brand = await resolveBrandSignature(
        workspaceId,
        conv.operatingCompanyRecordId,
        signature
      );
      const humanized = await humanizeGerman(out.message_de);
      const base = withDisclosure(
        appendSignature(humanized, brand),
        disclosure,
        discloseAi && isFirst
      );
      const message = optOutLine ? `${base}\n\n${OPT_OUT_LINE}` : base;
      const mode = dryRun ? "dry_run" : "live";

      if (!dryRun) {
        await sendOnChannel(conv as AgentChannelRow, message);
        summary.sent += 1;
      } else {
        summary.dryRunPreviews += 1;
      }

      if (conv.dealRecordId) {
        await emitEvent({
          workspaceId,
          recordId: conv.dealRecordId,
          objectSlug: "deals",
          eventType: "agent.action",
          payload: {
            mode,
            action: "followup",
            channel: conv.channelType,
            message,
            reason: out.reason,
          },
          actorId: null,
        });
      }
    } catch (err) {
      console.error("[agent-followup] conversation failed:", conv.id, err);
      summary.errors += 1;
    }
  }
}

/** Entry point for the follow-up cron. */
export async function runAgentFollowups(): Promise<FollowupRunSummary> {
  const now = new Date();
  const deadlineMs = now.getTime() + 240_000;
  const summary: FollowupRunSummary = {
    enabledWorkspaces: 0,
    candidates: 0,
    sent: 0,
    skipped: 0,
    dryRunPreviews: 0,
    errors: 0,
  };

  const wsRows = (await db.execute<{ id: string }>(
    sql`SELECT id FROM workspaces`
  )) as unknown as Array<{ id: string }>;

  for (const w of wsRows) {
    if (Date.now() > deadlineMs) break;
    try {
      await runForWorkspace(w.id, now, deadlineMs, summary);
    } catch (err) {
      console.error("[agent-followup] workspace failed:", w.id, err);
      summary.errors += 1;
    }
  }
  return summary;
}
