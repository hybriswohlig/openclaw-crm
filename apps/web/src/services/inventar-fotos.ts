/**
 * Fotoanalyse als eigene Warteschlange (2026-09-29). Vorher lief sie im
 * Antwort-Lauf des Agenten und dauerte bis zu 270 Sekunden; zusammen mit der
 * Lead-Auswertung sprengte das Vercels 300-Sekunden-Grenze, der Lauf wurde
 * abgebrochen und der Kunde (Lead "Patrick") bekam nie einen Entwurf.
 * Jetzt merkt der Agent neue Fotos nur vor, der Cron /api/cron/fotos-analysieren
 * arbeitet sie ab (höchstens zwei Versuche je Stapel in 24 Stunden).
 *
 * Ein Foto je Stapel, vier gleichzeitig (2026-10-09, Lead „Jonas“: nur 2 von 11
 * Fotos ausgewertet). Stapel mit 2 Fotos brauchten 122 bis 281 s, die Hälfte lief
 * in die 270-s-Grenze, gescheiterte Stapel wurden aufgegeben, und je Lauf alle
 * 10 Minuten ging nur ein Stapel durch. Mit knapper Antwort und Grok-Effort low
 * dauert ein Foto 28 bis 67 s. Gescheiterte Mehrfoto-Stapel werden in
 * Einzelfotos aufgeteilt statt aufgegeben; erst ein Einzelfoto, das zweimal
 * scheitert, wird den internen Nummern gemeldet.
 */
import { createHash } from "node:crypto";
import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import { agentEvents } from "@/db/schema/agent";
import { dealNumbers } from "@/db/schema/financial";
import { attributes } from "@/db/schema/objects";
import { recordValues } from "@/db/schema/records";
import { fotoItemsUebernehmen, fotosErkennen, loadDealInventoryPhotos } from "./deal-inventory";
import { sendeAnInterne } from "./intern/intern-senden";
import { kalkulationAnstossen } from "./rechner/ausloeser";

const FENSTER_MS = 24 * 60 * 60_000;
/** Rückblick für den Hinweis im KV-Fenster: auch ältere gescheiterte Fotos zählen. */
const STAND_FENSTER_MS = 30 * 24 * 60 * 60_000;
/** Ein Versuch ohne Ergebnis gilt so lange als laufend (Lauf höchstens 300 s). */
const LAEUFT_MS = 6 * 60_000;
const MAX_VERSUCHE = 2;
/** Fotos je Analyse-Stapel, siehe Kopfkommentar. */
export const FOTOS_JE_LAUF = 1;
/** Stapel je Cron-Lauf, gleichzeitig erkannt. */
export const GLEICHZEITIG = 4;

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
  createdAt?: Date;
}

function fotoIds(o: OffenerStapel): string[] {
  return ((o.payload as { attachmentIds?: unknown[] }).attachmentIds ?? []).filter(
    (x): x is string => typeof x === "string"
  );
}

function bezugVon(e: SpaeteresEreignis): number | null {
  const bezug = (e.payload as { bezug?: unknown }).bezug;
  return typeof bezug === "number" ? bezug : null;
}

/** Je Stapel: Versuche, Fehler, letzter Versuch, erledigt, gemeldet. */
function stapelLage(spaeter: readonly SpaeteresEreignis[]) {
  const lage = new Map<number, { versuche: number; fehler: number; letzterVersuch: number; erledigt: boolean; aufgeteilt: boolean; gemeldet: boolean }>();
  const von = (id: number) => {
    let l = lage.get(id);
    if (!l) lage.set(id, (l = { versuche: 0, fehler: 0, letzterVersuch: 0, erledigt: false, aufgeteilt: false, gemeldet: false }));
    return l;
  };
  for (const e of spaeter) {
    const bezug = bezugVon(e);
    if (bezug === null) continue;
    const l = von(bezug);
    if (e.eventType === "fotos_erledigt") {
      l.erledigt = true;
      if ((e.payload as { aufgeteilt?: unknown }).aufgeteilt != null) l.aufgeteilt = true;
    } else if (e.eventType === "fotos_aufgegeben") l.gemeldet = true;
    else if (e.eventType === "fotos_fehler") l.fehler++;
    else if (e.eventType === "fotos_versuch") {
      l.versuche++;
      l.letzterVersuch = Math.max(l.letzterVersuch, e.createdAt?.getTime() ?? 0);
    }
  }
  return (id: number) => lage.get(id) ?? { versuche: 0, fehler: 0, letzterVersuch: 0, erledigt: false, aufgeteilt: false, gemeldet: false };
}

/** Abwechselnd je Lead, damit 24 Fotos eines Leads die anderen nicht blockieren. */
function abwechselndJeLead<T extends OffenerStapel>(stapel: readonly T[]): T[] {
  const jeLead = new Map<string, T[]>();
  for (const o of stapel) {
    const liste = jeLead.get(o.dealRecordId ?? "") ?? [];
    liste.push(o);
    jeLead.set(o.dealRecordId ?? "", liste);
  }
  const reihen = [...jeLead.values()];
  const ergebnis: T[] = [];
  for (let i = 0; ergebnis.length < stapel.length; i++) {
    for (const reihe of reihen) if (reihe[i]) ergebnis.push(reihe[i]!);
  }
  return ergebnis;
}

/**
 * Was dieser Lauf tut: gescheiterte Einzelfotos melden, Mehrfoto-Stapel (alte
 * oder gescheiterte) in Einzelfotos aufteilen, dann bis zu GLEICHZEITIG
 * Einzelfotos erkennen. Stapel mit einem laufenden Versuch bleiben unberührt.
 */
export function planeLauf<T extends OffenerStapel>(input: {
  offen: T[];
  spaeter: SpaeteresEreignis[];
  jetzt: Date;
}): { aufgeben: T[]; aufteilen: T[]; naechste: T[] } {
  const lage = stapelLage(input.spaeter);
  const laeuft = (o: T) => {
    const l = lage(o.id);
    return l.versuche > l.fehler && input.jetzt.getTime() - l.letzterVersuch < LAEUFT_MS;
  };
  const offen = input.offen.filter((o) => !lage(o.id).erledigt && o.dealRecordId && !laeuft(o));
  const einzeln = offen.filter((o) => fotoIds(o).length <= FOTOS_JE_LAUF);
  return {
    aufgeben: einzeln.filter((o) => lage(o.id).versuche >= MAX_VERSUCHE && !lage(o.id).gemeldet),
    aufteilen: offen.filter((o) => fotoIds(o).length > FOTOS_JE_LAUF),
    naechste: abwechselndJeLead(einzeln.filter((o) => lage(o.id).versuche < MAX_VERSUCHE)).slice(0, GLEICHZEITIG),
  };
}

/**
 * Fotos eines Leads für den Hinweis im KV-Fenster, je Foto gezählt: ausgewertet
 * (in irgendeinem erledigten Stapel), offen (Stapel im 24-Stunden-Fenster, der
 * noch läuft oder aufgeteilt wird) oder gescheitert (aufgegeben, zweimal
 * gescheitert oder aus dem Fenster gefallen, ohne je ausgewertet zu sein).
 */
export function fotoStandBerechnen(input: {
  stapel: Array<OffenerStapel & { createdAt: Date }>;
  spaeter: SpaeteresEreignis[];
  jetzt: Date;
}): { offen: number; gescheitert: number } {
  const lage = stapelLage(input.spaeter);
  const ausgewertet = new Set<string>();
  const offen = new Set<string>();
  const gescheitert = new Set<string>();
  for (const s of input.stapel) {
    const l = lage(s.id);
    if (l.aufgeteilt) continue;
    const ids = fotoIds(s);
    if (l.erledigt) {
      ids.forEach((id) => ausgewertet.add(id));
      continue;
    }
    const imFenster = input.jetzt.getTime() - s.createdAt.getTime() < FENSTER_MS;
    const aufgegeben = l.gemeldet || l.fehler >= MAX_VERSUCHE;
    const wirdNochBearbeitet = imFenster && (ids.length > FOTOS_JE_LAUF || !aufgegeben);
    ids.forEach((id) => (wirdNochBearbeitet ? offen : gescheitert).add(id));
  }
  const zaehle = (menge: Set<string>, ohne: Set<string>[]) => [...menge].filter((id) => ohne.every((m) => !m.has(id))).length;
  return { offen: zaehle(offen, [ausgewertet]), gescheitert: zaehle(gescheitert, [ausgewertet, offen]) };
}

/** Foto-Stand eines Leads aus der Datenbank (für das KV-Fenster). */
export async function fotoStand(dealRecordId: string, jetzt = new Date()): Promise<{ offen: number; gescheitert: number }> {
  const seit = new Date(jetzt.getTime() - STAND_FENSTER_MS);
  const stapel = await db
    .select({ id: agentEvents.id, workspaceId: agentEvents.workspaceId, dealRecordId: agentEvents.dealRecordId, payload: agentEvents.payload, createdAt: agentEvents.createdAt })
    .from(agentEvents)
    .where(and(eq(agentEvents.dealRecordId, dealRecordId), eq(agentEvents.eventType, "fotos_offen"), gt(agentEvents.createdAt, seit)));
  if (stapel.length === 0) return { offen: 0, gescheitert: 0 };
  const spaeter = await db
    .select({ eventType: agentEvents.eventType, payload: agentEvents.payload })
    .from(agentEvents)
    .where(
      and(
        eq(agentEvents.dealRecordId, dealRecordId),
        inArray(agentEvents.eventType, ["fotos_erledigt", "fotos_fehler", "fotos_aufgegeben"]),
        gt(agentEvents.createdAt, seit)
      )
    );
  return fotoStandBerechnen({ stapel, spaeter, jetzt });
}

/**
 * Führt Schritte je Schlüssel nacheinander aus, verschiedene Schlüssel
 * laufen nebeneinander. Ein Fehler hält den nächsten Schritt nicht auf.
 */
export function nacheinanderJe() {
  const ketten = new Map<string, Promise<unknown>>();
  return <T>(schluessel: string, schritt: () => Promise<T>): Promise<T> => {
    const lauf = (ketten.get(schluessel) ?? Promise.resolve()).then(schritt, schritt);
    ketten.set(schluessel, lauf.catch(() => undefined));
    return lauf;
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

/**
 * Schlüssel eines Teilstapels: mit dem Elternstapel, sonst schluckte ein alter
 * Stapel mit demselben Foto den neuen still (onConflictDoNothing), während der
 * Elternstapel schon als aufgeteilt gilt.
 */
export function teilSchluessel(dealRecordId: string, ids: readonly string[], elternId: number): string {
  return `${offenSchluessel(dealRecordId, ids)}:aus:${elternId}`;
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

/** Mehrfoto-Stapel in Einzelfotos neu vormerken und den alten schließen. */
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
        idempotencyKey: teilSchluessel(stapel.dealRecordId!, teil, stapel.id),
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

interface Ergebnis {
  stapel: number;
  ergebnis: string;
}

/**
 * Bis zu GLEICHZEITIG offene Einzelfotos erkennen; leere Liste, wenn nichts
 * offen ist. Der Versuch wird vor der Analyse gezählt: bricht Vercel den Lauf
 * ab, zählt er trotzdem, und nach zwei Versuchen wird das Foto gemeldet. Die
 * Erkennung läuft gleichzeitig, das Übernehmen ins Umzugsgut je Lead
 * nacheinander, damit dasselbe Sofa auf zwei Fotos nicht zwei Zeilen anlegt.
 */
export async function fotosAbarbeiten(jetzt = new Date()): Promise<Ergebnis[]> {
  const seit = new Date(jetzt.getTime() - FENSTER_MS);
  const offen = await db
    .select({ id: agentEvents.id, workspaceId: agentEvents.workspaceId, dealRecordId: agentEvents.dealRecordId, payload: agentEvents.payload })
    .from(agentEvents)
    .where(and(eq(agentEvents.eventType, "fotos_offen"), gt(agentEvents.createdAt, seit)))
    .orderBy(agentEvents.createdAt);
  if (offen.length === 0) return [];
  const spaeter = await db
    .select({ eventType: agentEvents.eventType, payload: agentEvents.payload, createdAt: agentEvents.createdAt })
    .from(agentEvents)
    .where(
      and(
        inArray(agentEvents.eventType, ["fotos_versuch", "fotos_erledigt", "fotos_fehler", "fotos_aufgegeben"]),
        gt(agentEvents.createdAt, seit)
      )
    );
  const plan = planeLauf({ offen, spaeter, jetzt });

  for (const stapel of plan.aufgeben) {
    const fehler = spaeter
      .filter((e) => e.eventType === "fotos_fehler" && bezugVon(e) === stapel.id)
      .map((e) => String((e.payload as { error?: string }).error ?? ""))
      .pop();
    await aufgebenUndMelden(stapel, fehler ? fehler.slice(0, 120) : null);
  }
  for (const stapel of plan.aufteilen) await aufteilen(stapel);

  const nacheinander = nacheinanderJe();
  const geaendert = new Map<string, string>();
  const ergebnisse = await Promise.all(
    plan.naechste.map(async (stapel): Promise<Ergebnis | null> => {
      const versuch = spaeter.filter((e) => e.eventType === "fotos_versuch" && bezugVon(e) === stapel.id).length + 1;
      const gebucht = await db
        .insert(agentEvents)
        .values({
          workspaceId: stapel.workspaceId,
          dealRecordId: stapel.dealRecordId,
          engine: "inventar",
          eventType: "fotos_versuch",
          payload: { bezug: stapel.id, versuch },
          idempotencyKey: `fotos-versuch:${stapel.id}:${versuch}`,
        })
        .onConflictDoNothing()
        .returning({ id: agentEvents.id });
      // Ein anderer Lauf hat diesen Versuch schon gebucht.
      if (gebucht.length === 0) return null;

      const dealRecordId = stapel.dealRecordId!;
      let fehler: string | null = null;
      let r: { analysiert: number; zugeordnet: number; neu: number } | null = null;
      try {
        const fotos = await loadDealInventoryPhotos(stapel.workspaceId, dealRecordId, fotoIds(stapel));
        const erkannt = fotos.length === 0
          ? ({ ok: false, error: "keine Kundenfotos am Lead", skipped: 0 } as const)
          // Nicht background: die Hintergrundspur des VPS hat einen Platz, vier
          // Fotos warteten aufeinander bis über die 290 s des Abrufs. Gemessen:
          // vier Grok-Fotojobs lassen die CPU zu 75 bis 94 % frei.
          : await fotosErkennen(stapel.workspaceId, fotos, {});
        if (!erkannt.ok) fehler = erkannt.error;
        else {
          const u = await nacheinander(dealRecordId, () => fotoItemsUebernehmen(stapel.workspaceId, dealRecordId, erkannt.items, erkannt));
          r = { analysiert: erkannt.analyzed, zugeordnet: u.matched, neu: u.added };
          if (u.matched + u.added > 0) geaendert.set(dealRecordId, stapel.workspaceId);
        }
      } catch (err) {
        fehler = err instanceof Error ? err.message : String(err);
      }
      await db
        .insert(agentEvents)
        .values({
          workspaceId: stapel.workspaceId,
          dealRecordId,
          engine: "inventar",
          eventType: fehler || !r ? "fotos_fehler" : "fotos_erledigt",
          payload: { bezug: stapel.id, ...(fehler || !r ? { error: (fehler ?? "").slice(0, 300), versuch } : r) },
          idempotencyKey: fehler || !r ? `fotos-fehler:${stapel.id}:${versuch}` : `fotos-erledigt:${stapel.id}`,
        })
        .onConflictDoNothing();
      return { stapel: stapel.id, ergebnis: fehler || !r ? `fehler: ${(fehler ?? "").slice(0, 80)}` : `${r.analysiert} Fotos, ${r.zugeordnet} zugeordnet, ${r.neu} neu` };
    })
  );
  // Einmal je Lead neu rechnen, nicht je Foto.
  for (const [dealRecordId, workspaceId] of geaendert) kalkulationAnstossen(workspaceId, dealRecordId);
  return ergebnisse.filter((e): e is Ergebnis => e !== null);
}
