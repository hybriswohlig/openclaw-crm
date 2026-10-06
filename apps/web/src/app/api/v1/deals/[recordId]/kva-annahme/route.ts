import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success, badRequest, requireAdmin } from "@/lib/api-utils";
import { annahmeAufheben, annahmeAusZeile, ladeAktiveAnnahme } from "@/services/kva-annahme";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { recordId } = await params;
  const row = await ladeAktiveAnnahme(recordId);
  if (!row || row.workspaceId !== ctx.workspaceId) return success({ aktiv: null });
  return success({
    aktiv: {
      ...annahmeAusZeile(row),
      versicherungGewuenscht: row.versicherungGewuenscht,
      confirmationSentAt: row.confirmationSentAt?.toISOString() ?? null,
      moveDate: row.moveDate,
    },
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const nurAdmin = requireAdmin(ctx);
  if (nurAdmin) return nurAdmin;
  const { recordId } = await params;
  const body = (await req.json().catch(() => ({}))) as { grund?: unknown };
  const grund = typeof body.grund === "string" ? body.grund.trim() : "";
  if (grund.length < 3) return badRequest("Bitte einen Grund angeben.");
  const status = await annahmeAufheben({ workspaceId: ctx.workspaceId, dealRecordId: recordId, userId: ctx.userId, grund });
  return success({ status });
}
