/**
 * Gemeinsames der Routen unter `/api/v1/deals/[recordId]/angebot-aenderung` (Plan 16):
 * Deal im Workspace, Autor aus dem Auth-Kontext, Fehler als Antwort, frische Ansicht.
 */
import { NextRequest, NextResponse } from "next/server";
import { forbidden, getAuthContext, isReadOnlyApiKey, success, unauthorized, type AuthContext } from "@/lib/api-utils";
import { autorAus, dealImWorkspace, dealNichtGefunden, versionsFehlerAntwort } from "@/lib/kalkulation-versionen-antwort";
import { AenderungsFehler, ansicht } from "@/services/angebot-aenderung";
import type { Autor } from "@/services/kalkulation-versionen";

export type Params = { params: Promise<{ recordId: string }> };

/** Fehler des Dienstes → `{ error: { code, message, details } }` mit Status; Versionsfehler wie dort. */
export function aenderungsFehlerAntwort(err: unknown): NextResponse | null {
  if (err instanceof AenderungsFehler) {
    return NextResponse.json({ error: { code: err.code, message: err.message, details: err.details ?? null } }, { status: err.status });
  }
  return versionsFehlerAntwort(err);
}

/**
 * Schreibende Route: Auth, Deal im Workspace, kein Nur-Lese-Schlüssel; danach `f` und die
 * frische Ansicht (`{ ansicht, ergebnis }`).
 */
export async function schreibRoute<T>(
  req: NextRequest,
  { params }: Params,
  f: (ctx: AuthContext, deal: string, autor: Autor, body: Record<string, unknown>) => Promise<T>
): Promise<NextResponse> {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  if (isReadOnlyApiKey(ctx)) return forbidden("Nur-Lese-Schlüssel darf das Angebot nicht ändern.");
  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return dealNichtGefunden();
  const roh: unknown = await req.json().catch(() => ({}));
  const body = roh && typeof roh === "object" && !Array.isArray(roh) ? (roh as Record<string, unknown>) : {};
  try {
    const autor = autorAus(ctx);
    const ergebnis = await f(ctx, recordId, autor, body);
    return success({ ergebnis, ansicht: { ...(await ansicht(ctx.workspaceId, recordId)), darfAnnahmeAufheben: ctx.workspaceRole === "admin" && autor.quelle === "mensch" } });
  } catch (err) {
    const antwort = aenderungsFehlerAntwort(err);
    if (antwort) return antwort;
    throw err;
  }
}
