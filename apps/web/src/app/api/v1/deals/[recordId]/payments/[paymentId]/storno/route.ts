import { NextRequest } from "next/server";
import { badRequest, success } from "@/lib/api-utils";
import { GELD_FEHLER_TEXT, grundGueltig } from "@/lib/geld";
import { stornierePayment } from "@/services/financial";
import { geldFehlerAntwort, jsonOderNull, menschMitDeal } from "../../zahlung-route-hilfe";

export const dynamic = "force-dynamic";

/** POST { grund } → Gegenbuchung (Plan 9, G4). Zweites Storno 409 `SCHON_STORNIERT`. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ recordId: string; paymentId: string }> }) {
  const { recordId, paymentId } = await params;
  const v = await menschMitDeal(req, recordId);
  if (v.antwort) return v.antwort;
  const body = await jsonOderNull(req);
  const grund = grundGueltig(typeof body?.grund === "string" ? body.grund : null);
  if (!grund) return badRequest(GELD_FEHLER_TEXT.GRUND_FEHLT);
  try {
    return success(await stornierePayment(v.ctx.workspaceId, recordId, paymentId, grund, v.ctx.userId), 201);
  } catch (err) {
    return geldFehlerAntwort(err);
  }
}
