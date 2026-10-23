/**
 * Writes Kontaktart onto the conversation and the person, moves the
 * conversation out of the lead lane, and gives linked deals the outcome
 * "Kein Lead" instead of "Verloren". Never sends a customer message.
 */
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { inboxContacts, inboxConversations } from "@/db/schema/inbox";
import { attributes, objects, selectOptions, statuses } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import {
  DEFAULT_KONTAKTART,
  KEIN_LEAD_STAGE_CATEGORY,
  KEIN_LEAD_STAGE_TITLE,
  KONTAKTART_LABELS,
  KONTAKTART_SLUG,
  KONTAKTART_VALUES,
  dealIsNonLead,
  isLeadKunde,
  laneForKontaktart,
  normalizeKontaktart,
  stageMoveForKontaktart,
  type Kontaktart,
} from "@/lib/kontaktart";
import { updateRecord } from "@/services/records";
import { aktiveZielStufe } from "@/lib/stufen-ziel";

const OPEN_STAGE_CATEGORY = "open_new";

export async function resolvePeopleKontaktartInput(
  objectId: string,
  values: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const raw = values[KONTAKTART_SLUG];
  if (typeof raw !== "string" || !raw.trim()) return values;
  const [attr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, objectId), eq(attributes.slug, KONTAKTART_SLUG)))
    .limit(1);
  if (!attr) return values;
  const options = await db
    .select({ id: selectOptions.id, title: selectOptions.title })
    .from(selectOptions)
    .where(eq(selectOptions.attributeId, attr.id));
  if (options.some((option) => option.id === raw)) return values;
  const slug = normalizeKontaktart(raw);
  const title = slug ? KONTAKTART_LABELS[slug] : raw.trim();
  const match = options.find((option) => option.title.toLowerCase() === title.toLowerCase());
  if (!match) return values;
  return { ...values, [KONTAKTART_SLUG]: match.id };
}

/**
 * Slug, German label, or the person's select option id.
 * Empty input is null so the caller can restore the lead default.
 */
export async function kontaktartFromPeopleInput(
  objectId: string,
  raw: unknown
): Promise<Kontaktart | null> {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const direct = normalizeKontaktart(raw);
  if (direct) return direct;
  const [attr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, objectId), eq(attributes.slug, KONTAKTART_SLUG)))
    .limit(1);
  if (!attr) return null;
  const [option] = await db
    .select({ title: selectOptions.title })
    .from(selectOptions)
    .where(and(eq(selectOptions.attributeId, attr.id), eq(selectOptions.id, raw)))
    .limit(1);
  return normalizeKontaktart(option?.title);
}

export async function readPersonKontaktart(personId: string): Promise<Kontaktart> {
  const [row] = await db
    .select({ text: recordValues.textValue, title: selectOptions.title })
    .from(recordValues)
    .innerJoin(attributes, eq(attributes.id, recordValues.attributeId))
    .leftJoin(selectOptions, eq(selectOptions.id, recordValues.textValue))
    .where(and(eq(recordValues.recordId, personId), eq(attributes.slug, KONTAKTART_SLUG)))
    .limit(1);
  return normalizeKontaktart(row?.title ?? row?.text) ?? DEFAULT_KONTAKTART;
}

/**
 * Kontaktart der Person hinter einem Inbox-Kontakt, für den Eingang neuer
 * Nachrichten. Ohne verknüpfte Person gilt Lead/Kunde.
 */
export async function kontaktartFuerInboxKontakt(contactId: string): Promise<Kontaktart> {
  const [kontakt] = await db
    .select({ personId: inboxContacts.crmRecordId })
    .from(inboxContacts)
    .where(eq(inboxContacts.id, contactId))
    .limit(1);
  if (!kontakt?.personId) return DEFAULT_KONTAKTART;
  return readPersonKontaktart(kontakt.personId);
}

async function peopleOptionId(personId: string, kontaktart: Kontaktart): Promise<{ objectId: string; optionId: string } | null> {
  const [person] = await db
    .select({ objectId: records.objectId })
    .from(records)
    .where(eq(records.id, personId))
    .limit(1);
  if (!person) return null;
  const [attr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, person.objectId), eq(attributes.slug, KONTAKTART_SLUG)))
    .limit(1);
  if (!attr) return null;
  const title = KONTAKTART_LABELS[kontaktart];
  const [option] = await db
    .select({ id: selectOptions.id })
    .from(selectOptions)
    .where(and(eq(selectOptions.attributeId, attr.id), sql`lower(${selectOptions.title}) = ${title.toLowerCase()}`))
    .limit(1);
  if (!option) return null;
  return { objectId: person.objectId, optionId: option.id };
}

async function stageTargets(dealId: string): Promise<{
  objectId: string;
  category: string | null;
  title: string | null;
  keinLeadId: string | null;
  openId: string | null;
} | null> {
  const [deal] = await db
    .select({ objectId: records.objectId })
    .from(records)
    .where(eq(records.id, dealId))
    .limit(1);
  if (!deal) return null;
  const [stageAttr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, deal.objectId), eq(attributes.slug, "stage")))
    .limit(1);
  if (!stageAttr) return null;
  const stageRows = await db.select().from(statuses).where(eq(statuses.attributeId, stageAttr.id));
  const [current] = await db
    .select({ text: recordValues.textValue })
    .from(recordValues)
    .where(and(eq(recordValues.recordId, dealId), eq(recordValues.attributeId, stageAttr.id)))
    .limit(1);
  const currentStage = stageRows.find((stage) => stage.id === current?.text) ?? null;
  const keinLead = aktiveZielStufe(
    stageRows,
    KEIN_LEAD_STAGE_CATEGORY,
    new RegExp(`^${KEIN_LEAD_STAGE_TITLE}$`, "i")
  );
  const open = aktiveZielStufe(stageRows, OPEN_STAGE_CATEGORY, /^(neue anfrage|inquiry)$/i);
  return {
    objectId: deal.objectId,
    category: currentStage?.stageCategory ?? null,
    title: currentStage?.title ?? null,
    keinLeadId: keinLead?.id ?? null,
    openId: open?.id ?? null,
  };
}

async function moveDeal(dealId: string, kontaktart: Kontaktart, actorId: string | null): Promise<void> {
  const target = await stageTargets(dealId);
  if (!target) return;
  const move = stageMoveForKontaktart({
    kontaktart,
    stageCategory: target.category,
    stageTitle: target.title,
  });
  if (move === "keep") return;
  if (move === "kein_lead" && target.keinLeadId) {
    await updateRecord(
      target.objectId,
      dealId,
      { stage: target.keinLeadId, loss_reason: null, loss_reason_note: null },
      actorId,
      { activity: { source: "kontaktart" } }
    );
    return;
  }
  if (move === "restore_open" && target.openId) {
    await updateRecord(target.objectId, dealId, { stage: target.openId }, actorId, {
      activity: { source: "kontaktart" },
    });
  }
}

export async function applyKontaktart(input: {
  workspaceId: string;
  kontaktart: Kontaktart;
  conversationId?: string | null;
  personRecordId?: string | null;
  dealRecordId?: string | null;
  actorId?: string | null;
  personAlreadyWritten?: boolean;
}): Promise<void> {
  const conversationIds = new Set<string>();
  const personIds = new Set<string>();
  const dealIds = new Set<string>();
  if (input.conversationId) conversationIds.add(input.conversationId);
  if (input.personRecordId) personIds.add(input.personRecordId);
  if (input.dealRecordId) dealIds.add(input.dealRecordId);

  if (input.personRecordId) {
    const contacts = await db
      .select({ id: inboxContacts.id })
      .from(inboxContacts)
      .where(
        and(eq(inboxContacts.workspaceId, input.workspaceId), eq(inboxContacts.crmRecordId, input.personRecordId))
      );
    if (contacts.length > 0) {
      const convs = await db
        .select({ id: inboxConversations.id, dealId: inboxConversations.dealRecordId })
        .from(inboxConversations)
        .where(
          and(
            eq(inboxConversations.workspaceId, input.workspaceId),
            inArray(
              inboxConversations.contactId,
              contacts.map((contact) => contact.id)
            )
          )
        );
      for (const conv of convs) {
        conversationIds.add(conv.id);
        if (conv.dealId) dealIds.add(conv.dealId);
      }
    }
  }

  if (input.dealRecordId) {
    const convs = await db
      .select({ id: inboxConversations.id, contactId: inboxConversations.contactId })
      .from(inboxConversations)
      .where(
        and(eq(inboxConversations.workspaceId, input.workspaceId), eq(inboxConversations.dealRecordId, input.dealRecordId))
      );
    for (const conv of convs) conversationIds.add(conv.id);
  }

  if (conversationIds.size > 0) {
    const rows = await db
      .select({
        id: inboxConversations.id,
        lane: inboxConversations.lane,
        dealId: inboxConversations.dealRecordId,
        personId: inboxContacts.crmRecordId,
      })
      .from(inboxConversations)
      .innerJoin(inboxContacts, eq(inboxContacts.id, inboxConversations.contactId))
      .where(
        and(
          eq(inboxConversations.workspaceId, input.workspaceId),
          inArray(inboxConversations.id, [...conversationIds])
        )
      );
    for (const row of rows) {
      if (row.dealId) dealIds.add(row.dealId);
      if (row.personId) personIds.add(row.personId);
      const lane = laneForKontaktart(input.kontaktart, row.lane);
      await db
        .update(inboxConversations)
        .set({
          kontaktart: input.kontaktart,
          lane,
          classifiedBy: "manual",
          classificationReason: `Kontaktart ${KONTAKTART_LABELS[input.kontaktart]}`,
          ...(isLeadKunde(input.kontaktart) ? {} : { aiNeedsReply: false }),
          updatedAt: new Date(),
        })
        .where(eq(inboxConversations.id, row.id));
    }
  }

  if (!input.personAlreadyWritten) {
    for (const personId of personIds) {
      const resolved = await peopleOptionId(personId, input.kontaktart);
      if (!resolved) continue;
      await updateRecord(resolved.objectId, personId, { [KONTAKTART_SLUG]: resolved.optionId }, input.actorId ?? null);
    }
  }

  if (personIds.size > 0) {
    const [peopleObj] = await db
      .select({ id: objects.id })
      .from(objects)
      .where(and(eq(objects.workspaceId, input.workspaceId), eq(objects.slug, "deals")))
      .limit(1);
    if (peopleObj) {
      const [assoc] = await db
        .select({ id: attributes.id })
        .from(attributes)
        .where(and(eq(attributes.objectId, peopleObj.id), eq(attributes.slug, "associated_people")))
        .limit(1);
      if (assoc) {
        const links = await db
          .select({ dealId: recordValues.recordId })
          .from(recordValues)
          .where(
            and(
              eq(recordValues.attributeId, assoc.id),
              inArray(recordValues.referencedRecordId, [...personIds])
            )
          );
        for (const link of links) dealIds.add(link.dealId);
      }
    }
  }

  for (const dealId of dealIds) {
    await moveDeal(dealId, input.kontaktart, input.actorId ?? null);
  }
}

export async function updateConversationKlassifikation(input: {
  workspaceId: string;
  conversationId: string;
  kontaktart?: string | null;
  lane?: string | null;
  actorId?: string | null;
}): Promise<boolean> {
  const [current] = await db
    .select({ id: inboxConversations.id, lane: inboxConversations.lane })
    .from(inboxConversations)
    .where(and(eq(inboxConversations.id, input.conversationId), eq(inboxConversations.workspaceId, input.workspaceId)))
    .limit(1);
  if (!current) return false;

  const slug = input.kontaktart != null ? normalizeKontaktart(input.kontaktart) : null;
  if (input.kontaktart != null && !slug) return false;
  if (slug) {
    await applyKontaktart({
      workspaceId: input.workspaceId,
      kontaktart: slug,
      conversationId: input.conversationId,
      actorId: input.actorId,
    });
    if (input.lane && isLeadKunde(slug)) {
      const lane = laneForKontaktart(slug, input.lane);
      await db
        .update(inboxConversations)
        .set({
          lane,
          classifiedBy: "manual",
          classificationReason: "Lane manuell gesetzt",
          updatedAt: new Date(),
        })
        .where(eq(inboxConversations.id, input.conversationId));
    }
    return true;
  }

  if (input.lane) {
    const allowed = ["lead", "info", "spam", "review", "kein_lead"] as const;
    if (!(allowed as readonly string[]).includes(input.lane)) return false;
    await db
      .update(inboxConversations)
      .set({
        lane: input.lane as (typeof allowed)[number],
        classifiedBy: "manual",
        classificationReason: "Lane manuell gesetzt",
        updatedAt: new Date(),
      })
      .where(eq(inboxConversations.id, input.conversationId));
  }
  return true;
}

/** Deal ids that must stay out of lead KPIs. */
export async function loadNonLeadDealIds(workspaceId: string): Promise<Set<string>> {
  const ids = new Set<string>();

  const convs = await db
    .select({ dealId: inboxConversations.dealRecordId, kontaktart: inboxConversations.kontaktart })
    .from(inboxConversations)
    .where(
      and(
        eq(inboxConversations.workspaceId, workspaceId),
        isNotNull(inboxConversations.dealRecordId),
        sql`${inboxConversations.kontaktart} <> ${DEFAULT_KONTAKTART}`
      )
    );
  for (const conv of convs) {
    if (conv.dealId && dealIsNonLead({ conversationKontaktarten: [conv.kontaktart] })) ids.add(conv.dealId);
  }

  const [dealObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  if (dealObj) {
    const [stageAttr] = await db
      .select({ id: attributes.id })
      .from(attributes)
      .where(and(eq(attributes.objectId, dealObj.id), eq(attributes.slug, "stage")))
      .limit(1);
    if (stageAttr) {
      const keinLeadStages = await db
        .select({ id: statuses.id, title: statuses.title, category: statuses.stageCategory })
        .from(statuses)
        .where(eq(statuses.attributeId, stageAttr.id));
      const keinIds = keinLeadStages
        .filter((stage) => dealIsNonLead({ stageCategory: stage.category, stageTitle: stage.title }))
        .map((stage) => stage.id);
      if (keinIds.length > 0) {
        const rows = await db
          .select({ id: recordValues.recordId })
          .from(recordValues)
          .where(and(eq(recordValues.attributeId, stageAttr.id), inArray(recordValues.textValue, keinIds)));
        for (const row of rows) ids.add(row.id);
      }
    }
  }

  const [peopleObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "people")))
    .limit(1);
  if (!peopleObj) return ids;
  const [attr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, peopleObj.id), eq(attributes.slug, KONTAKTART_SLUG)))
    .limit(1);
  if (!attr) return ids;
  const options = await db
    .select({ id: selectOptions.id, title: selectOptions.title })
    .from(selectOptions)
    .where(eq(selectOptions.attributeId, attr.id));
  const nonLeadOptionIds = options
    .filter((option) => !isLeadKunde(option.title))
    .map((option) => option.id);
  const rawSlugs = KONTAKTART_VALUES.filter((slug) => slug !== DEFAULT_KONTAKTART);
  const personRows = await db
    .select({ personId: recordValues.recordId, text: recordValues.textValue })
    .from(recordValues)
    .where(eq(recordValues.attributeId, attr.id));
  const personIds = personRows
    .filter((row) => {
      const text = row.text ?? "";
      return nonLeadOptionIds.includes(text) || (rawSlugs as readonly string[]).includes(text);
    })
    .map((row) => row.personId);
  if (personIds.length === 0) return ids;

  const linked = await db
    .select({ dealId: inboxConversations.dealRecordId })
    .from(inboxConversations)
    .innerJoin(inboxContacts, eq(inboxContacts.id, inboxConversations.contactId))
    .where(and(eq(inboxConversations.workspaceId, workspaceId), inArray(inboxContacts.crmRecordId, personIds)));
  for (const row of linked) if (row.dealId) ids.add(row.dealId);

  if (dealObj) {
    const [assoc] = await db
      .select({ id: attributes.id })
      .from(attributes)
      .where(and(eq(attributes.objectId, dealObj.id), eq(attributes.slug, "associated_people")))
      .limit(1);
    if (assoc) {
      const deals = await db
        .select({ dealId: recordValues.recordId })
        .from(recordValues)
        .where(and(eq(recordValues.attributeId, assoc.id), inArray(recordValues.referencedRecordId, personIds)));
      for (const row of deals) ids.add(row.dealId);
    }
  }
  return ids;
}
