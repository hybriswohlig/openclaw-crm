import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, notFound, badRequest, forbidden, isReadOnlyApiKey, success } from "@/lib/api-utils";
import { ZAHLUNGSART_FEHLER, zahlungsartAus } from "@/lib/zahlungsart";
import { dealImWorkspace, dealNichtGefunden } from "@/lib/kalkulation-versionen-antwort";
import { GeldFehler } from "@/lib/geld";
import { updatePayment, deletePayment } from "@/services/financial";
import { maybeNotifyDepositReceived } from "@/services/customer-portal-notifications";
import { nachZahlung } from "@/services/nach-zahlung";

const INCOME_TREATMENTS = ["betriebseinnahme", "nicht_steuerbar"] as const;
type IncomeTreatment = (typeof INCOME_TREATMENTS)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isValidAmount = (v: unknown) => Number.isFinite(Number(v)) && Number(v) > 0;
const isValidDate = (v: unknown) =>
  typeof v === "string" && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));

type Params = { params: Promise<{ recordId: string; paymentId: string }> };

/** Vorlauf (Plan 9, Entscheidung 9): Mensch, Deal im Workspace. */
async function vorlauf(req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext(req);
  if (!ctx) return { antwort: unauthorized(req) } as const;
  if (isReadOnlyApiKey(ctx)) return { antwort: forbidden("Nur-Lese-Schlüssel darf Zahlungen nicht ändern.") } as const;
  if (ctx.authMethod === "api_key") return { antwort: forbidden("Zahlungen ändert nur ein Mensch.") } as const;
  const { recordId, paymentId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return { antwort: dealNichtGefunden() } as const;
  return { antwort: null, ctx, recordId, paymentId } as const;
}

function geldAntwort(err: unknown) {
  if (err instanceof GeldFehler) {
    return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
  }
  throw err;
}

async function nachlauf(ws: string, deal: string, userId: string) {
  void maybeNotifyDepositReceived({ workspaceId: ws, dealRecordId: deal }).catch(() => {});
  try {
    await nachZahlung(ws, deal, userId);
  } catch (err) {
    console.error("[nach-zahlung] nach Zahlungsänderung fehlgeschlagen:", err);
  }
}

/** Bearbeiten: Datum, Art, Zahler, Referenz, Notiz. Betrag und Kaution nur über „Korrigieren“ (409). */
export async function PUT(req: NextRequest, p: Params) {
  const v = await vorlauf(req, p);
  if (v.antwort) return v.antwort;
  const { ctx, recordId, paymentId } = v;
  const body = await req.json();
  const { date, amount, payer, paymentMethod, reference, notes, taxTreatment } = body;

  if (date !== undefined && !isValidDate(date)) {
    return badRequest("Ungültiges Datum (JJJJ-MM-TT erwartet)");
  }
  if (amount !== undefined && !isValidAmount(amount)) {
    return badRequest("Betrag muss größer 0 sein");
  }
  if (taxTreatment != null && !INCOME_TREATMENTS.includes(taxTreatment)) {
    return badRequest("taxTreatment muss betriebseinnahme oder nicht_steuerbar sein");
  }
  let art: ReturnType<typeof zahlungsartAus> = null;
  if (paymentMethod !== undefined) {
    art = zahlungsartAus(paymentMethod);
    if (art === "ungueltig") return badRequest(ZAHLUNGSART_FEHLER);
  }

  try {
    const row = await updatePayment(
      paymentId,
      ctx.workspaceId,
      {
        ...(date !== undefined && { date }),
        ...(amount !== undefined && { amount: String(amount) }),
        ...(payer !== undefined && { payer }),
        ...(paymentMethod !== undefined && { paymentMethod: art }),
        ...(reference !== undefined && { reference }),
        ...(notes !== undefined && { notes }),
        ...(taxTreatment != null && { taxTreatment: taxTreatment as IncomeTreatment }),
      },
      { dealRecordId: recordId, userId: ctx.userId }
    );
    if (!row) return notFound("Payment not found");
    await nachlauf(ctx.workspaceId, recordId, ctx.userId);
    return success(row);
  } catch (err) {
    return geldAntwort(err);
  }
}

/** Löschen nur ohne Belegnummer (Altbestand); sonst 409 `NUR_STORNO`. */
export async function DELETE(req: NextRequest, p: Params) {
  const v = await vorlauf(req, p);
  if (v.antwort) return v.antwort;
  const { ctx, recordId, paymentId } = v;
  try {
    const row = await deletePayment(paymentId, ctx.workspaceId, recordId);
    if (!row) return notFound("Payment not found");
    await nachlauf(ctx.workspaceId, recordId, ctx.userId);
    return success({ deleted: true });
  } catch (err) {
    return geldAntwort(err);
  }
}
