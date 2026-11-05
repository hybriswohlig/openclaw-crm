import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { aktualisiereWartetFuer, ladeOffeneDeals } from "@/services/wartet";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BLOCK = 200;

/**
 * Nächtliche Neuberechnung des Wartet-Signals (deal_workflow_state) für alle
 * nicht-terminalen Deals. Fängt auf, was kein Ereignis auslöst: ein KV, der
 * mit den Tagen „ungesehen“ wird. Blöcke zu 200 Deals; scheitert ein Block,
 * wird jeder Deal darin einzeln versucht.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    const offen = await ladeOffeneDeals();
    let deals = 0;
    let aktualisiert = 0;
    let fehler = 0;
    for (const [workspaceId, ids] of offen) {
      deals += ids.length;
      for (let i = 0; i < ids.length; i += BLOCK) {
        const block = ids.slice(i, i + BLOCK);
        try {
          aktualisiert += await aktualisiereWartetFuer(workspaceId, block);
        } catch (err) {
          console.error("[cron/wartet-neu-berechnen] Block fehlgeschlagen, einzeln weiter:", err);
          for (const id of block) {
            try {
              aktualisiert += await aktualisiereWartetFuer(workspaceId, [id]);
            } catch (einzelErr) {
              fehler += 1;
              console.error(`[cron/wartet-neu-berechnen] Deal ${id} fehlgeschlagen:`, einzelErr);
            }
          }
        }
      }
    }
    return NextResponse.json({ success: true, deals, aktualisiert, fehler });
  } catch (err) {
    console.error("[cron/wartet-neu-berechnen]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "wartet failed" },
      { status: 500 }
    );
  }
}
