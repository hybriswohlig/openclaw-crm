import { NextRequest } from "next/server";
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
import { ladeNachfassSchalter, setzeNachfassSchalter } from "@/services/nachfass-schalter";

type Params = { params: Promise<{ recordId: string }> };

/** GET → `{ an, modus, text, regeln }` des Nachfass-Schalters dieses Deals. */
export async function GET(req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return notFound("Deal nicht gefunden.");
  return success(await ladeNachfassSchalter(ctx.workspaceId, recordId));
}

/** PUT `{ an: boolean }` → setzt die bestehenden Flags (Entscheidung 8) und liefert den neuen Stand. */
export async function PUT(req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  if (isReadOnlyApiKey(ctx)) return apiKeyScopeForbidden("Nur-Lesen-Schlüssel darf den Nachfass nicht schalten.");
  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return notFound("Deal nicht gefunden.");

  const body = (await req.json().catch(() => null)) as { an?: unknown } | null;
  if (!body || typeof body.an !== "boolean") return badRequest("an muss true oder false sein.");
  return success(await setzeNachfassSchalter(ctx.workspaceId, recordId, body.an, ctx.userId));
}
