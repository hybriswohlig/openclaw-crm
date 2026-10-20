/**
 * Bookkeeping after a Nachfass draft was actually sent, and the loss-stage
 * write used by day-10 close and by the legacy triage. Never sends.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { agentEvents } from "@/db/schema/agent";
import { notes } from "@/db/schema/notes";
import { attributes, objects, selectOptions, statuses } from "@/db/schema/objects";
import { recordValues, records } from "@/db/schema/records";
import { nachfassDailySends, nachfassDealState, nachfassRuleSwitches } from "@/db/schema/nachfass";
import { emitEvent } from "@/services/activity-events";
import { resolveDealSelectInputs } from "@/services/deal-attribution";
import { updateRecord } from "@/services/records";
import { LOSS_REASON_SLUG } from "@/lib/deal-source";
import type { LossReasonTitle } from "@/lib/deal-source";
import {
  SEQUENZ_ID,
  SEQUENZ_SCHRITT,
  VERLUST_KEINE_RUECKMELDUNG,
  type NachfassRegel,
} from "./konstanten";
import { berlinTeile, verlustgrundSchreiben } from "./logik";

export interface NachfassVersand {
  workspaceId: string;
  dealRecordId: string;
  draftId: string;
  sequenceStep: number | null;
  channelAccountId: string | null;
  draftText: string;
  finalText: string;
  filterVerdicts: unknown;
  conversationId: string | null;
}

function schrittZuRegel(step: number | null): NachfassRegel | "legacy_abschluss" | null {
  if (step == null) return null;
  const hit = Object.entries(SEQUENZ_SCHRITT).find(([, n]) => n === step);
  return (hit?.[0] as NachfassRegel | "legacy_abschluss" | undefined) ?? null;
}

function notiz(text: string) {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

async function dealObjectId(dealRecordId: string): Promise<string | null> {
  const [deal] = await db
    .select({ objectId: records.objectId })
    .from(records)
    .where(eq(records.id, dealRecordId))
    .limit(1);
  return deal?.objectId ?? null;
}

async function aktuellerVerlustgrund(objectId: string, dealRecordId: string): Promise<string | null> {
  const [attr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, objectId), eq(attributes.slug, LOSS_REASON_SLUG)))
    .limit(1);
  if (!attr) return null;
  const [row] = await db
    .select({ textValue: recordValues.textValue })
    .from(recordValues)
    .where(and(eq(recordValues.recordId, dealRecordId), eq(recordValues.attributeId, attr.id)))
    .limit(1);
  if (!row?.textValue) return null;
  return row.textValue;
}

async function verlustTitel(objectId: string, gespeichert: string | null): Promise<string | null> {
  if (!gespeichert) return null;
  const [attr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, objectId), eq(attributes.slug, LOSS_REASON_SLUG)))
    .limit(1);
  if (!attr) return gespeichert;
  const options = await db
    .select({ id: selectOptions.id, title: selectOptions.title })
    .from(selectOptions)
    .where(eq(selectOptions.attributeId, attr.id));
  return options.find((o) => o.id === gespeichert)?.title ?? gespeichert;
}

async function verlorenStageId(objectId: string): Promise<string | null> {
  const [attr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, objectId), eq(attributes.slug, "stage")))
    .limit(1);
  if (!attr) return null;
  const rows = await db.select().from(statuses).where(eq(statuses.attributeId, attr.id));
  const lost =
    rows.find((s) => s.stageCategory === "lost") ??
    rows.find((s) => /^(lost|verloren)$/i.test(s.title));
  return lost?.id ?? null;
}

export async function setzeDealVerloren(input: {
  workspaceId: string;
  dealRecordId: string;
  anlass: "tag10" | "triage";
  triageGrund?: LossReasonTitle;
  vomKunden?: LossReasonTitle | null;
  notizText: string;
}): Promise<{ geschrieben: boolean; grund: string | null }> {
  const objectId = await dealObjectId(input.dealRecordId);
  if (!objectId) return { geschrieben: false, grund: null };
  const [obj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.id, objectId), eq(objects.workspaceId, input.workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  if (!obj) return { geschrieben: false, grund: null };

  const stageId = await verlorenStageId(objectId);
  if (!stageId) return { geschrieben: false, grund: null };
  const roh = await aktuellerVerlustgrund(objectId, input.dealRecordId);
  const titel = await verlustTitel(objectId, roh);
  const grund = verlustgrundSchreiben({
    bestehend: titel,
    vomKunden: input.vomKunden ?? null,
    anlass: input.anlass,
    triageGrund: input.triageGrund,
  });
  const values: Record<string, unknown> = { stage: stageId, last_reminder_at: new Date() };
  if (grund) values[LOSS_REASON_SLUG] = grund;
  const resolved = await resolveDealSelectInputs(objectId, values);
  await updateRecord(objectId, input.dealRecordId, resolved, null, {
    activity: { reason: input.anlass === "tag10" ? "Nachfass Tag 10" : "Nachfass Triage" },
  });
  await db.insert(notes).values({
    recordId: input.dealRecordId,
    title: "Nachfass",
    content: notiz(input.notizText),
    createdBy: null,
  });
  await emitEvent({
    workspaceId: input.workspaceId,
    recordId: input.dealRecordId,
    objectSlug: "deals",
    eventType: "agent.action",
    payload: { engine: "nachfass", action: "verloren", anlass: input.anlass, verlustgrund: grund },
  });
  return { geschrieben: true, grund };
}

async function zaehleSend(workspaceId: string, channelAccountId: string | null, jetzt: Date): Promise<void> {
  if (!channelAccountId) return;
  const tag = berlinTeile(jetzt).ymd;
  await db
    .insert(nachfassDailySends)
    .values({
      workspaceId,
      channelAccountId,
      berlinDay: tag,
      sentCount: 1,
      legacyDrafts: 0,
    })
    .onConflictDoUpdate({
      target: [
        nachfassDailySends.workspaceId,
        nachfassDailySends.channelAccountId,
        nachfassDailySends.berlinDay,
      ],
      set: { sentCount: sql`${nachfassDailySends.sentCount} + 1` },
    });
}

async function zaehleFreigabe(input: {
  workspaceId: string;
  dealRecordId: string;
  regel: string;
  korrigiert: boolean;
}): Promise<void> {
  const [state] = await db
    .select({ oc: nachfassDealState.operatingCompanyRecordId })
    .from(nachfassDealState)
    .where(eq(nachfassDealState.dealRecordId, input.dealRecordId))
    .limit(1);
  const oc = state?.oc ?? "";
  await db
    .insert(nachfassRuleSwitches)
    .values({
      workspaceId: input.workspaceId,
      operatingCompanyRecordId: oc,
      rule: input.regel,
      autoSend: false,
      cleanApprovals: input.korrigiert ? 0 : 1,
      correctedApprovals: input.korrigiert ? 1 : 0,
    })
    .onConflictDoUpdate({
      target: [
        nachfassRuleSwitches.workspaceId,
        nachfassRuleSwitches.operatingCompanyRecordId,
        nachfassRuleSwitches.rule,
      ],
      set: input.korrigiert
        ? {
            correctedApprovals: sql`${nachfassRuleSwitches.correctedApprovals} + 1`,
            updatedAt: new Date(),
          }
        : {
            cleanApprovals: sql`${nachfassRuleSwitches.cleanApprovals} + 1`,
            updatedAt: new Date(),
          },
    });
}

/** Called only after the draft send succeeded. Does not send anything itself. */
export async function nachfassNachVersand(input: NachfassVersand): Promise<void> {
  const regel = schrittZuRegel(input.sequenceStep);
  if (!regel) return;
  const jetzt = new Date();
  if (regel === "b") {
    await db
      .update(nachfassDealState)
      .set({
        lastTeamReminderAt: jetzt,
        teamReminders: sql`${nachfassDealState.teamReminders} + 1`,
        updatedAt: jetzt,
      })
      .where(eq(nachfassDealState.dealRecordId, input.dealRecordId));
  } else {
    await db
      .update(nachfassDealState)
      .set({
        updatedAt: jetzt,
        ...(regel === "a1" ? { fu1SentAt: jetzt } : {}),
        ...(regel === "a2" ? { fu2SentAt: jetzt } : {}),
        ...(regel === "a3" ? { closeSentAt: jetzt } : {}),
        ...(regel === "c" ? { ruleCSentAt: jetzt } : {}),
        ...(regel === "legacy" ? { legacyFuSentAt: jetzt } : {}),
        ...(regel === "legacy_abschluss" ? { legacyCloseSentAt: jetzt } : {}),
      })
      .where(eq(nachfassDealState.dealRecordId, input.dealRecordId));
  }

  if (regel !== "b") await zaehleSend(input.workspaceId, input.channelAccountId, jetzt);

  const verdicts = (input.filterVerdicts ?? {}) as {
    humanApproval?: { note?: string | null };
    nachfass?: { vomKunden?: LossReasonTitle | null };
  };
  const korrigiert =
    input.finalText.trim() !== input.draftText.trim() || Boolean(verdicts.humanApproval?.note?.trim());
  const schalterRegel = regel === "legacy_abschluss" ? "a3" : regel;
  await zaehleFreigabe({
    workspaceId: input.workspaceId,
    dealRecordId: input.dealRecordId,
    regel: schalterRegel,
    korrigiert,
  });

  const text = input.finalText.trim() || input.draftText.trim();
  await db.insert(notes).values({
    recordId: input.dealRecordId,
    title: regel === "b" ? "Nachfass Team" : "Nachfass gesendet",
    content: notiz(text.slice(0, 2000)),
    createdBy: null,
  });
  await emitEvent({
    workspaceId: input.workspaceId,
    recordId: input.dealRecordId,
    objectSlug: "deals",
    eventType: "agent.action",
    payload: { engine: "nachfass", action: "gesendet", regel, draftId: input.draftId },
  });
  await db
    .insert(agentEvents)
    .values({
      workspaceId: input.workspaceId,
      dealRecordId: input.dealRecordId,
      conversationId: input.conversationId,
      engine: "followup",
      eventType: "sent",
      payload: { source: SEQUENZ_ID, regel, draftId: input.draftId },
      idempotencyKey: `nachfass-sent:${input.draftId}`,
    })
    .onConflictDoNothing();

  if (regel === "a3" || regel === "legacy_abschluss") {
    await setzeDealVerloren({
      workspaceId: input.workspaceId,
      dealRecordId: input.dealRecordId,
      anlass: "tag10",
      vomKunden: verdicts.nachfass?.vomKunden ?? null,
      notizText:
        regel === "a3"
          ? "Nachfass Tag 10: Abschluss gesendet, Deal auf Verloren."
          : "Altbestand: drei Tage nach dem Nachfass ohne Antwort, Deal auf Verloren.",
    });
  } else {
    const objectId = await dealObjectId(input.dealRecordId);
    if (objectId) {
      await updateRecord(objectId, input.dealRecordId, { last_reminder_at: jetzt }, null);
    }
  }
}

export { VERLUST_KEINE_RUECKMELDUNG };
