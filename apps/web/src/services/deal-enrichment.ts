/**
 * Background enrichment of empty deal fields from conversations and notes.
 *
 * Reads what the CRM already stored. Never sends a customer message and never
 * copies WhatsApp into a second store — evidence quotes are short excerpts of
 * existing message and note text.
 */

import { createHash } from "crypto";
import { z } from "zod";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { dealEnrichmentCursors, dealFieldSuggestions } from "@/db/schema/deal-enrichment";
import { phoneCalls } from "@/db/schema/phone-calls";
import { notes } from "@/db/schema/notes";
import { objects, attributes, selectOptions, statuses } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import { inboxConversations, inboxContacts, inboxMessages } from "@/db/schema/inbox";
import { dealAgentState } from "@/db/schema/agent";
import { emitEvent } from "@/services/activity-events";
import { runAITask } from "@/services/ai/run-task";
import { AI_TASK_SLUGS } from "@/services/ai/task-registry";
import { excludeInternalPhotoMessages } from "@/services/deal-photos";
import { batchGetRecordDisplayNames } from "@/services/display-names";
import { findeInterne, ladeInterneNummern, type InterneNummer } from "@/services/intern/interne-nummern";
import { DEAL_ENRICHMENT_DEBOUNCE_MS } from "@/services/deal-enrichment-queue";
import {
  effectiveEnrichmentSwitches,
  readEnrichmentSettings,
} from "@/services/deal-enrichment-settings";
import { updateRecord } from "@/services/records";
import { applyKontaktart } from "@/services/kontaktart";
import { bewerberQuote, isLeadKunde, type Kontaktart } from "@/lib/kontaktart";
import {
  ANRUF_FELD_LABELS,
  ENRICHMENT_FIELD_LABELS,
  ENRICHMENT_FIELDS,
  evaluateCallProposals,
  evaluateDealEnrichment,
  isAnrufFeld,
  isCeylanChannelAccount,
  isEnrichmentField,
  leseAnrufAngaben,
  type AnrufFeld,
  type AppliedDecision,
  type EnrichmentField,
  type PolicyOption,
  type PolicyProposal,
  type PolicySource,
  type PolicyStage,
} from "@/lib/deal-enrichment-policy";
import { stufenKategorie } from "@/services/lagekarte/status";

const MAX_MESSAGES = 40;
const MAX_NOTES = 12;
const MAX_BODY = 1500;
const HOLD_MS = 6 * 60 * 60 * 1000;

const ProposalSchema = z.object({
  proposals: z
    .array(
      z.object({
        field: z.string(),
        value: z.string(),
        confidence: z.number(),
        reason: z.string(),
        evidenceQuote: z.string(),
        evidenceSourceId: z.string(),
        evidenceSourceKind: z.enum(["message", "note"]),
      })
    )
    .default([]),
});

const SCHEMA_HINT = `{
  "proposals": [{
    "field": "source_channel | source_detail | loss_reason | loss_reason_note | stage | kontaktart",
    "value": "existing option id or exact option title; free text for source_detail and loss_reason_note; kontaktart is lead_kunde | bewerber | team_helfer | partner_vermittler | privat | spam_werbung",
    "confidence": 0.0,
    "reason": "one short sentence",
    "evidenceQuote": "verbatim substring of one source",
    "evidenceSourceId": "the id in brackets",
    "evidenceSourceKind": "message | note"
  }]
}`;

interface LoadedDeal {
  workspaceId: string;
  dealRecordId: string;
  objectId: string;
  attributeIds: Partial<Record<EnrichmentField | "operating_company", string>>;
  currentValues: Partial<Record<EnrichmentField, string | null>>;
  operatingCompanyId: string | null;
  selectOptions: { source_channel: PolicyOption[]; loss_reason: PolicyOption[] };
  stages: PolicyStage[];
  sources: PolicySource[];
  activityAt: Date | null;
  inputHash: string;
  skip: {
    ceylanChannelAccount: boolean;
    internalNumber: boolean;
    humanOwned: boolean;
    aiPaused: boolean;
  };
  permanentSkip: boolean;
}

function clip(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > MAX_BODY ? `${trimmed.slice(0, MAX_BODY)}…` : trimmed;
}

function plainNote(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (typeof content !== "object") return "";
  const node = content as { text?: unknown; content?: unknown; type?: unknown };
  const own = typeof node.text === "string" ? node.text : "";
  const children = Array.isArray(node.content) ? node.content.map(plainNote).join("") : "";
  const block = ["paragraph", "heading", "listItem", "blockquote"].includes(
    typeof node.type === "string" ? node.type : ""
  );
  return own + children + (block ? "\n" : "");
}

function hashInput(parts: string[]): string {
  return createHash("sha256").update(parts.sort().join("\n")).digest("hex");
}

function isOpenStage(stage: { title: string; stageCategory?: string | null } | null): boolean {
  if (!stage) return true;
  const category = stufenKategorie({ titel: stage.title, kategorie: stage.stageCategory ?? null });
  if (!category) return !/verloren|lost|bezahlt|paid|durchgef|gewonnen|won|\bdone\b/i.test(stage.title);
  return category === "open_new" || category === "open_engaged" || category === "quoted" || category === "booked";
}

async function loadDeal(workspaceId: string, dealRecordId: string, interne: InterneNummer[]): Promise<LoadedDeal | null> {
  const [deal] = await db
    .select({ id: records.id, objectId: records.objectId })
    .from(records)
    .innerJoin(objects, eq(records.objectId, objects.id))
    .where(and(eq(records.id, dealRecordId), eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  if (!deal) return null;

  const attributeRows = await db
    .select({ id: attributes.id, slug: attributes.slug })
    .from(attributes)
    .where(eq(attributes.objectId, deal.objectId));
  const attributeIds: LoadedDeal["attributeIds"] = {};
  for (const row of attributeRows) {
    if (isEnrichmentField(row.slug) || row.slug === "operating_company") {
      attributeIds[row.slug] = row.id;
    }
  }

  const wantedIds = Object.values(attributeIds).filter((id): id is string => !!id);
  const valueRows = wantedIds.length
    ? await db
        .select({
          attributeId: recordValues.attributeId,
          textValue: recordValues.textValue,
          referencedRecordId: recordValues.referencedRecordId,
        })
        .from(recordValues)
        .where(and(eq(recordValues.recordId, dealRecordId), inArray(recordValues.attributeId, wantedIds)))
    : [];

  const currentValues: LoadedDeal["currentValues"] = {};
  for (const field of ENRICHMENT_FIELDS) {
    const attributeId = attributeIds[field];
    const row = valueRows.find((value) => value.attributeId === attributeId);
    currentValues[field] = row?.textValue?.trim() ? row.textValue : null;
  }
  const operatingCompanyId =
    valueRows.find((value) => value.attributeId === attributeIds.operating_company)?.referencedRecordId ?? null;

  const conversationRows = await db
    .select({ kontaktart: inboxConversations.kontaktart })
    .from(inboxConversations)
    .where(and(eq(inboxConversations.workspaceId, workspaceId), eq(inboxConversations.dealRecordId, dealRecordId)));
  const nonLead = conversationRows.map((row) => row.kontaktart).find((value) => !isLeadKunde(value));
  currentValues.kontaktart = nonLead ?? conversationRows[0]?.kontaktart ?? null;

  const channelAttributeIds = [attributeIds.source_channel, attributeIds.loss_reason].filter(
    (id): id is string => !!id
  );
  const optionRows = channelAttributeIds.length
    ? await db
        .select({ id: selectOptions.id, title: selectOptions.title, attributeId: selectOptions.attributeId })
        .from(selectOptions)
        .where(inArray(selectOptions.attributeId, channelAttributeIds))
        .orderBy(asc(selectOptions.sortOrder))
    : [];
  const stageRows = attributeIds.stage
    ? await db
        .select({
          id: statuses.id,
          title: statuses.title,
          sortOrder: statuses.sortOrder,
          stageCategory: statuses.stageCategory,
          isActive: statuses.isActive,
        })
        .from(statuses)
        .where(eq(statuses.attributeId, attributeIds.stage))
        .orderBy(asc(statuses.sortOrder))
    : [];

  const conversations = await db
    .select({
      id: inboxConversations.id,
      channelAccountId: inboxConversations.channelAccountId,
      aiPaused: inboxConversations.aiPaused,
      phone: inboxContacts.phone,
      lastMessageAt: inboxConversations.lastMessageAt,
    })
    .from(inboxConversations)
    .innerJoin(inboxContacts, eq(inboxConversations.contactId, inboxContacts.id))
    .where(and(eq(inboxConversations.workspaceId, workspaceId), eq(inboxConversations.dealRecordId, dealRecordId)));

  const ceylan = conversations.some((conversation) => isCeylanChannelAccount(conversation.channelAccountId));
  const internalFlags = conversations.map((conversation) =>
    findeInterne(interne, { peerWaId: conversation.phone ?? "" })
  );
  const allInternal = conversations.length > 0 && internalFlags.every(Boolean);
  const [agent] = await db
    .select({ humanOwned: dealAgentState.humanOwned })
    .from(dealAgentState)
    .where(eq(dealAgentState.dealRecordId, dealRecordId))
    .limit(1);
  const usableConversations = conversations.filter(
    (conversation, index) => !conversation.aiPaused && !internalFlags[index]
  );

  const noteRows = await db
    .select({ id: notes.id, title: notes.title, content: notes.content, updatedAt: notes.updatedAt })
    .from(notes)
    .where(eq(notes.recordId, dealRecordId))
    .orderBy(asc(notes.updatedAt));
  const allPaused =
    conversations.length > 0 &&
    conversations.every((conversation) => conversation.aiPaused) &&
    noteRows.every((note) => clip([note.title, plainNote(note.content)].filter(Boolean).join("\n")).length === 0);

  const messageRows = usableConversations.length
    ? await db
        .select({
          id: inboxMessages.id,
          body: inboxMessages.body,
          direction: inboxMessages.direction,
          sentAt: inboxMessages.sentAt,
          createdAt: inboxMessages.createdAt,
        })
        .from(inboxMessages)
        .where(
          and(
            eq(inboxMessages.workspaceId, workspaceId),
            inArray(
              inboxMessages.conversationId,
              usableConversations.map((conversation) => conversation.id)
            ),
            excludeInternalPhotoMessages()
          )
        )
        .orderBy(asc(inboxMessages.sentAt), asc(inboxMessages.createdAt))
    : [];

  const recentMessages = messageRows.slice(-MAX_MESSAGES);
  const recentNotes = noteRows.slice(-MAX_NOTES);
  const sources: PolicySource[] = [
    ...recentMessages.map((message) => ({
      id: message.id,
      kind: "message" as const,
      text: clip(message.body ?? ""),
      direction: message.direction,
    })),
    ...recentNotes.map((note) => ({
      id: note.id,
      kind: "note" as const,
      text: clip([note.title, plainNote(note.content)].filter(Boolean).join("\n")),
      direction: null,
    })),
  ].filter((source) => source.text.length > 0);

  const times = [
    ...conversations.map((conversation) => conversation.lastMessageAt),
    ...noteRows.map((note) => note.updatedAt),
  ].filter((value): value is Date => value instanceof Date);
  const activityAt = times.length ? new Date(Math.max(...times.map((value) => value.getTime()))) : null;

  return {
    workspaceId,
    dealRecordId,
    objectId: deal.objectId,
    attributeIds,
    currentValues,
    operatingCompanyId,
    selectOptions: {
      source_channel: optionRows
        .filter((option) => option.attributeId === attributeIds.source_channel)
        .map(({ id, title }) => ({ id, title })),
      loss_reason: optionRows
        .filter((option) => option.attributeId === attributeIds.loss_reason)
        .map(({ id, title }) => ({ id, title })),
    },
    stages: stageRows,
    sources,
    activityAt,
    inputHash: hashInput(sources.map((source) => `${source.kind}\t${source.id}\t${source.text}`)),
    skip: {
      ceylanChannelAccount: ceylan,
      internalNumber: allInternal,
      humanOwned: agent?.humanOwned === true,
      aiPaused: allPaused,
    },
    permanentSkip: ceylan || allInternal,
  };
}

async function finishCursor(
  dealRecordId: string,
  patch: {
    inputHash?: string | null;
    activityCursor?: Date | null;
    runAfter?: Date | null;
    lastError?: string | null;
  }
): Promise<void> {
  await db
    .update(dealEnrichmentCursors)
    .set({ ...patch, lastRunAt: new Date(), updatedAt: new Date() })
    .where(eq(dealEnrichmentCursors.dealRecordId, dealRecordId));
}

async function writeField(
  recordId: string,
  attributeId: string,
  textValue: string,
  expectedCurrent: string | null,
  replace: boolean
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ textValue: recordValues.textValue })
      .from(recordValues)
      .where(and(eq(recordValues.recordId, recordId), eq(recordValues.attributeId, attributeId)));
    const current = rows.map((row) => row.textValue?.trim() ?? "").find((value) => value !== "") ?? null;
    if ((current ?? null) !== (expectedCurrent?.trim() || null)) return false;
    if (current && !replace) return false;
    if (rows.length > 0) {
      await tx
        .delete(recordValues)
        .where(and(eq(recordValues.recordId, recordId), eq(recordValues.attributeId, attributeId)));
    }
    await tx.insert(recordValues).values({ recordId, attributeId, textValue, sortOrder: 0 });
    return true;
  });
}

async function recordActivity(
  deal: LoadedDeal,
  decision: AppliedDecision,
  mode: "auto" | "suggestion" | "accepted" | "rejected"
): Promise<void> {
  await emitEvent({
    workspaceId: deal.workspaceId,
    recordId: deal.dealRecordId,
    objectSlug: "deals",
    eventType: "ai.field_enrichment",
    payload: {
      actor: "KI",
      mode,
      field: decision.field,
      fieldLabel: ENRICHMENT_FIELD_LABELS[decision.field],
      value: decision.value,
      valueLabel: decision.label,
      reason: decision.reason,
      quote: decision.evidenceQuote,
      evidenceSourceKind: decision.evidenceSourceKind,
      evidenceSourceId: decision.evidenceSourceId,
      confidence: decision.confidence,
    },
  });
  if (mode !== "suggestion" && mode !== "rejected" && decision.field === "stage") {
    await emitEvent({
      workspaceId: deal.workspaceId,
      recordId: deal.dealRecordId,
      objectSlug: "deals",
      eventType: "deal.stage_changed",
      payload: {
        attributeSlug: "stage",
        fromStatusId: deal.currentValues.stage ?? null,
        toStatusId: decision.value,
        actor: "KI",
      },
    });
  }
}

async function insertSuggestion(
  deal: LoadedDeal,
  decision: AppliedDecision,
  status: "pending" | "auto_applied" | "accepted",
  decidedBy: string | null
): Promise<boolean> {
  const inserted = await db
    .insert(dealFieldSuggestions)
    .values({
      workspaceId: deal.workspaceId,
      dealRecordId: deal.dealRecordId,
      fieldSlug: decision.field,
      proposedValue: decision.value,
      proposedLabel: decision.label,
      confidence: decision.confidence.toFixed(3),
      reason: decision.reason,
      evidenceQuote: decision.evidenceQuote,
      evidenceSourceKind: decision.evidenceSourceKind,
      evidenceSourceId: decision.evidenceSourceId,
      evidenceKey: decision.evidenceKey,
      status,
      decidedAt: status === "pending" ? null : new Date(),
      decidedBy,
    })
    .onConflictDoNothing()
    .returning({ id: dealFieldSuggestions.id });
  return inserted.length > 0;
}

function hasWork(deal: LoadedDeal): boolean {
  const stage = deal.stages.find((item) => item.id === deal.currentValues.stage) ?? null;
  const lost = !!stage && /verloren|lost/i.test(stage.title);
  if (isLeadKunde(deal.currentValues.kontaktart) && (isOpenStage(stage) || lost)) return true;
  if (!deal.currentValues.source_channel || !deal.currentValues.source_detail) return true;
  if (isOpenStage(stage)) return true;
  if (!deal.currentValues.loss_reason && lost) return true;
  return false;
}

async function rejectedKeys(dealRecordId: string): Promise<Set<string>> {
  const rows = await db
    .select({ evidenceKey: dealFieldSuggestions.evidenceKey })
    .from(dealFieldSuggestions)
    .where(and(eq(dealFieldSuggestions.dealRecordId, dealRecordId), eq(dealFieldSuggestions.status, "rejected")));
  return new Set(rows.map((row) => row.evidenceKey));
}

function promptFor(deal: LoadedDeal): string {
  const optionList = (field: "source_channel" | "loss_reason") =>
    deal.selectOptions[field].map((option) => `${option.id} = ${option.title}`).join("\n") || "(keine)";
  // Only selectable stages; hidden English duplicates would drop the deal off the board.
  const stageList =
    deal.stages
      .filter((stage) => stage.isActive !== false)
      .map((stage) => `${stage.id} = ${stage.title}`)
      .join("\n") || "(keine)";
  const empty = ENRICHMENT_FIELDS.filter((field) => {
    if (field === "kontaktart") return isLeadKunde(deal.currentValues.kontaktart);
    if (field === "stage") return isOpenStage(deal.stages.find((stage) => stage.id === deal.currentValues.stage) ?? null);
    return !deal.currentValues[field];
  });
  const transcript = deal.sources
    .map((source) => `[${source.kind} ${source.id}${source.direction ? ` ${source.direction}` : ""}]\n${source.text}`)
    .join("\n\n");
  return [
    "Felder, die noch leer sind oder (nur Phase) noch offen sind:",
    empty.join(", ") || "(keins)",
    "",
    "Quelle / Kanal, erlaubte Werte:",
    optionList("source_channel"),
    "",
    "Verlustgrund, erlaubte Werte:",
    optionList("loss_reason"),
    "",
    "Phase, erlaubte Werte:",
    stageList,
    "",
    "Kontaktart, erlaubte Werte (nur setzen, wenn der Text kein Umzugs-Lead ist):",
    "bewerber = Bewerber (Bewerbung, Lebenslauf, Initiativbewerbung, Jobsuche)",
    "team_helfer = Team/Helfer (eigene Helfer, Schicht, interne Einsatzplanung)",
    "partner_vermittler = Partner/Vermittler (Jobbörse, Partnerfirma, Vermittlung)",
    "privat = Privat (privater Kontakt, kein Auftrag)",
    "spam_werbung = Spam/Werbung",
    "lead_kunde ist der Default und wird nicht vorgeschlagen.",
    "",
    "Quellen (Zitat muss wortwörtlich aus genau einer Quelle stammen):",
    transcript || "(leer)",
  ].join("\n");
}

const SYSTEM_PROMPT = `Du füllst leere CRM-Felder eines Umzugs-Deals aus dem bestehenden Gespräch und aus Notizen.
Antworte nur mit JSON.
Regeln:
- Schlage nur Felder vor, die in der Liste "noch leer" stehen. Phase darf nur vorwärts oder nach Verloren.
- value ist eine vorhandene Option-ID oder der exakte Optionstitel. source_detail und loss_reason_note sind kurzer Freitext.
- evidenceQuote ist ein wortwörtliches Zitat aus genau einer Quelle. evidenceSourceId ist die ID in eckigen Klammern.
- confidence zwischen 0 und 1. reason ein kurzer Satz auf Deutsch.
- Phase Verloren nur, wenn der Kunde ausdrücklich absagt oder schon jemanden hat (eingehende Nachricht oder Notiz).
- kontaktart bewerber, wenn der Text eine Bewerbung ist (Bewerbung, Lebenslauf, Initiativbewerbung, Jobsuche). Das ist kein verlorener Auftrag.
- Erfinde nichts. Wenn nichts belegt ist, gib {"proposals":[]} zurück.
- Sende keine Nachricht und schlage keinen Versand vor.`;

async function applyModelDecisions(deal: LoadedDeal, decisions: AppliedDecision[]): Promise<{ auto: number; suggested: number }> {
  let auto = 0;
  let suggested = 0;
  const ordered = [...decisions].sort((a, b) => Number(b.field === "stage") - Number(a.field === "stage"));
  const stageDecision = ordered.find((decision) => decision.field === "stage") ?? null;
  let stageWritten = !stageDecision;
  const alreadyLost = /verloren|lost/i.test(
    deal.stages.find((stage) => stage.id === deal.currentValues.stage)?.title ?? ""
  );

  for (const decision of ordered) {
    if (decision.field === "kontaktart") {
      if (decision.action === "suggest") {
        if (await insertSuggestion(deal, { ...decision, action: "suggest" }, "pending", null)) {
          suggested += 1;
          await recordActivity(deal, decision, "suggestion");
        }
        continue;
      }
      const slug = decision.value as Kontaktart;
      if (!isLeadKunde(deal.currentValues.kontaktart)) continue;
      await applyKontaktart({
        workspaceId: deal.workspaceId,
        kontaktart: slug,
        dealRecordId: deal.dealRecordId,
      });
      deal.currentValues.kontaktart = slug;
      if (await insertSuggestion(deal, decision, "auto_applied", null)) {
        auto += 1;
        await recordActivity(deal, decision, "auto");
      }
      continue;
    }
    const lossField = decision.field === "loss_reason" || decision.field === "loss_reason_note";
    const waitForStage = lossField && !!stageDecision && !alreadyLost && !stageWritten;
    if (decision.action === "suggest" || waitForStage) {
      if (await insertSuggestion(deal, { ...decision, action: "suggest" }, "pending", null)) {
        suggested += 1;
        await recordActivity(deal, decision, "suggestion");
      }
      continue;
    }
    const attributeId = deal.attributeIds[decision.field];
    if (!attributeId) continue;
    const wrote = await writeField(
      deal.dealRecordId,
      attributeId,
      decision.value,
      deal.currentValues[decision.field] ?? null,
      decision.field === "stage"
    );
    if (decision.field === "stage") stageWritten = wrote;
    if (!wrote) continue;
    if (await insertSuggestion(deal, decision, "auto_applied", null)) {
      auto += 1;
      await recordActivity(deal, decision, "auto");
    }
  }
  return { auto, suggested };
}

export async function processDealEnrichment(
  workspaceId: string,
  dealRecordId: string,
  interne?: InterneNummer[]
): Promise<{ status: string; auto?: number; suggested?: number }> {
  const numbers = interne ?? (await ladeInterneNummern(workspaceId));
  const deal = await loadDeal(workspaceId, dealRecordId, numbers);
  if (!deal) return { status: "missing" };

  if (deal.skip.ceylanChannelAccount || deal.skip.internalNumber || deal.skip.humanOwned || deal.skip.aiPaused) {
    await finishCursor(dealRecordId, {
      inputHash: deal.permanentSkip ? deal.inputHash : undefined,
      activityCursor: deal.permanentSkip ? deal.activityAt : undefined,
      runAfter: deal.permanentSkip ? null : new Date(Date.now() + HOLD_MS),
      lastError: deal.skip.ceylanChannelAccount
        ? "ceylan_channel_account"
        : deal.skip.internalNumber
          ? "internal_number"
          : deal.skip.humanOwned
            ? "human_owned"
            : "ai_paused",
    });
    return { status: "skipped" };
  }

  const [cursor] = await db
    .select({ inputHash: dealEnrichmentCursors.inputHash })
    .from(dealEnrichmentCursors)
    .where(eq(dealEnrichmentCursors.dealRecordId, dealRecordId))
    .limit(1);
  if (cursor?.inputHash && cursor.inputHash === deal.inputHash) {
    await finishCursor(dealRecordId, { runAfter: null, activityCursor: deal.activityAt, lastError: null });
    return { status: "unchanged" };
  }
  if (deal.sources.length === 0 || !hasWork(deal)) {
    await finishCursor(dealRecordId, {
      inputHash: deal.inputHash,
      activityCursor: deal.activityAt,
      runAfter: null,
      lastError: null,
    });
    return { status: "nothing_to_fill" };
  }

  const settings = await readEnrichmentSettings(workspaceId);
  const switches = effectiveEnrichmentSwitches(settings, deal.operatingCompanyId);
  if (!switches.suggestionsEnabled && !switches.autoWriteEnabled) {
    await finishCursor(dealRecordId, { runAfter: new Date(Date.now() + HOLD_MS), lastError: "kill_switch" });
    return { status: "kill_switch" };
  }

  const ai = await runAITask({
    workspaceId,
    taskSlug: AI_TASK_SLUGS.DEAL_ENRICH_FIELDS,
    system: SYSTEM_PROMPT,
    prompt: promptFor(deal),
    schema: ProposalSchema,
    schemaHint: SCHEMA_HINT,
    background: true,
  });
  if (!ai.ok) {
    await finishCursor(dealRecordId, {
      runAfter: new Date(Date.now() + 15 * 60 * 1000),
      lastError: ai.error.slice(0, 500),
    });
    return { status: "llm_error" };
  }

  const policy = evaluateDealEnrichment({
    proposals: [...ai.output.proposals, ...bewerberProposals(deal.sources)],
    currentValues: deal.currentValues,
    selectOptions: deal.selectOptions,
    stages: deal.stages,
    sources: deal.sources,
    threshold: settings.confidenceThreshold,
    suggestionsEnabled: switches.suggestionsEnabled,
    autoWriteEnabled: switches.autoWriteEnabled,
    skip: deal.skip,
    rejectedEvidenceKeys: await rejectedKeys(dealRecordId),
  });
  const applicable = policy.decisions.filter((decision): decision is AppliedDecision => decision.action !== "drop");
  const counts = await applyModelDecisions(deal, applicable);
  await finishCursor(dealRecordId, {
    inputHash: deal.inputHash,
    activityCursor: deal.activityAt,
    runAfter: null,
    lastError: null,
  });
  return { status: "done", ...counts };
}

async function sweepOpenDeals(): Promise<number> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const conversationRows = await db
    .select({
      dealRecordId: inboxConversations.dealRecordId,
      workspaceId: inboxConversations.workspaceId,
      lastMessageAt: inboxConversations.lastMessageAt,
    })
    .from(inboxConversations)
    .where(and(isNotNull(inboxConversations.dealRecordId), gte(inboxConversations.lastMessageAt, since)))
    .limit(400);
  const noteRows = await db
    .select({
      recordId: notes.recordId,
      updatedAt: notes.updatedAt,
      workspaceId: objects.workspaceId,
    })
    .from(notes)
    .innerJoin(records, eq(notes.recordId, records.id))
    .innerJoin(objects, eq(records.objectId, objects.id))
    .where(and(eq(objects.slug, "deals"), gte(notes.updatedAt, since)))
    .limit(200);

  const latest = new Map<string, { workspaceId: string; at: Date }>();
  for (const row of conversationRows) {
    if (!row.dealRecordId || !row.lastMessageAt) continue;
    const prev = latest.get(row.dealRecordId);
    if (!prev || row.lastMessageAt > prev.at) {
      latest.set(row.dealRecordId, { workspaceId: row.workspaceId, at: row.lastMessageAt });
    }
  }
  for (const row of noteRows) {
    const prev = latest.get(row.recordId);
    if (!prev || row.updatedAt > prev.at) latest.set(row.recordId, { workspaceId: row.workspaceId, at: row.updatedAt });
  }
  const ids = [...latest.keys()];
  if (ids.length === 0) return 0;

  const stageAttributes = await db
    .select({ id: attributes.id, workspaceId: objects.workspaceId })
    .from(attributes)
    .innerJoin(objects, eq(attributes.objectId, objects.id))
    .where(and(eq(objects.slug, "deals"), eq(attributes.slug, "stage")));
  const stageAttributeIds = stageAttributes.map((row) => row.id);
  const stageStatuses = stageAttributeIds.length
    ? await db
        .select({
          id: statuses.id,
          title: statuses.title,
          stageCategory: statuses.stageCategory,
        })
        .from(statuses)
        .where(inArray(statuses.attributeId, stageAttributeIds))
    : [];
  const statusById = new Map(stageStatuses.map((status) => [status.id, status]));
  const stageValues = stageAttributeIds.length
    ? await db
        .select({ recordId: recordValues.recordId, textValue: recordValues.textValue })
        .from(recordValues)
        .where(and(inArray(recordValues.recordId, ids), inArray(recordValues.attributeId, stageAttributeIds)))
    : [];
  const stageByDeal = new Map(stageValues.map((row) => [row.recordId, row.textValue]));
  const cursors = await db
    .select({
      dealRecordId: dealEnrichmentCursors.dealRecordId,
      runAfter: dealEnrichmentCursors.runAfter,
      activityCursor: dealEnrichmentCursors.activityCursor,
      inputHash: dealEnrichmentCursors.inputHash,
    })
    .from(dealEnrichmentCursors)
    .where(inArray(dealEnrichmentCursors.dealRecordId, ids));
  const cursorByDeal = new Map(cursors.map((cursor) => [cursor.dealRecordId, cursor]));

  let queued = 0;
  const now = new Date();
  for (const [dealRecordId, activity] of latest) {
    const stageId = stageByDeal.get(dealRecordId);
    const stage = stageId ? statusById.get(stageId) ?? null : null;
    if (stage && !isOpenStage(stage)) continue;
    const cursor = cursorByDeal.get(dealRecordId);
    if (cursor?.runAfter && cursor.runAfter > now) continue;
    if (cursor?.inputHash && cursor.activityCursor && cursor.activityCursor >= activity.at) continue;
    const runAfter = new Date(Math.max(activity.at.getTime() + DEAL_ENRICHMENT_DEBOUNCE_MS, now.getTime()));
    await db
      .insert(dealEnrichmentCursors)
      .values({
        workspaceId: activity.workspaceId,
        dealRecordId,
        runAfter,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [dealEnrichmentCursors.workspaceId, dealEnrichmentCursors.dealRecordId],
        set: { runAfter, updatedAt: now },
      });
    queued += 1;
  }
  return queued;
}

export interface EnrichmentCronSummary {
  queued: number;
  processed: number;
  unchanged: number;
  skipped: number;
  auto: number;
  suggested: number;
  errors: string[];
}

export async function runDealEnrichmentCron(maxDeals = 2): Promise<EnrichmentCronSummary> {
  const summary: EnrichmentCronSummary = {
    queued: 0,
    processed: 0,
    unchanged: 0,
    skipped: 0,
    auto: 0,
    suggested: 0,
    errors: [],
  };
  summary.queued = await sweepOpenDeals();
  const due = await db
    .select({
      id: dealEnrichmentCursors.id,
      workspaceId: dealEnrichmentCursors.workspaceId,
      dealRecordId: dealEnrichmentCursors.dealRecordId,
    })
    .from(dealEnrichmentCursors)
    .where(lte(dealEnrichmentCursors.runAfter, new Date()))
    .orderBy(asc(dealEnrichmentCursors.runAfter))
    .limit(maxDeals);

  const interneByWorkspace = new Map<string, InterneNummer[]>();
  for (const row of due) {
    await db
      .update(dealEnrichmentCursors)
      .set({ runAfter: new Date(Date.now() + 20 * 60 * 1000), updatedAt: new Date() })
      .where(eq(dealEnrichmentCursors.id, row.id));
    try {
      let interne = interneByWorkspace.get(row.workspaceId);
      if (!interne) {
        interne = await ladeInterneNummern(row.workspaceId);
        interneByWorkspace.set(row.workspaceId, interne);
      }
      const result = await processDealEnrichment(row.workspaceId, row.dealRecordId, interne);
      summary.processed += 1;
      if (result.status === "unchanged" || result.status === "nothing_to_fill") summary.unchanged += 1;
      if (result.status === "skipped" || result.status === "kill_switch") summary.skipped += 1;
      summary.auto += result.auto ?? 0;
      summary.suggested += result.suggested ?? 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : "enrichment failed";
      summary.errors.push(`${row.dealRecordId}: ${message}`);
      await finishCursor(row.dealRecordId, {
        runAfter: new Date(Date.now() + 15 * 60 * 1000),
        lastError: message.slice(0, 500),
      });
    }
  }
  return summary;
}

export interface SuggestionView {
  id: string;
  dealRecordId: string;
  dealName: string;
  fieldSlug: string;
  fieldLabel: string;
  proposedValue: string;
  proposedLabel: string;
  confidence: number;
  reason: string;
  evidenceQuote: string;
  evidenceSourceKind: string;
  evidenceSourceId: string;
  status: string;
  createdAt: string;
}

export async function listDealEnrichmentSuggestions(
  workspaceId: string,
  opts: { dealRecordId?: string; status?: string; limit?: number } = {}
): Promise<SuggestionView[]> {
  const status = opts.status ?? "pending";
  const limit = Math.min(opts.limit ?? 100, 200);
  const filters = [eq(dealFieldSuggestions.workspaceId, workspaceId), eq(dealFieldSuggestions.status, status)];
  if (opts.dealRecordId) filters.push(eq(dealFieldSuggestions.dealRecordId, opts.dealRecordId));
  const rows = await db
    .select()
    .from(dealFieldSuggestions)
    .where(and(...filters))
    .orderBy(asc(dealFieldSuggestions.createdAt))
    .limit(limit);
  const names = await batchGetRecordDisplayNames(rows.map((row) => row.dealRecordId));
  return rows.map((row) => ({
    id: row.id,
    dealRecordId: row.dealRecordId,
    dealName: names.get(row.dealRecordId)?.displayName || "Lead",
    fieldSlug: row.fieldSlug,
    fieldLabel: isEnrichmentField(row.fieldSlug)
      ? ENRICHMENT_FIELD_LABELS[row.fieldSlug]
      : isAnrufFeld(row.fieldSlug)
        ? ANRUF_FELD_LABELS[row.fieldSlug]
        : row.fieldSlug,
    proposedValue: row.proposedValue,
    proposedLabel: row.proposedLabel,
    confidence: Number(row.confidence),
    reason: row.reason,
    evidenceQuote: row.evidenceQuote,
    evidenceSourceKind: row.evidenceSourceKind,
    evidenceSourceId: row.evidenceSourceId,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  }));
}

function bewerberProposals(sources: PolicySource[]): PolicyProposal[] {
  for (const source of sources) {
    if (source.kind === "message" && source.direction === "outbound") continue;
    const quote = bewerberQuote(source.text);
    if (!quote) continue;
    return [
      {
        field: "kontaktart",
        value: "bewerber",
        confidence: 0.93,
        reason: "Der Text ist eine Bewerbung.",
        evidenceQuote: quote,
        evidenceSourceId: source.id,
        evidenceSourceKind: source.kind,
      },
    ];
  }
  return [];
}

function suggestionToProposal(row: typeof dealFieldSuggestions.$inferSelect): PolicyProposal {
  return {
    field: row.fieldSlug,
    value: row.proposedValue,
    confidence: Number(row.confidence),
    reason: row.reason,
    evidenceQuote: row.evidenceQuote,
    evidenceSourceId: row.evidenceSourceId,
    evidenceSourceKind: row.evidenceSourceKind === "note" ? "note" : "message",
  };
}

export async function decideDealEnrichmentSuggestion(input: {
  workspaceId: string;
  dealRecordId: string;
  suggestionId: string;
  action: "accept" | "reject";
  userId: string | null;
}): Promise<{ ok: true; applied: string[] } | { ok: false; status: number; error: string }> {
  const [suggestion] = await db
    .select()
    .from(dealFieldSuggestions)
    .where(
      and(
        eq(dealFieldSuggestions.id, input.suggestionId),
        eq(dealFieldSuggestions.workspaceId, input.workspaceId),
        eq(dealFieldSuggestions.dealRecordId, input.dealRecordId),
        eq(dealFieldSuggestions.status, "pending")
      )
    )
    .limit(1);
  if (!suggestion) {
    return { ok: false, status: 404, error: "Vorschlag nicht gefunden" };
  }
  if (isAnrufFeld(suggestion.fieldSlug)) {
    if (input.action === "reject") {
      await db
        .update(dealFieldSuggestions)
        .set({ status: "rejected", decidedAt: new Date(), decidedBy: input.userId })
        .where(eq(dealFieldSuggestions.id, suggestion.id));
      return { ok: true, applied: [] };
    }
    return uebernehmeAnrufFeld({
      workspaceId: input.workspaceId,
      dealRecordId: input.dealRecordId,
      suggestion,
      userId: input.userId,
    });
  }
  if (!isEnrichmentField(suggestion.fieldSlug)) {
    return { ok: false, status: 404, error: "Vorschlag nicht gefunden" };
  }

  const interne = await ladeInterneNummern(input.workspaceId);
  const deal = await loadDeal(input.workspaceId, input.dealRecordId, interne);
  if (!deal) return { ok: false, status: 404, error: "Deal nicht gefunden" };

  if (input.action === "reject") {
    await db
      .update(dealFieldSuggestions)
      .set({ status: "rejected", decidedAt: new Date(), decidedBy: input.userId })
      .where(eq(dealFieldSuggestions.id, suggestion.id));
    await recordActivity(
      deal,
      {
        action: "suggest",
        field: suggestion.fieldSlug,
        value: suggestion.proposedValue,
        label: suggestion.proposedLabel,
        confidence: Number(suggestion.confidence),
        reason: suggestion.reason,
        evidenceQuote: suggestion.evidenceQuote,
        evidenceSourceId: suggestion.evidenceSourceId,
        evidenceSourceKind: suggestion.evidenceSourceKind === "note" ? "note" : "message",
        evidenceKey: suggestion.evidenceKey,
      },
      "rejected"
    );
    return { ok: true, applied: [] };
  }

  const pending = await db
    .select()
    .from(dealFieldSuggestions)
    .where(
      and(
        eq(dealFieldSuggestions.workspaceId, input.workspaceId),
        eq(dealFieldSuggestions.dealRecordId, input.dealRecordId),
        eq(dealFieldSuggestions.status, "pending")
      )
    );
  const policy = evaluateDealEnrichment({
    proposals: pending.map((row) => ({
      ...suggestionToProposal(row),
      confidence: row.id === suggestion.id ? 1 : Number(row.confidence),
    })),
    currentValues: deal.currentValues,
    selectOptions: deal.selectOptions,
    stages: deal.stages,
    sources: deal.sources,
    threshold: 0,
    suggestionsEnabled: true,
    autoWriteEnabled: true,
    skip: { ceylanChannelAccount: false, internalNumber: false, humanOwned: false, aiPaused: false },
    rejectedEvidenceKeys: new Set(),
  });
  const accepted = policy.decisions.find(
    (decision) => decision.field === suggestion.fieldSlug && decision.action === "auto_write"
  );
  if (!accepted || accepted.action !== "auto_write") {
    const dropped = policy.decisions.find((decision) => decision.field === suggestion.fieldSlug);
    return {
      ok: false,
      status: 409,
      error: dropped && dropped.action === "drop" ? dropped.reason : "Vorschlag ist nicht mehr zulässig",
    };
  }

  const bundle = policy.decisions.filter((decision): decision is AppliedDecision => {
    if (decision.action !== "auto_write") return false;
    if (decision.field === suggestion.fieldSlug) return true;
    return (
      suggestion.fieldSlug === "stage" &&
      (decision.field === "loss_reason" || decision.field === "loss_reason_note")
    );
  });

  const applied: string[] = [];
  for (const decision of bundle) {
    if (decision.field === "kontaktart") {
      if (!isLeadKunde(deal.currentValues.kontaktart)) {
        return { ok: false, status: 409, error: "Feld ist nicht mehr leer" };
      }
      await applyKontaktart({
        workspaceId: deal.workspaceId,
        kontaktart: decision.value as Kontaktart,
        dealRecordId: deal.dealRecordId,
        actorId: input.userId,
      });
      const match = pending.find((row) => row.fieldSlug === decision.field && row.evidenceKey === decision.evidenceKey);
      if (match) {
        await db
          .update(dealFieldSuggestions)
          .set({ status: "accepted", decidedAt: new Date(), decidedBy: input.userId })
          .where(eq(dealFieldSuggestions.id, match.id));
      }
      await recordActivity(deal, decision, "accepted");
      applied.push(decision.field);
      continue;
    }
    const attributeId = deal.attributeIds[decision.field];
    if (!attributeId) continue;
    const wrote = await writeField(
      deal.dealRecordId,
      attributeId,
      decision.value,
      deal.currentValues[decision.field] ?? null,
      decision.field === "stage"
    );
    if (!wrote && decision.field === suggestion.fieldSlug) {
      return { ok: false, status: 409, error: "Feld ist nicht mehr leer" };
    }
    if (!wrote) continue;
    const match = pending.find((row) => row.fieldSlug === decision.field && row.evidenceKey === decision.evidenceKey);
    if (match) {
      await db
        .update(dealFieldSuggestions)
        .set({ status: "accepted", decidedAt: new Date(), decidedBy: input.userId })
        .where(eq(dealFieldSuggestions.id, match.id));
    }
    await recordActivity(deal, decision, "accepted");
    applied.push(decision.field);
  }
  if (!applied.includes(suggestion.fieldSlug)) {
    return { ok: false, status: 409, error: "Feld ist nicht mehr leer" };
  }
  return { ok: true, applied };
}

const ANRUF_TYP: Record<AnrufFeld, string> = {
  move_date: "date",
  move_from_address: "location",
  move_to_address: "location",
  floors_from: "number",
  floors_to: "number",
  inventory_notes: "text",
};

function anrufText(summary: string | null, transcript: string | null): string {
  return [summary, transcript].filter((teil) => teil && teil.trim()).join("\n");
}

function feldIstLeer(
  type: string,
  row: { textValue: string | null; numberValue: string | null; dateValue: string | null; jsonValue: unknown } | undefined
): boolean {
  if (!row) return true;
  if (type === "number" || type === "currency" || type === "rating") return row.numberValue == null || row.numberValue === "";
  if (type === "date") return !row.dateValue;
  if (type === "location" || type === "json" || type === "personal_name") return row.jsonValue == null;
  return !row.textValue?.trim();
}

function schreibwert(feld: AnrufFeld, proposed: string): unknown {
  if (feld === "floors_from" || feld === "floors_to") return Number(proposed);
  if (feld === "move_from_address" || feld === "move_to_address") {
    const parsed = JSON.parse(proposed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("adresse");
    return parsed;
  }
  return proposed;
}

/** Pending suggestions from a finished call. Failure must not undo the lead. */
export async function vorschlaegeAusAnruf(input: {
  workspaceId: string;
  dealRecordId: string;
  callId: string;
  summary: string | null;
  transcript: string | null;
}): Promise<void> {
  const text = anrufText(input.summary, input.transcript);
  if (!text.trim()) return;

  const [deal] = await db
    .select({ id: records.id, objectId: records.objectId })
    .from(records)
    .innerJoin(objects, eq(records.objectId, objects.id))
    .where(
      and(
        eq(records.id, input.dealRecordId),
        eq(objects.workspaceId, input.workspaceId),
        eq(objects.slug, "deals"),
        isNull(records.deletedAt)
      )
    )
    .limit(1);
  if (!deal) return;

  const attributeRows = await db
    .select({ id: attributes.id, slug: attributes.slug, type: attributes.type })
    .from(attributes)
    .where(eq(attributes.objectId, deal.objectId));
  const passend = attributeRows.filter((row) => isAnrufFeld(row.slug) && row.type === ANRUF_TYP[row.slug]);
  if (passend.length === 0) return;

  const valueRows = await db
    .select({
      attributeId: recordValues.attributeId,
      textValue: recordValues.textValue,
      numberValue: recordValues.numberValue,
      dateValue: recordValues.dateValue,
      jsonValue: recordValues.jsonValue,
    })
    .from(recordValues)
    .where(
      and(
        eq(recordValues.recordId, deal.id),
        inArray(recordValues.attributeId, passend.map((row) => row.id))
      )
    );

  const currentValues: Partial<Record<AnrufFeld, string | null>> = {};
  for (const row of passend) {
    if (!isAnrufFeld(row.slug)) continue;
    const wert = valueRows.find((value) => value.attributeId === row.id);
    currentValues[row.slug] = feldIstLeer(row.type, wert) ? null : "belegt";
  }

  const decisions = evaluateCallProposals({
    callId: input.callId,
    text,
    proposals: leseAnrufAngaben(text),
    currentValues,
    vorhandeneSlugs: new Set(passend.map((row) => row.slug)),
  });
  for (const decision of decisions) {
    await db
      .insert(dealFieldSuggestions)
      .values({
        workspaceId: input.workspaceId,
        dealRecordId: deal.id,
        fieldSlug: decision.field,
        proposedValue: decision.value,
        proposedLabel: decision.label,
        confidence: Math.min(0.999, Math.max(0, decision.confidence)).toFixed(3),
        reason: decision.reason,
        evidenceQuote: decision.evidenceQuote,
        evidenceSourceKind: "call",
        evidenceSourceId: input.callId,
        evidenceKey: decision.evidenceKey,
        status: "pending",
      })
      .onConflictDoNothing();
  }
}

async function uebernehmeAnrufFeld(input: {
  workspaceId: string;
  dealRecordId: string;
  suggestion: typeof dealFieldSuggestions.$inferSelect;
  userId: string | null;
}): Promise<{ ok: true; applied: string[] } | { ok: false; status: number; error: string }> {
  const feld = input.suggestion.fieldSlug;
  if (!isAnrufFeld(feld)) return { ok: false, status: 404, error: "Vorschlag nicht gefunden" };

  const [call] = await db
    .select({ summary: phoneCalls.summary, transcript: phoneCalls.transcript })
    .from(phoneCalls)
    .where(and(eq(phoneCalls.id, input.suggestion.evidenceSourceId), eq(phoneCalls.workspaceId, input.workspaceId)))
    .limit(1);
  const text = anrufText(call?.summary ?? null, call?.transcript ?? null);

  const [deal] = await db
    .select({ id: records.id, objectId: records.objectId })
    .from(records)
    .innerJoin(objects, eq(records.objectId, objects.id))
    .where(
      and(
        eq(records.id, input.dealRecordId),
        eq(objects.workspaceId, input.workspaceId),
        eq(objects.slug, "deals"),
        isNull(records.deletedAt)
      )
    )
    .limit(1);
  if (!deal) return { ok: false, status: 404, error: "Deal nicht gefunden" };

  const [attr] = await db
    .select({ id: attributes.id, type: attributes.type })
    .from(attributes)
    .where(and(eq(attributes.objectId, deal.objectId), eq(attributes.slug, feld)))
    .limit(1);
  if (!attr || attr.type !== ANRUF_TYP[feld]) {
    return { ok: false, status: 404, error: "Vorschlag nicht gefunden" };
  }

  const [wert] = await db
    .select({
      textValue: recordValues.textValue,
      numberValue: recordValues.numberValue,
      dateValue: recordValues.dateValue,
      jsonValue: recordValues.jsonValue,
    })
    .from(recordValues)
    .where(and(eq(recordValues.recordId, deal.id), eq(recordValues.attributeId, attr.id)))
    .limit(1);
  const current = feldIstLeer(attr.type, wert) ? null : "belegt";
  const rohwert =
    feld === "move_from_address" || feld === "move_to_address"
      ? input.suggestion.proposedLabel
      : input.suggestion.proposedValue;
  const [decision] = evaluateCallProposals({
    callId: input.suggestion.evidenceSourceId,
    text,
    proposals: [
      {
        field: feld,
        value: rohwert,
        confidence: Number(input.suggestion.confidence),
        evidenceQuote: input.suggestion.evidenceQuote,
      },
    ],
    currentValues: { [feld]: current },
    vorhandeneSlugs: new Set([feld]),
  });
  if (!decision || decision.action !== "suggest") {
    return { ok: false, status: 409, error: "Vorschlag ist nicht mehr zulässig" };
  }

  let value: unknown;
  try {
    value = schreibwert(feld, decision.value);
  } catch {
    return { ok: false, status: 409, error: "Vorschlag ist nicht mehr zulässig" };
  }
  const geschrieben = await updateRecord(deal.objectId, deal.id, { [feld]: value }, input.userId);
  if (!geschrieben) return { ok: false, status: 404, error: "Deal nicht gefunden" };

  await db
    .update(dealFieldSuggestions)
    .set({ status: "accepted", decidedAt: new Date(), decidedBy: input.userId })
    .where(and(eq(dealFieldSuggestions.id, input.suggestion.id), eq(dealFieldSuggestions.status, "pending")));
  return { ok: true, applied: [feld] };
}

export async function countOpenSuggestions(workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(dealFieldSuggestions)
    .where(and(eq(dealFieldSuggestions.workspaceId, workspaceId), eq(dealFieldSuggestions.status, "pending")));
  return Number(row?.count ?? 0);
}
