/**
 * GET /api/v1/company-settings/[ocId] — Zeitposten, Rechner-Marke, Zahlungsregel (`zahlung`)
 * und Steuernummer, jeder Nutzer des Workspace.
 * PUT /api/v1/company-settings/[ocId] — nur Admins, nie Agent oder Nur-Lese-Schlüssel (403).
 * 400 bei ungültigen Werten, 404 bei fremder Firma.
 */
import { NextRequest } from "next/server";
import { badRequest, forbidden, getAuthContext, isReadOnlyApiKey, notFound, requireAdmin, success, unauthorized } from "@/lib/api-utils";
import { pruefeSteuernummer, pruefeZahlungsregel } from "@/lib/geld";
import { pruefeZeitposten, ZeitpostenFehler } from "@/lib/zeitposten";
import {
  ladeFirmenEinstellungen,
  speichereFirmenEinstellungen,
  type FirmenEinstellungenPatch,
} from "@/services/company-settings";
import { erinnerungenDerFirmaStoppen } from "@/services/rechnungen";
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
  if (isReadOnlyApiKey(ctx)) return forbidden("Nur-Lese-Schlüssel darf Firmenwerte nicht ändern.");
  if (ctx.authMethod === "api_key") return forbidden("Firmenwerte ändert nur ein Mensch.");
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

  const eingabe = body as { zeitposten?: unknown; rechnerMarke?: unknown; zahlung?: unknown; steuernummer?: unknown };
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
  try {
    if ("zahlung" in eingabe) patch.zahlung = pruefeZahlungsregel(eingabe.zahlung);
    if ("steuernummer" in eingabe) patch.steuernummer = pruefeSteuernummer(eingabe.steuernummer);
  } catch (e) {
    return badRequest(e instanceof Error ? e.message : "Ungültige Einstellungen.");
  }

  const gespeichert = await speichereFirmenEinstellungen(ctx.workspaceId, ocId, patch);
  if (gespeichert === null) return notFound();
  // Fix-Welle M10: Erinnerung aus → offene Erinnerungs-Entwürfe dieser Firma ersetzen.
  if (patch.zahlung?.erinnerungModus === "aus") {
    await erinnerungenDerFirmaStoppen(ctx.workspaceId, ocId).catch((err) =>
      console.error("[company-settings] Erinnerungen stoppen fehlgeschlagen:", err)
    );
  }
  return success(await ladeFirmenEinstellungen(ctx.workspaceId, ocId));
}
