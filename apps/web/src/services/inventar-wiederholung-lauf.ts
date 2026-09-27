/**
 * Inventar-Erstbefüllung aus dem Chat mit gespeicherten Versuchen, und der
 * Wiederholungslauf dafür (Cron /api/cron/retry-inventory). Regeln und
 * Versuchs-Status: siehe inventar-wiederholung.ts.
 *
 * Die Versuchszeilen werden direkt geschrieben (nicht über emitEvent, das
 * Fehler verschluckt): sie steuern die Wiederholung, ein verlorener Versuch
 * würde sonst endlos neu versucht oder nie wiederholt.
 */
import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents } from "@/db/schema";
import { applyDealInventory, extractDealInventory, hasAnyInventory } from "./deal-inventory";
import {
  INVENTAR_WIEDERHOLUNG,
  waehleWiederholung,
  workerDarfExtrahieren,
  type InventarVersuch,
  type VersuchsStatus,
} from "./inventar-wiederholung";

const VERSUCH = "ai.inventory_extract_attempt";
const ERFOLG = "ai.inventory_extracted";

export type ErstbefuellungsErgebnis = Exclude<VersuchsStatus, "laeuft"> | "uebersprungen";

async function ladeVersuche(jetzt: Date, deal?: { workspaceId: string; dealRecordId: string }) {
  const zeilen = await db
    .select({
      workspaceId: activityEvents.workspaceId,
      recordId: activityEvents.recordId,
      eventType: activityEvents.eventType,
      payload: activityEvents.payload,
      createdAt: activityEvents.createdAt,
    })
    .from(activityEvents)
    .where(
      and(
        inArray(activityEvents.eventType, [VERSUCH, ERFOLG]),
        gte(activityEvents.createdAt, new Date(jetzt.getTime() - INVENTAR_WIEDERHOLUNG.fensterMs)),
        ...(deal ? [eq(activityEvents.workspaceId, deal.workspaceId), eq(activityEvents.recordId, deal.dealRecordId)] : [])
      )
    );
  const versuche: InventarVersuch[] = [];
  const erfolge: Array<{ workspaceId: string; dealRecordId: string; createdAt: Date }> = [];
  for (const z of zeilen) {
    if (!z.recordId) continue;
    if (z.eventType === ERFOLG) {
      erfolge.push({ workspaceId: z.workspaceId, dealRecordId: z.recordId, createdAt: z.createdAt });
    } else {
      const status = (z.payload as { status?: VersuchsStatus } | null)?.status ?? "laeuft";
      versuche.push({ workspaceId: z.workspaceId, dealRecordId: z.recordId, createdAt: z.createdAt, status });
    }
  }
  return { versuche, erfolge };
}

/**
 * Eine Erstbefüllung. Ohne `versuch` (Worker) wird nach einem Fehlschlag oder
 * während eines laufenden Versuchs nichts gestartet: dann wiederholt der Cron.
 */
export async function inventarErstbefuellen(
  workspaceId: string,
  dealRecordId: string,
  opts: { background?: boolean; versuch?: number } = {}
): Promise<ErstbefuellungsErgebnis> {
  const ausCron = opts.versuch !== undefined;
  if (!ausCron) {
    const { versuche } = await ladeVersuche(new Date(), { workspaceId, dealRecordId });
    if (!workerDarfExtrahieren(versuche, new Date())) return "uebersprungen";
  }

  const [zeile] = await db
    .insert(activityEvents)
    .values({
      workspaceId,
      recordId: dealRecordId,
      objectSlug: "deals",
      eventType: VERSUCH,
      payload: { status: "laeuft", versuch: opts.versuch ?? 1 },
    })
    .returning({ id: activityEvents.id });
  const abschliessen = (status: Exclude<VersuchsStatus, "laeuft">, error?: string) =>
    db
      .update(activityEvents)
      .set({ payload: { status, versuch: opts.versuch ?? 1, ...(error ? { error: error.slice(0, 300) } : {}) } })
      .where(eq(activityEvents.id, zeile!.id));

  let status: Exclude<VersuchsStatus, "laeuft">;
  try {
    const inv = await extractDealInventory(workspaceId, dealRecordId, { background: opts.background });
    if (!inv.items) {
      status = inv.retryable === false ? "nicht_moeglich" : "fehler";
      await abschliessen(status, inv.error ?? "unbekannt");
      return status;
    }
    status = inv.items.length > 0 ? "ok" : "leer";
    // Beim Cron kann während der Extraktion Inventar entstanden sein (Worker,
    // Disponent): dann nichts überschreiben.
    if (ausCron && (await hasAnyInventory(workspaceId, dealRecordId))) {
      await abschliessen(status);
      return status;
    }
    if (inv.items.length > 0) await applyDealInventory(workspaceId, dealRecordId, inv.items, null);
    await abschliessen(status);
    return status;
  } catch (err) {
    await abschliessen("fehler", err instanceof Error ? err.message : String(err)).catch(() => {});
    throw err;
  }
}

/** Ein Wiederholungsversuch pro Aufruf; null, wenn nichts fällig ist. */
export async function wiederholeFehlgeschlagenesInventar(
  jetzt = new Date()
): Promise<{ dealRecordId: string; versuch: number; ergebnis: ErstbefuellungsErgebnis } | null> {
  const { versuche, erfolge } = await ladeVersuche(jetzt);
  // Deals, die inzwischen Inventar haben (Fotos, von Hand), überspringen; alle Kandidaten prüfen.
  for (const wahl of waehleWiederholung(versuche, jetzt, erfolge)) {
    if (await hasAnyInventory(wahl.workspaceId, wahl.dealRecordId)) continue;
    const versuch = wahl.versuche + 1;
    const ergebnis = await inventarErstbefuellen(wahl.workspaceId, wahl.dealRecordId, { background: true, versuch });
    return { dealRecordId: wahl.dealRecordId, versuch, ergebnis };
  }
  return null;
}
