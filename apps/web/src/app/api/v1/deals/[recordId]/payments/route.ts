import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, badRequest, success } from "@/lib/api-utils";
import {
  listPayments,
  createPayment,
  resolveDealOperatingCompany,
} from "@/services/financial";
import { maybeNotifyDepositReceived } from "@/services/customer-portal-notifications";

const INCOME_TREATMENTS = ["betriebseinnahme", "nicht_steuerbar"] as const;
type IncomeTreatment = (typeof INCOME_TREATMENTS)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isValidAmount = (v: unknown) => Number.isFinite(Number(v)) && Number(v) > 0;
const isValidDate = (v: unknown) =>
  typeof v === "string" && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;
  const data = await listPayments(recordId);
  return success(data);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;
  const body = await req.json();
  const { date, amount, payer, paymentMethod, reference, notes, taxTreatment } = body;

  if (!date || !amount) return badRequest("date and amount are required");
  if (!isValidDate(date)) return badRequest("Ungültiges Datum (JJJJ-MM-TT erwartet)");
  if (!isValidAmount(amount)) return badRequest("Betrag muss größer 0 sein");
  if (taxTreatment != null && !INCOME_TREATMENTS.includes(taxTreatment)) {
    return badRequest("taxTreatment muss betriebseinnahme oder nicht_steuerbar sein");
  }

  // Snapshot the deal's operating company at booking time (Phase 0 Punkt 5).
  const operatingCompanyId = await resolveDealOperatingCompany(
    ctx.workspaceId,
    recordId
  );

  const row = await createPayment(ctx.workspaceId, recordId, {
    date,
    amount: String(amount),
    payer,
    paymentMethod,
    reference,
    notes,
    operatingCompanyId,
    taxTreatment: (taxTreatment as IncomeTreatment) ?? "betriebseinnahme",
  });

  // Fire-and-forget: notify the customer once the deposit is fully covered.
  void maybeNotifyDepositReceived({
    workspaceId: ctx.workspaceId,
    dealRecordId: recordId,
  }).catch(() => {});

  return success(row, 201);
}
