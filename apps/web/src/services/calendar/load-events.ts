import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { attributes, objects, statuses } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import {
  customerDateSelections,
  operatingCompanyPortalSettings,
  quotationDateOffers,
} from "@/db/schema/customer-portal";
import { companyColor, companySortKey } from "./companies";
import { asIsoDate, asTimestampIso, plusDays } from "./dates";
import {
  addressText,
  appointmentLabel,
  classifyDealDateAttribute,
  eventsFromDeal,
  filterCalendarEvents,
  isEstimateAttribute,
  isLostOrCancelledStage,
  sortCalendarEvents,
  type CalendarCompany,
  type CalendarStage,
  type DealAppointmentInput,
  type DealCalendarInput,
} from "./map-events";
import type { CalendarQuery } from "./query";

export interface CalendarBundle {
  events: ReturnType<typeof sortCalendarEvents>;
  companies: CalendarCompany[];
  stages: CalendarStage[];
  from: string;
  to: string;
}

type ValueRow = typeof recordValues.$inferSelect;

function indexByRecord(rows: ValueRow[]): Map<string, Map<string, ValueRow>> {
  const out = new Map<string, Map<string, ValueRow>>();
  for (const row of rows) {
    let byAttr = out.get(row.recordId);
    if (!byAttr) {
      byAttr = new Map();
      out.set(row.recordId, byAttr);
    }
    const prev = byAttr.get(row.attributeId);
    if (!prev || row.sortOrder < prev.sortOrder) byAttr.set(row.attributeId, row);
  }
  return out;
}

async function liveDealIds(objectId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: records.id })
    .from(records)
    .where(and(inArray(records.id, ids), eq(records.objectId, objectId), isNull(records.deletedAt)));
  return rows.map((row) => row.id);
}

export async function listCalendarEvents(
  workspaceId: string,
  query: CalendarQuery
): Promise<CalendarBundle> {
  const empty: CalendarBundle = {
    events: [],
    companies: [],
    stages: [],
    from: query.from,
    to: query.to,
  };

  const [dealObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  if (!dealObj) return empty;

  const dealAttrs = await db.select().from(attributes).where(eq(attributes.objectId, dealObj.id));
  const attrBySlug = new Map(dealAttrs.map((attr) => [attr.slug, attr]));
  const attrById = new Map(dealAttrs.map((attr) => [attr.id, attr]));

  const stageAttr = attrBySlug.get("stage");
  let stageRows: Array<typeof statuses.$inferSelect> = [];
  if (stageAttr) {
    stageRows = await db.select().from(statuses).where(eq(statuses.attributeId, stageAttr.id));
  }
  const stageById = new Map(stageRows.map((stage) => [stage.id, stage]));
  const stages: CalendarStage[] = stageRows
    .map((stage) => ({
      id: stage.id,
      title: stage.title,
      color: stage.color,
      sortOrder: stage.sortOrder,
      excludedByDefault: isLostOrCancelledStage({
        title: stage.title,
        stageCategory: stage.stageCategory,
      }),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, "de"));

  const companies = await loadCompanies(workspaceId);
  const companyById = new Map(companies.map((company) => [company.id, company]));

  const dateAttrIds = dealAttrs
    .filter((attr) => {
      if (attr.type !== "date" && attr.type !== "timestamp") return false;
      return classifyDealDateAttribute(attr.slug, attr.title) !== "ignore";
    })
    .map((attr) => attr.id);

  const expandedFrom = plusDays(query.from, -14);
  const expandedTo = plusDays(query.to, 14);
  const candidate = new Set<string>();

  if (dateAttrIds.length > 0) {
    const dated = await db
      .select({ recordId: recordValues.recordId })
      .from(recordValues)
      .innerJoin(records, eq(records.id, recordValues.recordId))
      .where(
        and(
          eq(records.objectId, dealObj.id),
          isNull(records.deletedAt),
          inArray(recordValues.attributeId, dateAttrIds),
          gte(recordValues.dateValue, expandedFrom),
          lte(recordValues.dateValue, expandedTo)
        )
      );
    for (const row of dated) candidate.add(row.recordId);

    const stamped = await db
      .select({ recordId: recordValues.recordId })
      .from(recordValues)
      .innerJoin(records, eq(records.id, recordValues.recordId))
      .where(
        and(
          eq(records.objectId, dealObj.id),
          isNull(records.deletedAt),
          inArray(recordValues.attributeId, dateAttrIds),
          gte(recordValues.timestampValue, new Date(`${expandedFrom}T00:00:00.000Z`)),
          lte(recordValues.timestampValue, new Date(`${expandedTo}T23:59:59.999Z`))
        )
      );
    for (const row of stamped) candidate.add(row.recordId);
  }

  const offersInRange = await db
    .select({ dealRecordId: quotationDateOffers.dealRecordId })
    .from(quotationDateOffers)
    .where(
      and(
        eq(quotationDateOffers.workspaceId, workspaceId),
        gte(quotationDateOffers.offerDate, expandedFrom),
        lte(quotationDateOffers.offerDate, expandedTo)
      )
    );
  for (const id of await liveDealIds(
    dealObj.id,
    offersInRange.map((row) => row.dealRecordId)
  )) {
    candidate.add(id);
  }

  const selectionsInRange = await db
    .select({ dealRecordId: customerDateSelections.dealRecordId })
    .from(customerDateSelections)
    .where(
      and(
        eq(customerDateSelections.workspaceId, workspaceId),
        gte(customerDateSelections.selectedDate, expandedFrom),
        lte(customerDateSelections.selectedDate, expandedTo)
      )
    );
  for (const id of await liveDealIds(
    dealObj.id,
    selectionsInRange.map((row) => row.dealRecordId)
  )) {
    candidate.add(id);
  }

  const auftragTimes = await loadAuftragTimes(workspaceId, expandedFrom, expandedTo);
  for (const dealId of auftragTimes.dealIdsInRange) candidate.add(dealId);

  const dealIds = [...candidate];
  if (dealIds.length === 0) {
    return { ...empty, companies, stages };
  }

  const dealRows = await db
    .select({ id: records.id, updatedAt: records.updatedAt })
    .from(records)
    .where(and(inArray(records.id, dealIds), eq(records.objectId, dealObj.id), isNull(records.deletedAt)));

  const liveIds = dealRows.map((row) => row.id);
  const updatedAtById = new Map(dealRows.map((row) => [row.id, row.updatedAt.toISOString()]));
  if (liveIds.length === 0) return { ...empty, companies, stages };

  const wantedAttrIds = dealAttrs
    .filter((attr) => {
      if (["name", "stage", "operating_company", "move_from_address", "move_to_address"].includes(attr.slug)) {
        return true;
      }
      if (attr.type === "checkbox" && isEstimateAttribute(attr.slug, attr.title)) return true;
      if (attr.type === "date" || attr.type === "timestamp") {
        return classifyDealDateAttribute(attr.slug, attr.title) !== "ignore";
      }
      return false;
    })
    .map((attr) => attr.id);

  const valueRows =
    wantedAttrIds.length === 0
      ? []
      : await db
          .select()
          .from(recordValues)
          .where(
            and(inArray(recordValues.recordId, liveIds), inArray(recordValues.attributeId, wantedAttrIds))
          );
  const values = indexByRecord(valueRows);

  const offers = await db
    .select()
    .from(quotationDateOffers)
    .where(
      and(eq(quotationDateOffers.workspaceId, workspaceId), inArray(quotationDateOffers.dealRecordId, liveIds))
    );
  const offersByDeal = new Map<string, typeof offers>();
  for (const offer of offers) {
    const list = offersByDeal.get(offer.dealRecordId) ?? [];
    list.push(offer);
    offersByDeal.set(offer.dealRecordId, list);
  }

  const selections = await db
    .select()
    .from(customerDateSelections)
    .where(
      and(
        eq(customerDateSelections.workspaceId, workspaceId),
        inArray(customerDateSelections.dealRecordId, liveIds)
      )
    );
  const selectionByDeal = new Map(selections.map((row) => [row.dealRecordId, row]));

  const windowsForDeals = await loadAuftragTimesForDeals(workspaceId, liveIds);

  const inputs: DealCalendarInput[] = liveIds.map((dealId) => {
    const byAttr = values.get(dealId) ?? new Map<string, ValueRow>();
    const read = (slug: string) => {
      const attr = attrBySlug.get(slug);
      return attr ? byAttr.get(attr.id) : undefined;
    };

    const stageId = read("stage")?.textValue ?? null;
    const stage = stageId ? stageById.get(stageId) : undefined;
    const companyId = read("operating_company")?.referencedRecordId ?? null;
    const company = companyId ? companyById.get(companyId) : undefined;

    let moveDate: string | null = null;
    let moveEndDate: string | null = null;
    let estimatedFlag = false;
    const appointments: DealAppointmentInput[] = [];

    for (const [attrId, value] of byAttr) {
      const attr = attrById.get(attrId);
      if (!attr) continue;
      if (attr.type === "checkbox" && isEstimateAttribute(attr.slug, attr.title) && value.booleanValue) {
        estimatedFlag = true;
      }
      const kind = classifyDealDateAttribute(attr.slug, attr.title);
      if (kind === "ignore") continue;
      const date = asIsoDate(value.dateValue) ?? (value.timestampValue ? asIsoDate(value.timestampValue) : null);
      if (!date) continue;
      const clock = value.timestampValue
        ? asTimestampIso(value.timestampValue)
        : null;
      if (kind === "move" && !moveDate) moveDate = date;
      else if (kind === "move_end") moveEndDate = date;
      else if (kind === "appointment") {
        appointments.push({
          slug: attr.slug,
          label: appointmentLabel(attr.slug, attr.title),
          date,
          endDate: null,
          startTime: clock,
          endTime: null,
        });
      }
    }

    const selection = selectionByDeal.get(dealId);
    let slotStart: string | null = null;
    let slotEnd: string | null = null;
    if (!moveDate && selection) {
      moveDate = asIsoDate(selection.selectedDate);
      slotStart = selection.selectedSlotStart;
      slotEnd = selection.selectedSlotEnd;
    } else if (selection) {
      slotStart = selection.selectedSlotStart;
      slotEnd = selection.selectedSlotEnd;
    }

    const proposal = moveDate ? null : pickProposal(offersByDeal.get(dealId) ?? []);
    const window = windowsForDeals.get(dealId) ?? auftragTimes.byDeal.get(dealId) ?? null;

    return {
      dealId,
      customerName: read("name")?.textValue?.trim() || "Ohne Namen",
      stageId,
      stageTitle: stage?.title ?? null,
      stageColor: stage?.color ?? null,
      stageExcluded: stage
        ? isLostOrCancelledStage({ title: stage.title, stageCategory: stage.stageCategory })
        : false,
      companyId,
      companyName: company?.name ?? null,
      companyColor: company?.color ?? companyColor(companyId, null, null),
      fromAddress: addressText(read("move_from_address")?.jsonValue ?? read("move_from_address")?.textValue),
      toAddress: addressText(read("move_to_address")?.jsonValue ?? read("move_to_address")?.textValue),
      moveDate,
      moveEndDate,
      timeStart: window?.start ?? null,
      timeEnd: window?.end ?? null,
      slotStart,
      slotEnd,
      estimatedFlag,
      proposedDate: proposal?.date ?? null,
      proposedStart: proposal?.start ?? null,
      proposedEnd: proposal?.end ?? null,
      appointments,
      updatedAt: updatedAtById.get(dealId) ?? null,
    };
  });

  const events = sortCalendarEvents(
    filterCalendarEvents(inputs.flatMap(eventsFromDeal), query)
  );
  return { events, companies, stages, from: query.from, to: query.to };
}

function pickProposal(
  offers: Array<typeof quotationDateOffers.$inferSelect>
): { date: string; start: string | null; end: string | null } | null {
  if (offers.length === 0) return null;
  const sorted = [...offers].sort((a, b) => {
    if (a.isRecommended !== b.isRecommended) return a.isRecommended ? -1 : 1;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    const ad = asIsoDate(a.offerDate) ?? "";
    const bd = asIsoDate(b.offerDate) ?? "";
    return ad.localeCompare(bd);
  });
  const top = sorted[0];
  const date = asIsoDate(top.offerDate);
  if (!date) return null;
  const slot = top.slots?.[0];
  return { date, start: slot?.startTime ?? null, end: slot?.endTime ?? null };
}

async function loadCompanies(workspaceId: string): Promise<CalendarCompany[]> {
  const [obj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "operating_companies")))
    .limit(1);
  if (!obj) return [];

  const [nameAttr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, obj.id), eq(attributes.slug, "name")))
    .limit(1);
  if (!nameAttr) return [];

  const rows = await db
    .select({ id: records.id, name: recordValues.textValue })
    .from(records)
    .innerJoin(
      recordValues,
      and(eq(recordValues.recordId, records.id), eq(recordValues.attributeId, nameAttr.id))
    )
    .where(and(eq(records.objectId, obj.id), isNull(records.deletedAt)));

  const settings = await db
    .select({
      id: operatingCompanyPortalSettings.operatingCompanyRecordId,
      color: operatingCompanyPortalSettings.primaryColor,
    })
    .from(operatingCompanyPortalSettings)
    .where(eq(operatingCompanyPortalSettings.workspaceId, workspaceId));
  const colorById = new Map(settings.map((row) => [row.id, row.color]));

  return rows
    .map((row) => {
      const name = row.name?.trim() || "Ohne Namen";
      return {
        id: row.id,
        name,
        color: companyColor(row.id, name, colorById.get(row.id) ?? null),
      };
    })
    .sort((a, b) => companySortKey(a.id) - companySortKey(b.id) || a.name.localeCompare(b.name, "de"));
}

interface AuftragWindow {
  start: string | null;
  end: string | null;
}

async function auftragMeta(workspaceId: string) {
  const [auftragObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "auftraege")))
    .limit(1);
  if (!auftragObj) return null;
  const attrs = await db.select().from(attributes).where(eq(attributes.objectId, auftragObj.id));
  const bySlug = new Map(attrs.map((attr) => [attr.slug, attr]));
  const deal = bySlug.get("deal");
  const start = bySlug.get("time_window_start");
  const end = bySlug.get("time_window_end");
  if (!deal) return null;
  return { objectId: auftragObj.id, dealAttrId: deal.id, startAttrId: start?.id ?? null, endAttrId: end?.id ?? null };
}

async function loadAuftragTimes(workspaceId: string, from: string, to: string): Promise<{
  dealIdsInRange: string[];
  byDeal: Map<string, AuftragWindow>;
}> {
  const meta = await auftragMeta(workspaceId);
  if (!meta?.startAttrId) return { dealIdsInRange: [], byDeal: new Map() };

  const hits = await db
    .select({ recordId: recordValues.recordId })
    .from(recordValues)
    .innerJoin(records, eq(records.id, recordValues.recordId))
    .where(
      and(
        eq(records.objectId, meta.objectId),
        isNull(records.deletedAt),
        eq(recordValues.attributeId, meta.startAttrId),
        gte(recordValues.timestampValue, new Date(`${from}T00:00:00.000Z`)),
        lte(recordValues.timestampValue, new Date(`${to}T23:59:59.999Z`))
      )
    );
  const auftragIds = [...new Set(hits.map((row) => row.recordId))];
  if (auftragIds.length === 0) return { dealIdsInRange: [], byDeal: new Map() };

  const links = await db
    .select({
      auftragId: recordValues.recordId,
      dealId: recordValues.referencedRecordId,
    })
    .from(recordValues)
    .where(
      and(eq(recordValues.attributeId, meta.dealAttrId), inArray(recordValues.recordId, auftragIds))
    );

  const dealByAuftrag = new Map(
    links.filter((row) => row.dealId).map((row) => [row.auftragId, row.dealId as string])
  );
  const windows = await windowsForAuftraege(meta, [...dealByAuftrag.keys()]);
  const byDeal = new Map<string, AuftragWindow>();
  for (const [auftragId, window] of windows) {
    const dealId = dealByAuftrag.get(auftragId);
    if (dealId && !byDeal.has(dealId)) byDeal.set(dealId, window);
  }
  return { dealIdsInRange: [...byDeal.keys()], byDeal };
}

async function loadAuftragTimesForDeals(
  workspaceId: string,
  dealIds: string[]
): Promise<Map<string, AuftragWindow>> {
  const meta = await auftragMeta(workspaceId);
  if (!meta || dealIds.length === 0) return new Map();

  const links = await db
    .select({
      auftragId: recordValues.recordId,
      dealId: recordValues.referencedRecordId,
    })
    .from(recordValues)
    .innerJoin(records, eq(records.id, recordValues.recordId))
    .where(
      and(
        eq(records.objectId, meta.objectId),
        isNull(records.deletedAt),
        eq(recordValues.attributeId, meta.dealAttrId),
        inArray(recordValues.referencedRecordId, dealIds)
      )
    );

  const dealByAuftrag = new Map<string, string>();
  for (const link of links) {
    if (link.dealId) dealByAuftrag.set(link.auftragId, link.dealId);
  }
  const windows = await windowsForAuftraege(meta, [...dealByAuftrag.keys()]);
  const byDeal = new Map<string, AuftragWindow>();
  for (const [auftragId, window] of windows) {
    const dealId = dealByAuftrag.get(auftragId);
    if (!dealId) continue;
    const prev = byDeal.get(dealId);
    if (!prev || (!prev.start && window.start)) byDeal.set(dealId, window);
  }
  return byDeal;
}

async function windowsForAuftraege(
  meta: { startAttrId: string | null; endAttrId: string | null },
  auftragIds: string[]
): Promise<Map<string, AuftragWindow>> {
  const out = new Map<string, AuftragWindow>();
  if (auftragIds.length === 0) return out;
  const attrIds = [meta.startAttrId, meta.endAttrId].filter((id): id is string => Boolean(id));
  if (attrIds.length === 0) return out;
  const rows = await db
    .select()
    .from(recordValues)
    .where(and(inArray(recordValues.recordId, auftragIds), inArray(recordValues.attributeId, attrIds)));
  for (const row of rows) {
    const current = out.get(row.recordId) ?? { start: null, end: null };
    const iso = asTimestampIso(row.timestampValue);
    if (row.attributeId === meta.startAttrId) current.start = iso;
    if (row.attributeId === meta.endAttrId) current.end = iso;
    out.set(row.recordId, current);
  }
  return out;
}
