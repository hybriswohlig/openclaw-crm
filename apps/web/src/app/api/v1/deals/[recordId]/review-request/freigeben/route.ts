/**
 * POST /api/v1/deals/[recordId]/review-request/freigeben
 * Löscht ungeklickte Token in Lage „unklar“. 409, wenn keines frei wird.
 */
import { NextRequest, NextResponse } from "next/server";
import { forbidden, getAuthContext, notFound, success, unauthorized } from "@/lib/api-utils";
import { dealImWorkspace } from "@/lib/kalkulation-versionen-antwort";
import { tokenFreigeben } from "@/services/bewertung-token";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  if (ctx.authMethod !== "cookie") return forbidden("Nur in der angemeldeten Sitzung.");

  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return notFound("Deal nicht gefunden.");

  const { freigegeben } = await tokenFreigeben(ctx.workspaceId, recordId, ctx.userId);
  if (freigegeben === 0) {
    return NextResponse.json(
      { error: { code: "NICHTS_FREIZUGEBEN", message: "Nichts freizugeben." } },
      { status: 409 }
    );
  }
  return success({ freigegeben });
}
