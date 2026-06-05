import { db } from "@/db";
import {
  dealEmployees,
  dealNumbers,
  records,
  recordValues,
  attributes,
  objects,
  statuses,
  quotations,
  quotationLineItems,
  payments,
  expenses,
  employeeTimeEntries,
  jobMedia,
} from "@/db/schema";
import { eq, and, inArray, desc } from "drizzle-orm";

// ─── Employee Portal data adapter ───────────────────────────────────────────────
// Loads only what an assigned employee may see for their jobs. Authorization is
// enforced by the callers (employee-portal-auth); here we always scope by
// workspaceId + the employee's deal_employees assignments.

function locationLine(val: unknown): string | null {
  let obj: unknown = val;
  if (typeof obj === "string") {
    const s = obj.trim();
    if (!s) return null;
    try {
      obj = JSON.parse(s);
    } catch {
      return s;
    }
  }
  if (obj && typeof obj === "object") {
    const v = obj as Record<string, unknown>;
    const parts = [v.line1, v.postcode, v.city].filter(
      (x): x is string => typeof x === "string" && x.length > 0
    );
    return parts.length ? parts.join(", ") : null;
  }
  return null;
}

export interface MyJobRow {
  dealRecordId: string;
  dealNumber: string | null;
  dealName: string;
  role: string;
  isLead: boolean;
  moveDate: string | null;
  stage: { title: string; color: string } | null;
  moveFrom: string | null;
  moveTo: string | null;
}

const DEAL_SLUGS = [
  "name",
  "stage",
  "move_date",
  "move_from_address",
  "move_to_address",
  "operating_company",
  "customer_name",
  "customer_phone",
] as const;

async function loadDealObject(workspaceId: string) {
  const [dealObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  if (!dealObj) return null;
  const attrRows = await db
    .select()
    .from(attributes)
    .where(
      and(
        eq(attributes.objectId, dealObj.id),
        inArray(attributes.slug, DEAL_SLUGS as unknown as string[])
      )
    );
  const attrBySlug = new Map(attrRows.map((a) => [a.slug, a]));
  return { dealObjId: dealObj.id, attrBySlug };
}

async function loadDealValues(
  workspaceId: string,
  dealIds: string[]
): Promise<Map<string, Map<string, (typeof recordValues.$inferSelect)>>> {
  const map = new Map<string, Map<string, typeof recordValues.$inferSelect>>();
  if (!dealIds.length) return map;
  const meta = await loadDealObject(workspaceId);
  if (!meta) return map;
  const attrIds = [...meta.attrBySlug.values()].map((a) => a.id);
  if (!attrIds.length) return map;
  const vals = await db
    .select()
    .from(recordValues)
    .where(
      and(
        inArray(recordValues.recordId, dealIds),
        inArray(recordValues.attributeId, attrIds)
      )
    );
  for (const v of vals) {
    let m = map.get(v.recordId);
    if (!m) {
      m = new Map();
      map.set(v.recordId, m);
    }
    m.set(v.attributeId, v);
  }
  return map;
}

/** Jobs the employee is assigned to (newest first). */
export async function listMyJobs(
  workspaceId: string,
  employeeId: string
): Promise<MyJobRow[]> {
  const assignments = await db
    .select()
    .from(dealEmployees)
    .where(eq(dealEmployees.employeeId, employeeId))
    .orderBy(desc(dealEmployees.createdAt));
  const dealIds = [...new Set(assignments.map((a) => a.dealRecordId))];
  if (!dealIds.length) return [];

  const meta = await loadDealObject(workspaceId);
  const valueMap = await loadDealValues(workspaceId, dealIds);

  // Stage labels
  let stageMap = new Map<string, { title: string; color: string }>();
  const stageAttr = meta?.attrBySlug.get("stage");
  if (stageAttr) {
    const stageRows = await db
      .select()
      .from(statuses)
      .where(eq(statuses.attributeId, stageAttr.id));
    stageMap = new Map(stageRows.map((s) => [s.id, { title: s.title, color: s.color }]));
  }

  const numbers = await db
    .select()
    .from(dealNumbers)
    .where(inArray(dealNumbers.dealRecordId, dealIds));
  const numByDeal = new Map(numbers.map((n) => [n.dealRecordId, n.dealNumber]));

  const get = (dealId: string, slug: string) => {
    const a = meta?.attrBySlug.get(slug);
    if (!a) return undefined;
    return valueMap.get(dealId)?.get(a.id);
  };

  return assignments.map((a) => {
    const stageId = get(a.dealRecordId, "stage")?.textValue ?? null;
    return {
      dealRecordId: a.dealRecordId,
      dealNumber: numByDeal.get(a.dealRecordId) ?? null,
      dealName: get(a.dealRecordId, "name")?.textValue ?? "Auftrag",
      role: a.role,
      isLead: a.role === "lead",
      moveDate: get(a.dealRecordId, "move_date")?.dateValue ?? null,
      stage: stageId ? stageMap.get(stageId) ?? null : null,
      moveFrom: locationLine(get(a.dealRecordId, "move_from_address")?.jsonValue ?? get(a.dealRecordId, "move_from_address")?.textValue),
      moveTo: locationLine(get(a.dealRecordId, "move_to_address")?.jsonValue ?? get(a.dealRecordId, "move_to_address")?.textValue),
    };
  });
}

export interface JobInventoryItem {
  type: string;
  description: string | null;
  quantity: number;
  unitRate: string;
}

export interface JobMediaRow {
  id: string;
  category: string;
  contentType: string;
  caption: string | null;
  createdAt: string;
  isVideo: boolean;
  isImage: boolean;
}

export interface JobTimeEntry {
  id: string;
  date: string;
  startAt: string;
  endAt: string | null;
  breakMinutes: number;
  status: string;
}

export interface EmployeeJobDetail {
  dealRecordId: string;
  dealNumber: string | null;
  dealName: string;
  role: string;
  isLead: boolean;
  moveDate: string | null;
  moveFrom: string | null;
  moveTo: string | null;
  customerName: string | null;
  customerPhone: string | null;
  /** "fixed" | "hourly" — drives the Kassieren flow. */
  priceModel: "fixed" | "hourly" | "unknown";
  fixedPrice: string | null;
  summary: string | null;
  inventory: JobInventoryItem[];
  paymentPreference: string | null;
  /** Gross price / paid / outstanding in EUR (best-effort). */
  payment: { price: number; paid: number; outstanding: number };
  myTimeEntries: JobTimeEntry[];
  media: JobMediaRow[];
}

/** Returns null when the employee is not assigned to this deal (authorization). */
export async function getEmployeeJobDetail(
  workspaceId: string,
  employeeId: string,
  dealRecordId: string
): Promise<EmployeeJobDetail | null> {
  const [assignment] = await db
    .select()
    .from(dealEmployees)
    .where(
      and(
        eq(dealEmployees.dealRecordId, dealRecordId),
        eq(dealEmployees.employeeId, employeeId)
      )
    )
    .limit(1);
  if (!assignment) return null;

  const meta = await loadDealObject(workspaceId);
  const valueMap = await loadDealValues(workspaceId, [dealRecordId]);
  const get = (slug: string) => {
    const a = meta?.attrBySlug.get(slug);
    if (!a) return undefined;
    return valueMap.get(dealRecordId)?.get(a.id);
  };

  const [number] = await db
    .select()
    .from(dealNumbers)
    .where(eq(dealNumbers.dealRecordId, dealRecordId))
    .limit(1);

  // Quotation = inventory + price model + payment preference
  const [q] = await db
    .select()
    .from(quotations)
    .where(eq(quotations.dealRecordId, dealRecordId))
    .limit(1);
  let inventory: JobInventoryItem[] = [];
  if (q) {
    const items = await db
      .select()
      .from(quotationLineItems)
      .where(eq(quotationLineItems.quotationId, q.id))
      .orderBy(quotationLineItems.sortOrder);
    inventory = items.map((i) => ({
      type: i.type,
      description: i.description,
      quantity: i.quantity,
      unitRate: i.unitRate,
    }));
  }
  const priceModel: "fixed" | "hourly" | "unknown" = q
    ? q.isVariable
      ? "hourly"
      : "fixed"
    : "unknown";

  // Payment state (best-effort): fixedPrice vs sum of line items, minus payments.
  const paymentRows = await db
    .select({ amount: payments.amount })
    .from(payments)
    .where(eq(payments.dealRecordId, dealRecordId));
  const paid = paymentRows.reduce((s, p) => s + Number(p.amount), 0);
  let price = 0;
  if (q?.fixedPrice) price = Number(q.fixedPrice);
  else if (inventory.length)
    price = inventory.reduce((s, i) => s + i.quantity * Number(i.unitRate), 0);

  const timeEntries = await db
    .select()
    .from(employeeTimeEntries)
    .where(
      and(
        eq(employeeTimeEntries.employeeId, employeeId),
        eq(employeeTimeEntries.dealRecordId, dealRecordId)
      )
    )
    .orderBy(desc(employeeTimeEntries.startAt));

  const media = await db
    .select()
    .from(jobMedia)
    .where(eq(jobMedia.dealRecordId, dealRecordId))
    .orderBy(desc(jobMedia.createdAt));

  void expenses; // expenses surfaced via the expense API, not needed inline here

  return {
    dealRecordId,
    dealNumber: number?.dealNumber ?? null,
    dealName: get("name")?.textValue ?? "Auftrag",
    role: assignment.role,
    isLead: assignment.role === "lead",
    moveDate: get("move_date")?.dateValue ?? null,
    moveFrom: locationLine(get("move_from_address")?.jsonValue ?? get("move_from_address")?.textValue),
    moveTo: locationLine(get("move_to_address")?.jsonValue ?? get("move_to_address")?.textValue),
    customerName: get("customer_name")?.textValue ?? null,
    customerPhone: get("customer_phone")?.textValue ?? null,
    priceModel,
    fixedPrice: q?.fixedPrice ?? null,
    summary: q?.summary ?? null,
    inventory,
    paymentPreference: q?.paymentMethodPreference ?? null,
    payment: { price, paid, outstanding: Math.max(0, price - paid) },
    myTimeEntries: timeEntries.map((t) => ({
      id: t.id,
      date: t.date,
      startAt: t.startAt.toISOString(),
      endAt: t.endAt ? t.endAt.toISOString() : null,
      breakMinutes: t.breakMinutes,
      status: t.status,
    })),
    media: media.map((m) => ({
      id: m.id,
      category: m.category,
      contentType: m.contentType,
      caption: m.caption,
      createdAt: m.createdAt.toISOString(),
      isVideo: m.contentType.startsWith("video/"),
      isImage: m.contentType.startsWith("image/"),
    })),
  };
}
