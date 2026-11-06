/**
 * GET /api/v1/company-settings/[ocId] — Zeitposten und Rechner-Marke, jeder Nutzer des Workspace.
 * PUT /api/v1/company-settings/[ocId] — nur Admins. 400 bei ungültigen Zeitposten oder Marke, 404 bei fremder Firma.
 */
import { NextRequest } from "next/server";
import { badRequest, getAuthContext, notFound, requireAdmin, success, unauthorized } from "@/lib/api-utils";
import { pruefeZeitposten, ZeitpostenFehler } from "@/lib/zeitposten";
import { ladeFirmenEinstellungen, speichereFirmenEinstellungen, type FirmenEinstellungenPatch } from "@/services/company-settings";
import type { Marke } from "@/services/rechner/quelle";

export const dynamic = "force-dynamic";

function istMarke(wert: unknown): wert is Marke {
  return wert === "kottke" || wert === "ceylan";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ocId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const { ocId } = await params;
  return success(await ladeFirmenEinstellungen(ctx.workspaceId, ocId));
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ ocId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const { ocId } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest("Ungültige Einstellungen.");

  const eingabe = body as { zeitposten?: unknown; rechnerMarke?: unknown };
  const patch: FirmenEinstellungenPatch = {};
  try {
    if ("zeitposten" in eingabe) patch.zeitposten = pruefeZeitposten(eingabe.zeitposten);
    if ("rechnerMarke" in eingabe) {
      if (eingabe.rechnerMarke !== null && !istMarke(eingabe.rechnerMarke)) {
        return badRequest("Rechner-Marke muss kottke, ceylan oder leer sein.");
      }
      patch.rechnerMarke = eingabe.rechnerMarke;
    }
  } catch (e) {
    if (e instanceof ZeitpostenFehler) return badRequest(e.message);
    throw e;
  }

  const gespeichert = await speichereFirmenEinstellungen(ctx.workspaceId, ocId, patch);
  if (gespeichert === null) return notFound();
  return success(await ladeFirmenEinstellungen(ctx.workspaceId, ocId));
}
