import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, badRequest, forbidden, isReadOnlyApiKey, success } from "@/lib/api-utils";
import { dealImWorkspace, dealNichtGefunden } from "@/lib/kalkulation-versionen-antwort";
import { erinnerungenStoppen } from "@/services/rechnungen";
import { ZAHLUNGSART_FEHLER, zahlungsartAus } from "@/lib/zahlungsart";
import {
  listPayments,
  createPayment,
  resolveDealOperatingCompany,
} from "@/services/financial";
import { maybeNotifyDepositReceived } from "@/services/customer-portal-notifications";
import { nachZahlung } from "@/services/nach-zahlung";

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
  if (!ctx) return unauthorized(req);

  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return dealNichtGefunden();
  const data = (await listPayments(recordId)).filter((z) => z.workspaceId === ctx.workspaceId);
  return success(data);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  // Plan 9, Entscheidung 9: Agent nur lesen, Nur-Lese-Schlüssel 403, fremder Deal 404.
  if (isReadOnlyApiKey(ctx)) return forbidden("Nur-Lese-Schlüssel darf keine Zahlung erfassen.");
  if (ctx.authMethod === "api_key") return forbidden("Zahlungen erfasst nur ein Mensch.");
  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return dealNichtGefunden();
  const body = await req.json();
  const { date, amount, payer, paymentMethod, reference, notes, taxTreatment } = body;

  if (!date || !amount) return badRequest("date and amount are required");
  if (!isValidDate(date)) return badRequest("Ungültiges Datum (JJJJ-MM-TT erwartet)");
  if (!isValidAmount(amount)) return badRequest("Betrag muss größer 0 sein");
  if (taxTreatment != null && !INCOME_TREATMENTS.includes(taxTreatment)) {
    return badRequest("taxTreatment muss betriebseinnahme oder nicht_steuerbar sein");
  }
  const art = zahlungsartAus(paymentMethod);
  if (art === "ungueltig") return badRequest(ZAHLUNGSART_FEHLER);

  // Snapshot the deal's operating company at booking time (Phase 0 Punkt 5).
  const operatingCompanyId = await resolveDealOperatingCompany(
    ctx.workspaceId,
    recordId
  );

  const row = await createPayment(ctx.workspaceId, recordId, {
    date,
    amount: String(amount),
    payer,
    paymentMethod: art,
    reference,
    notes,
    operatingCompanyId,
    taxTreatment: (taxTreatment as IncomeTreatment) ?? "betriebseinnahme",
    quelle: "hand",
    createdBy: ctx.userId,
  });

  // Fire-and-forget: notify the customer once the deposit is fully covered.
  void maybeNotifyDepositReceived({
    workspaceId: ctx.workspaceId,
    dealRecordId: recordId,
  }).catch(() => {});

  try {
    await nachZahlung(ctx.workspaceId, recordId, ctx.userId);
  } catch (err) {
    console.error("[nach-zahlung] nach Zahlung fehlgeschlagen:", err);
  }
  // Eine Zahlung stoppt offene Erinnerungs-Entwürfe (Betrag darin ist überholt).
  await erinnerungenStoppen(ctx.workspaceId, recordId, "zahlung").catch((err) =>
    console.error("[zahlungserinnerung] stoppen fehlgeschlagen:", err)
  );

  return success(row, 201);
}
