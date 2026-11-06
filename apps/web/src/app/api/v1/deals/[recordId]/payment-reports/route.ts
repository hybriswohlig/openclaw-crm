import { NextRequest } from "next/server";
import { getAuthContext, notFound, success, unauthorized } from "@/lib/api-utils";
import { dealImWorkspace } from "@/lib/kalkulation-versionen-antwort";
import { ladeZahlungsmeldungen } from "@/services/zahlungsmeldungen";

type Params = { params: Promise<{ recordId: string }> };

/** GET → `{ meldungen }`: offene „Ich habe bezahlt“-Meldungen des Deals (je Variante höchstens eine). */
export async function GET(req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return notFound("Deal nicht gefunden.");
  return success({ meldungen: await ladeZahlungsmeldungen(ctx.workspaceId, recordId) });
}
