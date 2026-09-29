/** Lauf des KI-Wächters (Cron /api/cron/ki-waechter), Bewertung in ki-waechter.ts. */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiTaskRuns, workspaces } from "@/db/schema";
import { getSetting, setSetting } from "@/services/workspace-settings";
import { bewerteKiLage, type WaechterStatus } from "./ki-waechter";
import { nachholenAusstehend, sendeAnInterne } from "./intern-senden";
import { ladeInterneNummern } from "./interne-nummern";

const STATUS_KEY = "ki_waechter_status";

function berlinStunde(d: Date): number {
  return Number(new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" }).format(d));
}

function statusAus(roh: string | null): WaechterStatus {
  try {
    const s = roh ? (JSON.parse(roh) as WaechterStatus) : null;
    if (s && (s.zustand === "ok" || s.zustand === "gestoert")) return { ...s, nachholen: s.nachholen ?? null };
  } catch {
    // unlesbar: wie frisch behandeln
  }
  return { zustand: "ok", seit: new Date(0).toISOString(), letzterAlarm: null, nachholen: null };
}

export async function kiWaechterLauf(jetzt = new Date()) {
  const ergebnisse: Array<{ workspaceId: string; aktion: string | null }> = [];
  const wsListe = await db.select({ id: workspaces.id }).from(workspaces);
  const vorStunde = new Date(jetzt.getTime() - 60 * 60_000);
  const vorDrei = new Date(jetzt.getTime() - 3 * 60 * 60_000);

  for (const ws of wsListe) {
    try {
      const nachgeholt = await nachholenAusstehend(ws.id, jetzt);
      if (nachgeholt > 0) console.log(`[ki-waechter] ${nachgeholt} interne Nachricht(en) nachgeholt`);
    } catch (err) {
      console.error("[ki-waechter] Nachholen fehlgeschlagen:", err);
    }
    const zaehle = async (seit: Date) => {
      const [r] = await db
        .select({
          laeufe: sql<number>`count(*)::int`,
          erfolge: sql<number>`count(*) filter (where ${aiTaskRuns.success})::int`,
        })
        .from(aiTaskRuns)
        .where(and(eq(aiTaskRuns.workspaceId, ws.id), gte(aiTaskRuns.createdAt, seit)));
      return { laeufe: r?.laeufe ?? 0, erfolge: r?.erfolge ?? 0 };
    };
    const stunde = await zaehle(vorStunde);
    const drei = await zaehle(vorDrei);
    const [fehler] = await db
      .select({ msg: aiTaskRuns.errorMessage, n: sql<number>`count(*)::int` })
      .from(aiTaskRuns)
      .where(and(eq(aiTaskRuns.workspaceId, ws.id), eq(aiTaskRuns.success, false), gte(aiTaskRuns.createdAt, vorStunde)))
      .groupBy(aiTaskRuns.errorMessage)
      .orderBy(desc(sql`count(*)`))
      .limit(1);

    const status = statusAus(await getSetting(ws.id, STATUS_KEY));
    const namen = (await ladeInterneNummern(ws.id)).map((n) => n.name);
    const r = bewerteKiLage(
      {
        stunde: { laeufe: stunde.laeufe, fehler: stunde.laeufe - stunde.erfolge },
        dreiStunden: drei,
        haeufigsterFehler: fehler?.msg ?? null,
      },
      status,
      jetzt,
      berlinStunde(jetzt),
      namen
    );
    const neu = { ...r.neuerStatus };
    if (r.senden) {
      const { fehlgeschlagen } = await sendeAnInterne(ws.id, r.senden.text, { nurAn: r.senden.an });
      // Nur wer nicht erreicht wurde, bleibt zum Nachholen stehen.
      neu.nachholen = fehlgeschlagen.length > 0 ? { text: r.senden.text, an: fehlgeschlagen } : null;
    }
    if (JSON.stringify(neu) !== JSON.stringify(status)) {
      await setSetting(ws.id, STATUS_KEY, JSON.stringify(neu));
    }
    ergebnisse.push({ workspaceId: ws.id, aktion: r.senden ? r.senden.text.slice(0, 40) : null });
  }
  return ergebnisse;
}
