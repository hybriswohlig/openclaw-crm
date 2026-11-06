import { NextRequest } from "next/server";
import { getAuthContext, notFound, success, unauthorized } from "@/lib/api-utils";
import { dealImWorkspace } from "@/lib/kalkulation-versionen-antwort";
import { ladeAkte } from "@/services/akte";

type Params = { params: Promise<{ recordId: string }> };

/**
 * GET → `AkteDaten`: Kopf, sechs Kacheln, Ablauf, Nachfass-Schalter, Dock und
 * Zahlung der Umzugsakte in einem Aufruf (Plan 3, Task 8). Liest nur.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return notFound("Deal nicht gefunden.");

  return success(await ladeAkte(ctx.workspaceId, recordId));
}
