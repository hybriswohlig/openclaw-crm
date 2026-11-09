/**
 * Schalter `buchung_im_preis` je Betriebsfirma (Plan 12b).
 * GET liest, PUT setzt (legt die Zeile an, überschreibt nur diesen Schalter).
 * PUT nur für Admins (Plan 13: Firmen-Einstellungen wie `company-settings`);
 * GET meldet dazu `darfAendern`, damit die Oberfläche den Schalter sperrt.
 */
import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { companySettings } from "@/db/schema/company-settings";
import { badRequest, forbidden, notFound, success } from "@/lib/api-utils";
import { NUR_ADMINS } from "@/lib/einstellungen-uebersicht";
import { einsatzVorlauf } from "@/lib/einsatz-route";
import { operatingCompanyInWorkspace } from "@/services/customer-portal-config";

type Params = { params: Promise<{ ocId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const vor = await einsatzVorlauf(req);
  if (vor.antwort) return vor.antwort;
  const { ocId } = await params;
  if (!(await operatingCompanyInWorkspace(vor.ctx.workspaceId, ocId))) return notFound("Firma nicht gefunden.");
  const [zeile] = await db
    .select({ buchungImPreis: companySettings.buchungImPreis })
    .from(companySettings)
    .where(and(eq(companySettings.operatingCompanyRecordId, ocId), eq(companySettings.workspaceId, vor.ctx.workspaceId)))
    .limit(1);
  return success({ buchungImPreis: zeile?.buchungImPreis === true, darfAendern: vor.ctx.workspaceRole === "admin" });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const vor = await einsatzVorlauf(req);
  if (vor.antwort) return vor.antwort;
  if (vor.ctx.workspaceRole !== "admin") return forbidden(NUR_ADMINS);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Ungültiges JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof (body as { buchungImPreis?: unknown }).buchungImPreis !== "boolean") {
    return badRequest("buchungImPreis muss true oder false sein.");
  }
  const buchungImPreis = (body as { buchungImPreis: boolean }).buchungImPreis;
  const { ocId } = await params;
  if (!(await operatingCompanyInWorkspace(vor.ctx.workspaceId, ocId))) return notFound("Firma nicht gefunden.");
  const jetzt = new Date();
  await db
    .insert(companySettings)
    .values({
      operatingCompanyRecordId: ocId,
      workspaceId: vor.ctx.workspaceId,
      buchungImPreis,
      updatedAt: jetzt,
    })
    .onConflictDoUpdate({
      target: companySettings.operatingCompanyRecordId,
      set: { buchungImPreis, updatedAt: jetzt },
    });
  return success({ buchungImPreis });
}
