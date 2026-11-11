/**
 * Plan 16 (Bauteil 6, Review I4): nach dem Versand ändern Bots (API-Schlüssel) das Inventar
 * nicht mehr direkt, auch nicht über die KI-Extraktion. Sie schlagen über
 * crm_propose_offer_change vor; ein Mensch übernimmt. Eine Stelle für alle Inventar-Routen.
 */
import { NextResponse } from "next/server";

export const VERSCHICKT_INVENTAR_TEXT =
  "Das Angebot ist schon verschickt. Inventar-Änderungen bitte über crm_propose_offer_change vorschlagen; ein Mensch übernimmt sie.";

/** 409 AENDERUNG_NUR_MENSCH für einen Schlüssel am verschickten Angebot, sonst null. */
export async function verschicktFuerSchluessel(
  ctx: { authMethod?: string; workspaceId: string },
  recordId: string
): Promise<NextResponse | null> {
  if (ctx.authMethod !== "api_key") return null;
  const { istVerschickt } = await import("@/services/kalkulation-versionen-speicher");
  if (!(await istVerschickt(ctx.workspaceId, recordId))) return null;
  return NextResponse.json({ error: { code: "AENDERUNG_NUR_MENSCH", message: VERSCHICKT_INVENTAR_TEXT } }, { status: 409 });
}
