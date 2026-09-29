import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { workspaces } from "@/db/schema";
import { schlageRegelnVor } from "@/services/intern/regeln-lauf";
import { requireCronAuth } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/regeln-lernen
 *
 * Vercel Cron, montags 7:00 UTC. Wertet die Korrekturen der Inhaber an
 * KI-Entwürfen aus (ändern, nein-Gründe, umgeschriebene Texte) und schickt
 * höchstens fünf Regelvorschläge per WhatsApp. Aktiv wird eine Regel erst nach
 * "regel N ja". Bei weniger als drei Korrekturen passiert nichts.
 * Fail-closed Bearer auth via CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  try {
    const ergebnisse = [];
    for (const ws of await db.select({ id: workspaces.id }).from(workspaces)) {
      try {
        ergebnisse.push({ workspaceId: ws.id, ...(await schlageRegelnVor(ws.id)) });
      } catch (err) {
        console.error("[cron/regeln-lernen] Workspace fehlgeschlagen:", ws.id, err);
        ergebnisse.push({ workspaceId: ws.id, ergebnis: "fehler" });
      }
    }
    console.log(`[cron/regeln-lernen] ${JSON.stringify(ergebnisse)}`);
    return NextResponse.json({ success: true, ergebnisse });
  } catch (err) {
    console.error("[cron/regeln-lernen]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "regeln-lernen failed" }, { status: 500 });
  }
}
