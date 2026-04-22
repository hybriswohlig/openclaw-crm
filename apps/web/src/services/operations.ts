/**
 * Operations view: aggregates non-finalized deals with their linked Auftrag
 * and assigned employees. Single source of truth — pulls from the existing
 * `deals` records, `auftraege` records, and `dealEmployees` table.
 *
 * Used by /operations to render the day-grouped job list with drag-and-drop
 * employee assignment.
 */

import { db } from "@/db";
import { and, eq, inArray } from "drizzle-orm";
import { objects, attributes, statuses, selectOptions } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import { employees, dealEmployees } from "@/db/schema/employees";
import { dealNumbers } from "@/db/schema/financial";

const FINALIZED_STAGE_TITLES = ["done", "paid", "lost"];

export interface OperationsDealRow {
  dealId: string;
  dealNumber: string | null;
  name: string;
  stage: { title: string; color: string } | null;
  moveDate: string | null;
  moveFromAddress: string | null;
  moveToAddress: string | null;
  // Auftrag-derived (or null if no Auftrag yet)
  auftragId: string | null;
  transporter: { id: string; title: string; color: string } | null;
  workerCount: number | null;
  timeStart: string | null;
  timeEnd: string | null;
  // Live assignments from dealEmployees (single source of truth)
  assignedEmployees: Array<{
    assignmentId: string;
    employeeId: string;
    name: string;
    role: string;
    photoBase64: string | null;
  }>;
}

export interface OperationsTransporterOption {
  id: string;
  title: string;
  color: string;
}

export interface OperationsViewModel {
  deals: OperationsDealRow[];
  transporterOptions: OperationsTransporterOption[];
  allEmployees: Array<{ id: string; name: string; photoBase64: string | null; hourlyRate: string }>;
}

export async function getOperationsView(workspaceId: string): Promise<OperationsViewModel> {
  // 1) Resolve deals object + relevant attribute IDs
  const [dealObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
    .limit(1);

  if (!dealObj) {
    return { deals: [], transporterOptions: [], allEmployees: [] };
  }

  const dealAttrs = await db
    .select()
    .from(attributes)
    .where(eq(attributes.objectId, dealObj.id));
  const dealAttrBySlug = new Map(dealAttrs.map((a) => [a.slug, a]));

  // 2) Stage statuses for the Stage attribute
  const stageAttr = dealAttrBySlug.get("stage");
  let stageMap = new Map<string, { title: string; color: string }>();
  let finalizedStageIds: string[] = [];
  if (stageAttr) {
    const stageRows = await db
      .select()
      .from(statuses)
      .where(eq(statuses.attributeId, stageAttr.id));
    stageMap = new Map(stageRows.map((s) => [s.id, { title: s.title, color: s.color }]));
    finalizedStageIds = stageRows
      .filter((s) => FINALIZED_STAGE_TITLES.includes(s.title.toLowerCase()))
      .map((s) => s.id);
  }

  // 3) Pull all deal records
  const dealRecords = await db
    .select({ id: records.id, createdAt: records.createdAt })
    .from(records)
    .where(eq(records.objectId, dealObj.id));

  if (dealRecords.length === 0) {
    return { deals: [], transporterOptions: [], allEmployees: [] };
  }

  const dealIds = dealRecords.map((r) => r.id);

  // 4) Bulk-load relevant deal values (name, stage, move_date, addresses)
  const interestedSlugs = ["name", "stage", "move_date", "move_from_address", "move_to_address"];
  const interestedAttrIds = interestedSlugs
    .map((s) => dealAttrBySlug.get(s)?.id)
    .filter((id): id is string => !!id);

  const dealValueRows = await db
    .select()
    .from(recordValues)
    .where(
      and(inArray(recordValues.recordId, dealIds), inArray(recordValues.attributeId, interestedAttrIds))
    );

  const dealValuesByRecord = new Map<string, Map<string, typeof dealValueRows[number]>>();
  for (const v of dealValueRows) {
    let m = dealValuesByRecord.get(v.recordId);
    if (!m) {
      m = new Map();
      dealValuesByRecord.set(v.recordId, m);
    }
    m.set(v.attributeId, v);
  }

  // 5) Filter to non-finalized deals
  const filteredDealIds = dealRecords
    .map((r) => r.id)
    .filter((id) => {
      if (!stageAttr) return true;
      const v = dealValuesByRecord.get(id)?.get(stageAttr.id);
      const stageId = v?.textValue ?? null;
      return stageId === null || !finalizedStageIds.includes(stageId);
    });

  if (filteredDealIds.length === 0) {
    const transporterOptions = await loadTransporterOptions(workspaceId);
    const allEmployees = await loadAllEmployees(workspaceId);
    return { deals: [], transporterOptions, allEmployees };
  }

  // 6) Deal numbers
  const dealNumberRows = await db
    .select()
    .from(dealNumbers)
    .where(inArray(dealNumbers.dealRecordId, filteredDealIds));
  const dealNumberByDeal = new Map(dealNumberRows.map((d) => [d.dealRecordId, d.dealNumber]));

  // 7) Auftraege records linked to these deals
  const [auftragObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "auftraege")))
    .limit(1);

  let auftragByDealId = new Map<string, { auftragId: string; values: Map<string, typeof recordValues.$inferSelect> }>();
  let transporterOptionMap = new Map<string, { id: string; title: string; color: string }>();
  let auftragAttrIds: {
    transporterAttrId: string | null;
    workerCountAttrId: string | null;
    timeStartAttrId: string | null;
    timeEndAttrId: string | null;
  } | null = null;

  if (auftragObj) {
    const auftragAttrs = await db
      .select()
      .from(attributes)
      .where(eq(attributes.objectId, auftragObj.id));
    const auftragAttrBySlug = new Map(auftragAttrs.map((a) => [a.slug, a]));
    const dealRefAttr = auftragAttrBySlug.get("deal");
    const transporterAttr = auftragAttrBySlug.get("transporter");
    const workerCountAttr = auftragAttrBySlug.get("worker_count");
    const timeStartAttr = auftragAttrBySlug.get("time_window_start");
    const timeEndAttr = auftragAttrBySlug.get("time_window_end");

    if (dealRefAttr) {
      const auftragLinks = await db
        .select({
          recordId: recordValues.recordId,
          referencedRecordId: recordValues.referencedRecordId,
        })
        .from(recordValues)
        .innerJoin(records, eq(records.id, recordValues.recordId))
        .where(
          and(
            eq(records.objectId, auftragObj.id),
            eq(recordValues.attributeId, dealRefAttr.id),
            inArray(recordValues.referencedRecordId, filteredDealIds)
          )
        );

      const auftragIds = auftragLinks.map((l) => l.recordId);
      if (auftragIds.length > 0) {
        const auftragValueRows = await db
          .select()
          .from(recordValues)
          .where(inArray(recordValues.recordId, auftragIds));

        const valuesByAuftragId = new Map<string, Map<string, typeof recordValues.$inferSelect>>();
        for (const v of auftragValueRows) {
          let m = valuesByAuftragId.get(v.recordId);
          if (!m) {
            m = new Map();
            valuesByAuftragId.set(v.recordId, m);
          }
          m.set(v.attributeId, v);
        }

        for (const link of auftragLinks) {
          if (!link.referencedRecordId) continue;
          auftragByDealId.set(link.referencedRecordId, {
            auftragId: link.recordId,
            values: valuesByAuftragId.get(link.recordId) ?? new Map(),
          });
        }
      }

      // Load transporter options for the dropdown
      if (transporterAttr) {
        const optRows = await db
          .select()
          .from(selectOptions)
          .where(eq(selectOptions.attributeId, transporterAttr.id));
        for (const o of optRows) {
          transporterOptionMap.set(o.id, { id: o.id, title: o.title, color: o.color });
        }
      }
    }

    auftragAttrIds = {
      transporterAttrId: transporterAttr?.id ?? null,
      workerCountAttrId: workerCountAttr?.id ?? null,
      timeStartAttrId: timeStartAttr?.id ?? null,
      timeEndAttrId: timeEndAttr?.id ?? null,
    };
  }

  // 8) dealEmployees + employee details
  const dealEmpRows = await db
    .select({
      assignmentId: dealEmployees.id,
      dealRecordId: dealEmployees.dealRecordId,
      employeeId: dealEmployees.employeeId,
      role: dealEmployees.role,
      employeeName: employees.name,
      photoBase64: employees.photoBase64,
    })
    .from(dealEmployees)
    .innerJoin(employees, eq(employees.id, dealEmployees.employeeId))
    .where(inArray(dealEmployees.dealRecordId, filteredDealIds));

  const dealEmpByDeal = new Map<string, OperationsDealRow["assignedEmployees"]>();
  for (const r of dealEmpRows) {
    const arr = dealEmpByDeal.get(r.dealRecordId) ?? [];
    arr.push({
      assignmentId: r.assignmentId,
      employeeId: r.employeeId,
      name: r.employeeName,
      role: r.role,
      photoBase64: r.photoBase64,
    });
    dealEmpByDeal.set(r.dealRecordId, arr);
  }

  // 9) Build the view rows
  const nameAttrId = dealAttrBySlug.get("name")?.id;
  const moveDateAttrId = dealAttrBySlug.get("move_date")?.id;
  const moveFromAttrId = dealAttrBySlug.get("move_from_address")?.id;
  const moveToAttrId = dealAttrBySlug.get("move_to_address")?.id;

  const rows: OperationsDealRow[] = filteredDealIds.map((dealId) => {
    const dvals = dealValuesByRecord.get(dealId);
    const stageId = stageAttr ? dvals?.get(stageAttr.id)?.textValue ?? null : null;
    const stage = stageId ? stageMap.get(stageId) ?? null : null;
    const auftragInfo = auftragByDealId.get(dealId) ?? null;

    let transporter: OperationsDealRow["transporter"] = null;
    let workerCount: number | null = null;
    let timeStart: string | null = null;
    let timeEnd: string | null = null;

    if (auftragInfo && auftragAttrIds) {
      if (auftragAttrIds.transporterAttrId) {
        const v = auftragInfo.values.get(auftragAttrIds.transporterAttrId);
        const optId = v?.textValue ?? null;
        transporter = optId ? transporterOptionMap.get(optId) ?? null : null;
      }
      if (auftragAttrIds.workerCountAttrId) {
        const v = auftragInfo.values.get(auftragAttrIds.workerCountAttrId);
        workerCount = v?.numberValue != null ? Number(v.numberValue) : null;
      }
      if (auftragAttrIds.timeStartAttrId) {
        const v = auftragInfo.values.get(auftragAttrIds.timeStartAttrId);
        timeStart = v?.timestampValue ? new Date(v.timestampValue).toISOString() : null;
      }
      if (auftragAttrIds.timeEndAttrId) {
        const v = auftragInfo.values.get(auftragAttrIds.timeEndAttrId);
        timeEnd = v?.timestampValue ? new Date(v.timestampValue).toISOString() : null;
      }
    }

    const moveFromVal = moveFromAttrId ? dvals?.get(moveFromAttrId)?.jsonValue : null;
    const moveToVal = moveToAttrId ? dvals?.get(moveToAttrId)?.jsonValue : null;

    return {
      dealId,
      dealNumber: dealNumberByDeal.get(dealId) ?? null,
      name: nameAttrId ? dvals?.get(nameAttrId)?.textValue ?? "Unbenannt" : "Unbenannt",
      stage,
      moveDate: moveDateAttrId ? dvals?.get(moveDateAttrId)?.dateValue ?? null : null,
      moveFromAddress: extractLocationLine(moveFromVal),
      moveToAddress: extractLocationLine(moveToVal),
      auftragId: auftragInfo?.auftragId ?? null,
      transporter,
      workerCount,
      timeStart,
      timeEnd,
      assignedEmployees: dealEmpByDeal.get(dealId) ?? [],
    };
  });

  // Sort: scheduled first by date asc, unscheduled last
  rows.sort((a, b) => {
    if (a.moveDate && !b.moveDate) return -1;
    if (!a.moveDate && b.moveDate) return 1;
    if (a.moveDate && b.moveDate) return a.moveDate.localeCompare(b.moveDate);
    return a.name.localeCompare(b.name);
  });

  const transporterOptions = Array.from(transporterOptionMap.values());
  const allEmployees = await loadAllEmployees(workspaceId);

  return { deals: rows, transporterOptions, allEmployees };
}

function extractLocationLine(val: unknown): string | null {
  if (!val || typeof val !== "object") return null;
  const obj = val as Record<string, unknown>;
  const parts = [obj.line1, obj.postcode, obj.city].filter(Boolean) as string[];
  return parts.length ? parts.join(", ") : (typeof obj.line1 === "string" ? obj.line1 : null);
}

async function loadTransporterOptions(workspaceId: string): Promise<OperationsTransporterOption[]> {
  const [auftragObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "auftraege")))
    .limit(1);
  if (!auftragObj) return [];
  const [transAttr] = await db
    .select()
    .from(attributes)
    .where(and(eq(attributes.objectId, auftragObj.id), eq(attributes.slug, "transporter")))
    .limit(1);
  if (!transAttr) return [];
  const opts = await db
    .select()
    .from(selectOptions)
    .where(eq(selectOptions.attributeId, transAttr.id));
  return opts.map((o) => ({ id: o.id, title: o.title, color: o.color }));
}

async function loadAllEmployees(workspaceId: string) {
  return db
    .select({
      id: employees.id,
      name: employees.name,
      photoBase64: employees.photoBase64,
      hourlyRate: employees.hourlyRate,
    })
    .from(employees)
    .where(eq(employees.workspaceId, workspaceId))
    .orderBy(employees.name);
}
