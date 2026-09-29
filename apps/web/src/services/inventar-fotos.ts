/**
 * Fotoanalyse als eigene Warteschlange (2026-09-29). Vorher lief sie im
 * Antwort-Lauf des Agenten und dauerte bis zu 270 Sekunden; zusammen mit der
 * Lead-Auswertung sprengte das Vercels 300-Sekunden-Grenze, der Lauf wurde
 * abgebrochen und der Kunde (Lead "Patrick") bekam nie einen Entwurf.
 * Jetzt merkt der Agent neue Fotos nur vor, der Cron /api/cron/fotos-analysieren
 * arbeitet je Lauf einen Stapel ab (höchstens zwei Versuche in 24 Stunden).
 */
import { createHash } from "node:crypto";
import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import { agentEvents } from "@/db/schema/agent";
import { analyzeInventoryPhotos } from "./deal-inventory";

const FENSTER_MS = 24 * 60 * 60_000;
const MAX_VERSUCHE = 2;

export async function fotosVormerken(
  workspaceId: string,
  dealRecordId: string,
  conversationId: string | null,
  attachmentIds: readonly string[]
): Promise<void> {
  if (attachmentIds.length === 0) return;
  const ids = [...attachmentIds].sort();
  await db
    .insert(agentEvents)
    .values({
      workspaceId,
      dealRecordId,
      conversationId,
      engine: "inventar",
      eventType: "fotos_offen",
      payload: { attachmentIds: ids },
      idempotencyKey: `fotos-offen:${dealRecordId}:${createHash("sha1").update(ids.join(",")).digest("hex").slice(0, 16)}`,
    })
    .onConflictDoNothing();
}

/**
 * Einen offenen Foto-Stapel analysieren; null, wenn nichts offen ist.
 * Der Versuch wird vor der Analyse gezählt: bricht Vercel den Lauf ab, zählt er
 * trotzdem, und nach zwei Versuchen kommt der nächste Stapel dran.
 */
export async function fotosAbarbeiten(jetzt = new Date()): Promise<{ stapel: number; ergebnis: string } | null> {
  const seit = new Date(jetzt.getTime() - FENSTER_MS);
  const offen = await db
    .select({ id: agentEvents.id, workspaceId: agentEvents.workspaceId, dealRecordId: agentEvents.dealRecordId, payload: agentEvents.payload })
    .from(agentEvents)
    .where(and(eq(agentEvents.eventType, "fotos_offen"), gt(agentEvents.createdAt, seit)))
    .orderBy(agentEvents.createdAt);
  if (offen.length === 0) return null;
  const spaeter = await db
    .select({ eventType: agentEvents.eventType, payload: agentEvents.payload })
    .from(agentEvents)
    .where(and(inArray(agentEvents.eventType, ["fotos_versuch", "fotos_erledigt"]), gt(agentEvents.createdAt, seit)));
  const fertig = new Set<number>();
  const versuche = new Map<number, number>();
  for (const e of spaeter) {
    const bezug = (e.payload as { bezug?: number }).bezug;
    if (typeof bezug !== "number") continue;
    if (e.eventType === "fotos_erledigt") fertig.add(bezug);
    else versuche.set(bezug, (versuche.get(bezug) ?? 0) + 1);
  }
  const naechster = offen.find((o) => !fertig.has(o.id) && (versuche.get(o.id) ?? 0) < MAX_VERSUCHE && o.dealRecordId);
  if (!naechster) return null;

  const versuch = (versuche.get(naechster.id) ?? 0) + 1;
  const gebucht = await db
    .insert(agentEvents)
    .values({
      workspaceId: naechster.workspaceId,
      dealRecordId: naechster.dealRecordId,
      engine: "inventar",
      eventType: "fotos_versuch",
      payload: { bezug: naechster.id, versuch },
      idempotencyKey: `fotos-versuch:${naechster.id}:${versuch}`,
    })
    .onConflictDoNothing()
    .returning({ id: agentEvents.id });
  // Ein anderer Lauf hat diesen Versuch schon gebucht.
  if (gebucht.length === 0) return null;

  const ids = ((naechster.payload as { attachmentIds?: string[] }).attachmentIds ?? []).filter((x) => typeof x === "string");
  let fehler: string | null;
  let r: Awaited<ReturnType<typeof analyzeInventoryPhotos>> | null = null;
  try {
    r = await analyzeInventoryPhotos(naechster.workspaceId, naechster.dealRecordId!, { attachmentIds: ids, background: true });
    fehler = r.error ?? null;
  } catch (err) {
    fehler = err instanceof Error ? err.message : String(err);
  }
  await db
    .insert(agentEvents)
    .values({
      workspaceId: naechster.workspaceId,
      dealRecordId: naechster.dealRecordId,
      engine: "inventar",
      eventType: fehler ? "fotos_fehler" : "fotos_erledigt",
      payload: { bezug: naechster.id, ...(fehler || !r ? { error: (fehler ?? "").slice(0, 300), versuch } : { analysiert: r.photosAnalyzed, zugeordnet: r.matched, neu: r.added }) },
      idempotencyKey: fehler ? `fotos-fehler:${naechster.id}:${versuch}` : `fotos-erledigt:${naechster.id}`,
    })
    .onConflictDoNothing();
  return { stapel: naechster.id, ergebnis: fehler || !r ? `fehler: ${(fehler ?? "").slice(0, 80)}` : `${r.photosAnalyzed} Fotos, ${r.matched} zugeordnet, ${r.added} neu` };
}
