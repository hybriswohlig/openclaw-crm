import { NextRequest } from "next/server";
import { getAuthContext, notFound, success, unauthorized } from "@/lib/api-utils";
import { dealImWorkspace } from "@/lib/kalkulation-versionen-antwort";
import { ladeKurzfassung } from "@/services/kurzfassung";

type Params = { params: Promise<{ recordId: string }> };

/**
 * GET → `Kurzfassung`: die rechte Spalte der Inbox (Plan 6, Entscheidung 12),
 * Deal-Karte, Kunde, Gespräch, Nachfass und die Stufe für „Kein Lead“. Liest
 * nur; Nur-Lesen-Schlüssel dürfen sie wie die Akte lesen.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return notFound("Deal nicht gefunden.");

  return success(await ladeKurzfassung(ctx.workspaceId, recordId));
}
