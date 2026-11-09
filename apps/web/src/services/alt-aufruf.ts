/**
 * Plan 14, Task W: gerenderte alte Seiten zählen (Grundlage der Lösch-Checkliste).
 *
 * Je Aufruf ein Eintrag in activity_events mit event_type `alte_seite.aufruf`,
 * record_id null (erscheint in keinem Deal-Protokoll), Nutzlast `AltAufruf`.
 * Höchstens ein Eintrag je Nutzer, Pfad und Minute: Prüfen und Schreiben laufen
 * unter einer Advisory-Sperre auf genau diesen Schlüssel.
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents } from "@/db/schema";
import { ALT_AUFRUF_EVENT, type AltAufruf } from "@/lib/dunkel-abschaltung";

export const PFAD_MAX = 200;

/**
 * Oberste Segmente der alten Oberfläche (Ordner unter app/(dashboard), ohne
 * pending-approval). Nur Pfade darunter werden gezählt; ein Test hält die Liste
 * mit den Ordnern gleich.
 */
export const ALTE_PRAEFIXE = [
  "admin",
  "anrufe",
  "contract-calendar",
  "email",
  "employees",
  "financial",
  "home",
  "inbox",
  "integrations",
  "leads",
  "lists",
  "notes",
  "notifications",
  "objects",
  "operations",
  "search",
  "settings",
  "sichtbarkeit",
  "statistics",
  "tasks",
] as const;

/** Pfad ohne Abfrage und Anker, höchstens 200 Zeichen; null, wenn es kein Pfad ist. */
export function altPfad(roh: unknown): string | null {
  if (typeof roh !== "string") return null;
  const pfad = roh.split(/[?#]/)[0];
  if (!pfad.startsWith("/") || pfad.startsWith("//")) return null;
  return pfad.slice(0, PFAD_MAX);
}

/** Liegt der Pfad unter einem Präfix der alten Oberfläche? */
export function istAlterPfad(pfad: string): boolean {
  const erstes = pfad.split("/")[1] ?? "";
  return (ALTE_PRAEFIXE as readonly string[]).includes(erstes);
}

export function uiAusCookie(wert: string | undefined | null): AltAufruf["ui"] {
  return wert === "neu" || wert === "alt" ? wert : null;
}

export async function altAufrufMerken(
  ws: string,
  userId: string,
  a: AltAufruf,
  jetzt: Date = new Date()
): Promise<"gemerkt" | "doppelt"> {
  const minute = new Date(Math.floor(jetzt.getTime() / 60_000) * 60_000);
  const bis = new Date(minute.getTime() + 60_000);
  return db.transaction(async (tx) => {
    const schluessel = `alt-aufruf:${userId}:${a.pfad}:${minute.toISOString()}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${schluessel}))`);
    const [schon] = await tx
      .select({ id: activityEvents.id })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.eventType, ALT_AUFRUF_EVENT),
          gte(activityEvents.createdAt, minute),
          lt(activityEvents.createdAt, bis),
          eq(activityEvents.workspaceId, ws),
          eq(activityEvents.actorId, userId),
          sql`${activityEvents.payload}->>'pfad' = ${a.pfad}`
        )
      )
      .limit(1);
    if (schon) return "doppelt";
    const payload: AltAufruf = { pfad: a.pfad, ui: a.ui, mitAlt: a.mitAlt };
    await tx.insert(activityEvents).values({
      workspaceId: ws,
      recordId: null,
      objectSlug: null,
      eventType: ALT_AUFRUF_EVENT,
      payload,
      actorId: userId,
      createdAt: jetzt,
    });
    return "gemerkt";
  });
}
