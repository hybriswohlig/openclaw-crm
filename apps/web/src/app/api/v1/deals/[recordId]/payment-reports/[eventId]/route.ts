import { NextRequest, NextResponse } from "next/server";
import {
  apiKeyScopeForbidden,
  badRequest,
  getAuthContext,
  isReadOnlyApiKey,
  notFound,
  success,
  unauthorized,
} from "@/lib/api-utils";
import { dealImWorkspace } from "@/lib/kalkulation-versionen-antwort";
import {
  bestaetigeZahlungsmeldung,
  verwerfeZahlungsmeldung,
  ZahlungsmeldungFehler,
} from "@/services/zahlungsmeldungen";

type Params = { params: Promise<{ recordId: string; eventId: string }> };

/**
 * POST `{ aktion: "bestaetigen" | "verwerfen" }` → `{ paymentId }` bzw. `{ verworfen: true }`.
 * Fremde oder unbekannte Meldung → 404 `NICHT_GEFUNDEN`; schon erledigt → 409 `ERLEDIGT`.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  if (isReadOnlyApiKey(ctx)) return apiKeyScopeForbidden("Nur-Lesen-Schlüssel darf Zahlungsmeldungen nicht bearbeiten.");
  const { recordId, eventId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return notFound("Deal nicht gefunden.");

  const body = (await req.json().catch(() => null)) as { aktion?: unknown } | null;
  const aktion = body?.aktion;
  if (aktion !== "bestaetigen" && aktion !== "verwerfen") {
    return badRequest("aktion muss bestaetigen oder verwerfen sein.");
  }

  try {
    if (aktion === "bestaetigen") {
      return success(await bestaetigeZahlungsmeldung(ctx.workspaceId, recordId, eventId, ctx.userId));
    }
    await verwerfeZahlungsmeldung(ctx.workspaceId, recordId, eventId, ctx.userId);
    return success({ verworfen: true });
  } catch (err) {
    if (err instanceof ZahlungsmeldungFehler) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.code === "NICHT_GEFUNDEN" ? 404 : 409 },
      );
    }
    throw err;
  }
}
