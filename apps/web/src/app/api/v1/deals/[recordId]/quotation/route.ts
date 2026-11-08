import { NextRequest, NextResponse } from "next/server";
import { annahmeSperrAntwort } from "@/services/kva-annahme";
import {
  apiKeyScopeForbidden,
  badRequest,
  getAuthContext,
  isReadOnlyApiKey,
  unauthorized,
  success,
} from "@/lib/api-utils";
import { CRM_UI_CLIENT_HEADER } from "@/lib/deal-source";
import { dealImWorkspace, dealNichtGefunden } from "@/lib/kalkulation-versionen-antwort";
import {
  MCP_WERKZEUG_HEADER,
  QUOTATION_GESPERRT,
  QUOTATION_STUFE_ENV,
  QUOTATION_ZAEHL_EVENT,
  quotationPutErlaubt,
  quotationQuelle,
  quotationStufe,
  type QuotationZaehlung,
} from "@/lib/dunkel-abschaltung";
import { emitEvent } from "@/services/activity-events";
import { getQuotation, QuotationInputError, upsertQuotation } from "@/services/quotations";
import { ensureCustomerStatusLink } from "@/services/customer-portal-data";
import { captureScopeSnapshot } from "@/services/scope-guard";
import { completeAgentPriceTasks } from "@/services/agent/agent-tasks";

/** Feldnamen des Bodys für die Zählung: ohne Werte, höchstens 30 Namen zu je 40 Zeichen. */
const FELDER_MAX = 30;
const FELDNAME_MAX = 40;
function feldnamen(body: unknown): string[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  return Object.keys(body)
    .sort()
    .slice(0, FELDER_MAX)
    .map((k) => k.slice(0, FELDNAME_MAX));
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const { recordId } = await params;
  const data = await getQuotation(recordId);
  return success(data);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return dealNichtGefunden();
  // getAuthContext weist Nur-Lese-Schlüssel bei PUT schon ab; hier ausdrücklich.
  if (isReadOnlyApiKey(ctx)) return apiKeyScopeForbidden("This API key is read-only and cannot write the quotation.");

  let body: unknown;
  let jsonOk = true;
  try {
    body = await req.json();
  } catch {
    jsonOk = false;
  }

  // Plan 14: jeden Aufruf zählen (Quelle, Schlüssel, Feldnamen ohne Werte), dann
  // je Stufe schreiben oder mit 410 ablehnen. Die Stufe ist eine Umgebungsvariable.
  const stufe = quotationStufe(process.env[QUOTATION_STUFE_ENV]);
  const quelle = quotationQuelle({
    authMethod: ctx.authMethod,
    uiHeader: req.headers.get(CRM_UI_CLIENT_HEADER),
    mcpWerkzeug: req.headers.get(MCP_WERKZEUG_HEADER),
  });
  const erlaubt = quotationPutErlaubt(stufe, quelle);
  const zaehlung: QuotationZaehlung = {
    quelle,
    stufe,
    abgelehnt: !erlaubt,
    dealRecordId: recordId,
    apiKeyId: ctx.apiKeyId ?? null,
    felder: feldnamen(body),
  };
  await emitEvent({
    workspaceId: ctx.workspaceId,
    recordId: null,
    objectSlug: null,
    eventType: QUOTATION_ZAEHL_EVENT,
    payload: { ...zaehlung },
    actorId: ctx.userId,
  });
  console.warn("[quotation-put]", zaehlung);
  if (!erlaubt) {
    const { status, code, message, ersatz } = QUOTATION_GESPERRT;
    return NextResponse.json({ error: { code, message, ersatz } }, { status });
  }
  if (!jsonOk) return badRequest("Invalid JSON body");

  let data: Awaited<ReturnType<typeof upsertQuotation>>;
  try {
    data = await upsertQuotation(recordId, body as Parameters<typeof upsertQuotation>[1]);
  } catch (err) {
    const gesperrt = annahmeSperrAntwort(err);
    if (gesperrt) return gesperrt;
    if (err instanceof QuotationInputError) return badRequest(err.message);
    throw err;
  }

  // The moment we have a quotation we have something worth showing the
  // customer — auto-mint the status link. Idempotent: re-saving the
  // quotation later is a no-op. Skipped silently when the OC has the
  // portal feature disabled in settings.
  await ensureCustomerStatusLink({
    workspaceId: ctx.workspaceId,
    dealRecordId: recordId,
    createdBy: ctx.userId,
  }).catch(() => {
    // Failure here must not block the quotation save.
  });

  // Anchor the scope baseline the first time a quote is issued, so later
  // KI extractions can detect (and warn on) a post-quote scope change.
  // Idempotent: no-op once a snapshot already exists for this deal.
  await captureScopeSnapshot(ctx.workspaceId, recordId, "issue");

  // Close the loop: a quote now exists, so complete any open agent-created
  // "price this lead" task and stop the overdue nudges.
  await completeAgentPriceTasks(ctx.workspaceId, recordId);

  return success(data);
}
