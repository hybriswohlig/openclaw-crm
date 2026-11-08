import { NextRequest } from "next/server";
import { badRequest, success } from "@/lib/api-utils";
import { barErhalten } from "@/services/financial";
import { jsonOderNull, menschMitDeal } from "../zahlung-route-hilfe";

export const dynamic = "force-dynamic";

/** POST { paymentIds } → Bargeld des Teams ist bei den Inhabern (Tagesabschluss, Plan 9). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const { recordId } = await params;
  const v = await menschMitDeal(req, recordId);
  if (v.antwort) return v.antwort;
  const b = await jsonOderNull(req);
  const ids = b?.paymentIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 50 || !ids.every((x) => typeof x === "string")) {
    return badRequest("paymentIds: Liste von Zahlungs-IDs erwartet.");
  }
  const anzahl = await barErhalten(v.ctx.workspaceId, recordId, ids as string[], v.ctx.userId);
  return success({ anzahl });
}
