/**
 * Fotoanalyse als eigene Warteschlange (2026-09-29). Vorher lief sie im
 * Antwort-Lauf des Agenten und dauerte bis zu 270 Sekunden; zusammen mit der
 * Lead-Auswertung sprengte das Vercels 300-Sekunden-Grenze, der Lauf wurde
 * abgebrochen und der Kunde (Lead "Patrick") bekam nie einen Entwurf.
 * Jetzt merkt der Agent neue Fotos nur vor, der Cron /api/cron/fotos-analysieren
 * arbeitet je Lauf einen Stapel ab (höchstens zwei Versuche in 24 Stunden).
 *
 * Stapelgröße (2026-10-07): Ein Lauf hat etwa 270 Sekunden. Gemessen: 1 Foto
 * 72 bis 104 s, 3 Fotos 261 s, 4 Fotos Zeitüberschreitung; 13 und 30 Fotos
 * (Leads „Beatrice“, d2af27e0) brachen ab, die Umzugsgutliste blieb leer. Darum
 * höchstens 2 Fotos je Stapel. Ein Stapel, der zweimal scheitert, wird den
 * internen Nummern gemeldet, statt still zu verschwinden.
 */
import { createHash } from "node:crypto";
import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import { agentEvents } from "@/db/schema/agent";
import { dealNumbers } from "@/db/schema/financial";
import { attributes } from "@/db/schema/objects";
import { recordValues } from "@/db/schema/records";
import { analyzeInventoryPhotos } from "./deal-inventory";
import { sendeAnInterne } from "./intern/intern-senden";

const FENSTER_MS = 24 * 60 * 60_000;
const MAX_VERSUCHE = 2;
/** Fotos je Analyse-Lauf, siehe Kopfkommentar. */
export const FOTOS_JE_LAUF = 2;

export function inStapel<T>(ids: readonly T[], groesse: number): T[][] {
  const stapel: T[][] = [];
  for (let i = 0; i < ids.length; i += groesse) stapel.push(ids.slice(i, i + groesse));
  return stapel;
}

interface OffenerStapel {
  id: number;
  workspaceId: string;
  dealRecordId: string | null;
  payload: unknown;
}

interface SpaeteresEreignis {
  eventType: string;
  payload: unknown;
}

function fotoIds(o: OffenerStapel): string[] {
  return ((o.payload as { attachmentIds?: unknown[] }).attachmentIds ?? []).filter(
    (x): x is string => typeof x === "string"
  );
}

/**
 * Was dieser Lauf tut: gescheiterte Stapel melden, zu große Altstapel
 * aufteilen, dann höchstens einen kleinen Stapel analysieren.
 */
export function planeLauf(input: {
  offen: OffenerStapel[];
  spaeter: SpaeteresEreignis[];
}): { aufgeben: OffenerStapel[]; aufteilen: OffenerStapel[]; naechster: OffenerStapel | null } {
  const fertig = new Set<number>();
  const gemeldet = new Set<number>();
  const versuche = new Map<number, number>();
  for (const e of input.spaeter) {
    const bezug = (e.payload as { bezug?: number }).bezug;
    if (typeof bezug !== "number") continue;
    if (e.eventType === "fotos_erledigt") fertig.add(bezug);
    else if (e.eventType === "fotos_aufgegeben") gemeldet.add(bezug);
    else if (e.eventType === "fotos_versuch") versuche.set(bezug, (versuche.get(bezug) ?? 0) + 1);
  }
  const offen = input.offen.filter((o) => !fertig.has(o.id) && o.dealRecordId);
  const n = (o: OffenerStapel) => versuche.get(o.id) ?? 0;
  return {
    aufgeben: offen.filter((o) => n(o) >= MAX_VERSUCHE && !gemeldet.has(o.id)),
    aufteilen: offen.filter((o) => n(o) < MAX_VERSUCHE && fotoIds(o).length > FOTOS_JE_LAUF),
    naechster: offen.find((o) => n(o) < MAX_VERSUCHE && fotoIds(o).length <= FOTOS_JE_LAUF) ?? null,
  };
}

export function alarmText(input: { bezeichnung: string; fotos: number; fehler: string | null }): string {
  return [
    `Fotos zu ${input.bezeichnung} (${input.fotos} Fotos) konnten nach ${MAX_VERSUCHE} Versuchen nicht ausgewertet werden${input.fehler ? ` (${input.fehler})` : ""}.`,
    "Bitte das Umzugsgut von Hand prüfen oder ergänzen, bevor ein KV rausgeht.",
  ].join("\n");
}

function offenSchluessel(dealRecordId: string, ids: readonly string[]): string {
  return `fotos-offen:${dealRecordId}:${createHash("sha1").update([...ids].sort().join(",")).digest("hex").slice(0, 16)}`;
}

export async function fotosVormerken(
  workspaceId: string,
  dealRecordId: string,
  conversationId: string | null,
  attachmentIds: readonly string[]
): Promise<void> {
  if (attachmentIds.length === 0) return;
  const stapel = inStapel([...attachmentIds].sort(), FOTOS_JE_LAUF);
  await db
    .insert(agentEvents)
    .values(
      stapel.map((ids) => ({
        workspaceId,
        dealRecordId,
        conversationId,
        engine: "inventar",
        eventType: "fotos_offen",
        payload: { attachmentIds: ids },
        idempotencyKey: offenSchluessel(dealRecordId, ids),
      }))
    )
    .onConflictDoNothing();
}

/** „Auftrag 2026-074, Beatrice Fallscheer“ für die interne Meldung. */
async function dealBezeichnung(dealRecordId: string): Promise<string> {
  const [nr] = await db
    .select({ dealNumber: dealNumbers.dealNumber })
    .from(dealNumbers)
    .where(eq(dealNumbers.dealRecordId, dealRecordId))
    .limit(1);
  const [name] = await db
    .select({ text: recordValues.textValue })
    .from(recordValues)
    .innerJoin(attributes, eq(recordValues.attributeId, attributes.id))
    .where(and(eq(recordValues.recordId, dealRecordId), eq(attributes.slug, "name")))
    .limit(1);
  const teile = [nr?.dealNumber ? `Auftrag ${nr.dealNumber}` : "Lead", name?.text ?? null].filter(Boolean);
  return teile.length > 1 ? teile.join(", ") : `Lead ${dealRecordId.slice(0, 8)}`;
}

/** Gescheiterten Stapel einmalig melden. */
async function aufgebenUndMelden(stapel: OffenerStapel, fehler: string | null): Promise<void> {
  const gebucht = await db
    .insert(agentEvents)
    .values({
      workspaceId: stapel.workspaceId,
      dealRecordId: stapel.dealRecordId,
      engine: "inventar",
      eventType: "fotos_aufgegeben",
      payload: { bezug: stapel.id },
      idempotencyKey: `fotos-aufgegeben:${stapel.id}`,
    })
    .onConflictDoNothing()
    .returning({ id: agentEvents.id });
  if (gebucht.length === 0) return;
  try {
    const bezeichnung = await dealBezeichnung(stapel.dealRecordId!);
    await sendeAnInterne(stapel.workspaceId, alarmText({ bezeichnung, fotos: fotoIds(stapel).length, fehler }), { nachholen: true });
  } catch (err) {
    console.error("[inventar-fotos] Meldung fehlgeschlagen:", err);
  }
}

/** Zu großen Altstapel in Laufgröße neu vormerken und den alten schließen. */
async function aufteilen(stapel: OffenerStapel): Promise<void> {
  const ids = fotoIds(stapel);
  await db
    .insert(agentEvents)
    .values(
      inStapel(ids, FOTOS_JE_LAUF).map((teil) => ({
        workspaceId: stapel.workspaceId,
        dealRecordId: stapel.dealRecordId,
        engine: "inventar",
        eventType: "fotos_offen",
        payload: { attachmentIds: teil },
        idempotencyKey: offenSchluessel(stapel.dealRecordId!, teil),
      }))
    )
    .onConflictDoNothing();
  await db
    .insert(agentEvents)
    .values({
      workspaceId: stapel.workspaceId,
      dealRecordId: stapel.dealRecordId,
      engine: "inventar",
      eventType: "fotos_erledigt",
      payload: { bezug: stapel.id, aufgeteilt: Math.ceil(ids.length / FOTOS_JE_LAUF) },
      idempotencyKey: `fotos-erledigt:${stapel.id}`,
    })
    .onConflictDoNothing();
}

/**
 * Einen offenen Foto-Stapel analysieren; null, wenn nichts offen ist.
 * Der Versuch wird vor der Analyse gezählt: bricht Vercel den Lauf ab, zählt er
 * trotzdem, und nach zwei Versuchen wird der Stapel gemeldet.
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
    .where(
      and(
        inArray(agentEvents.eventType, ["fotos_versuch", "fotos_erledigt", "fotos_fehler", "fotos_aufgegeben"]),
        gt(agentEvents.createdAt, seit)
      )
    );
  const plan = planeLauf({ offen, spaeter });

  for (const stapel of plan.aufgeben) {
    const fehler = spaeter
      .filter((e) => e.eventType === "fotos_fehler" && (e.payload as { bezug?: number }).bezug === stapel.id)
      .map((e) => String((e.payload as { error?: string }).error ?? ""))
      .pop();
    await aufgebenUndMelden(stapel, fehler ? fehler.slice(0, 120) : null);
  }
  for (const stapel of plan.aufteilen) await aufteilen(stapel);

  const naechster = plan.naechster;
  if (!naechster) return null;

  const versuch = spaeter.filter((e) => e.eventType === "fotos_versuch" && (e.payload as { bezug?: number }).bezug === naechster.id).length + 1;
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

  const ids = fotoIds(naechster);
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
