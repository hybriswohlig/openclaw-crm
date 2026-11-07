/**
 * Detailfelder der Quotation ohne Preis (Plan 14, Ersatz für PUT /quotation bei Bots).
 *
 *   PATCH /api/v1/deals/[recordId]/quotation/details
 *   body: { validUntil?, notes?, summary?, serviceType?, paymentMethodPreference?, showStandardInclusions? }
 *
 * Festpreis, Posten, Rabatt und `calculation_version_id` bleiben stehen; Preise ändern
 * sich nur über die Kalkulation. Ohne Quotation 404, nach der Annahme nur `notes` (409).
 */
import { NextRequest, NextResponse } from "next/server";
import {
  apiKeyScopeForbidden,
  badRequest,
  getAuthContext,
  isReadOnlyApiKey,
  success,
  unauthorized,
} from "@/lib/api-utils";
import { dealImWorkspace, dealNichtGefunden } from "@/lib/kalkulation-versionen-antwort";
import { quotationDetailsPruefen } from "@/lib/dunkel-abschaltung";
import { DETAILS_CODES, setQuotationDetails } from "@/services/quotation-details";
import { AngebotAngenommenError, annahmeSperrAntwort } from "@/services/kva-annahme";

export const dynamic = "force-dynamic";

const ZAHLUNGSWEGE = new Set(["bank_transfer", "paypal", "cash", "card"]);

/** YYYY-MM-DD, das es als Kalendertag gibt (Date.parse nimmt auch den 31.02.). */
function echterTag(v: string): boolean {
  return new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  if (isReadOnlyApiKey(ctx)) return apiKeyScopeForbidden("This API key is read-only and cannot change the quotation.");
  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return dealNichtGefunden();

  let roh: unknown;
  try {
    roh = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  const geprueft = quotationDetailsPruefen(roh);
  if (!geprueft.ok) return badRequest(geprueft.fehler);
  const { patch } = geprueft;
  if (typeof patch.validUntil === "string" && !echterTag(patch.validUntil)) {
    return badRequest("validUntil muss YYYY-MM-DD oder null sein");
  }
  if (typeof patch.paymentMethodPreference === "string" && !ZAHLUNGSWEGE.has(patch.paymentMethodPreference)) {
    return badRequest("paymentMethodPreference muss bank_transfer, paypal, cash, card oder null sein");
  }

  const ergebnis = await setQuotationDetails(ctx.workspaceId, recordId, patch);
  if (ergebnis.ok) return success(ergebnis.quotation);
  if (ergebnis.code === DETAILS_CODES.angenommen) {
    return annahmeSperrAntwort(new AngebotAngenommenError()) as NextResponse;
  }
  if (ergebnis.code === DETAILS_CODES.quotationFehlt) {
    return NextResponse.json(
      {
        error: {
          code: ergebnis.code,
          message:
            "Der Deal hat noch kein Angebot. Erst eine Kalkulationsversion sperren (crm_lock_calculation_version), dann die Details ändern.",
        },
      },
      { status: 404 }
    );
  }
  return dealNichtGefunden();
}
