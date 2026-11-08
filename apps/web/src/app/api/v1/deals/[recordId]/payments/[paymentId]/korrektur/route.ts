import { NextRequest } from "next/server";
import { badRequest, success } from "@/lib/api-utils";
import { GELD_FEHLER_TEXT, grundGueltig } from "@/lib/geld";
import { ZAHLUNGSART_FEHLER, zahlungsartAus } from "@/lib/zahlungsart";
import { zahlungKorrigieren } from "@/services/financial";
import { maybeNotifyDepositReceived } from "@/services/customer-portal-notifications";
import { geldFehlerAntwort, jsonOderNull, menschMitDeal } from "../../zahlung-route-hilfe";

export const dynamic = "force-dynamic";

const TAG = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST { date, amountCent, paymentMethod, kaution, notes?, grund } → Storno der
 * alten Zahlung plus neue Zahlung in einer Transaktion (Plan 9, Entscheidung 8).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ recordId: string; paymentId: string }> }) {
  const { recordId, paymentId } = await params;
  const v = await menschMitDeal(req, recordId);
  if (v.antwort) return v.antwort;
  const b = await jsonOderNull(req);
  if (!b) return badRequest("Invalid JSON body");
  const grund = grundGueltig(typeof b.grund === "string" ? b.grund : null);
  if (!grund) return badRequest(GELD_FEHLER_TEXT.GRUND_FEHLT);
  if (typeof b.date !== "string" || !TAG.test(b.date) || Number.isNaN(Date.parse(b.date))) {
    return badRequest("Ungültiges Datum (JJJJ-MM-TT erwartet)");
  }
  if (typeof b.amountCent !== "number" || !Number.isInteger(b.amountCent) || b.amountCent <= 0) {
    return badRequest("Betrag muss größer 0 sein");
  }
  const art = zahlungsartAus(b.paymentMethod);
  if (art === "ungueltig" || art === null) return badRequest(ZAHLUNGSART_FEHLER);
  try {
    const ergebnis = await zahlungKorrigieren(
      v.ctx.workspaceId,
      recordId,
      paymentId,
      {
        date: b.date,
        amountCent: b.amountCent,
        paymentMethod: art,
        kaution: b.kaution === true,
        notes: typeof b.notes === "string" ? b.notes : null,
        grund,
      },
      v.ctx.userId
    );
    void maybeNotifyDepositReceived({ workspaceId: v.ctx.workspaceId, dealRecordId: recordId }).catch(() => {});
    return success(ergebnis, 201);
  } catch (err) {
    return geldFehlerAntwort(err);
  }
}
