/**
 * Plan 15, Bauteil 8: Adressen aus dem Chat für die Rechner-Anfrage laden.
 *
 * Quellen in dieser Reihenfolge (nur für Seiten, die im Lead leer sind):
 * 1. das letzte Ereignis `ai.insights_extracted` des Deals (Feld `adressen`, das
 *    `applyDealInsights` seit Plan 15 mitschreibt), auch wenn niemand die Werte
 *    ins Lead übernommen hat;
 * 2. eine Erkennung in den eingehenden Nachrichten der Gespräche dieses Deals.
 * Mandantentrennung: beide Abfragen filtern auf Workspace und Deal; eigene
 * ausgehende Nachrichten zählen nie.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents } from "@/db/schema";
import { inboxConversations, inboxMessages } from "@/db/schema/inbox";
import { adressenAusNachrichten, chatAdressenWaehlen } from "@/lib/chat-adressen";
import type { ChatAdressen } from "@/lib/kalkulation-p15";

/** Höchstens so viele eingehende Nachrichten werden gelesen (die neuesten). */
const NACHRICHTEN_MAX = 300;

function textOderNull(w: unknown): string | null {
  return typeof w === "string" && w.trim() !== "" ? w.trim() : null;
}

/** Von der KI zuletzt herausgezogene Adressen (Ereignis-Payload `adressen`), sonst null. */
export async function kiAdressen(ws: string, deal: string): Promise<{ von: string | null; nach: string | null } | null> {
  const [e] = await db
    .select({ payload: activityEvents.payload })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.workspaceId, ws),
        eq(activityEvents.recordId, deal),
        eq(activityEvents.eventType, "ai.insights_extracted"),
        sql`${activityEvents.payload} ? 'adressen'`
      )
    )
    .orderBy(desc(activityEvents.createdAt))
    .limit(1);
  const a = (e?.payload as { adressen?: { von?: unknown; nach?: unknown } } | undefined)?.adressen;
  if (!a || typeof a !== "object") return null;
  return { von: textOderNull(a.von), nach: textOderNull(a.nach) };
}

/** Texte der eingehenden Nachrichten der Gespräche dieses Deals, älteste zuerst. */
export async function eingehendeTexte(ws: string, deal: string): Promise<string[]> {
  const zeilen = await db
    .select({ body: inboxMessages.body })
    .from(inboxMessages)
    .innerJoin(inboxConversations, eq(inboxConversations.id, inboxMessages.conversationId))
    .where(
      and(
        eq(inboxMessages.workspaceId, ws),
        eq(inboxConversations.workspaceId, ws),
        eq(inboxConversations.dealRecordId, deal),
        eq(inboxMessages.direction, "inbound")
      )
    )
    .orderBy(desc(sql`coalesce(${inboxMessages.sentAt}, ${inboxMessages.createdAt})`), asc(inboxMessages.id))
    .limit(NACHRICHTEN_MAX);
  return zeilen.map((z) => z.body ?? "").reverse();
}

/**
 * Chat-Adressen für die Seiten, die im Lead fehlen. Fehlt keine, wird nichts
 * gelesen. Wirft nie: ohne Chat-Angabe rechnet der Rechner wie bisher.
 */
export async function ladeChatAdressen(
  ws: string,
  deal: string,
  lead: { von: string | null; nach: string | null }
): Promise<ChatAdressen | null> {
  if (lead.von && lead.nach) return null;
  try {
    const ki = await kiAdressen(ws, deal);
    const kiReicht = (lead.von || ki?.von) && (lead.nach || ki?.nach);
    const erkennung = kiReicht ? null : adressenAusNachrichten(await eingehendeTexte(ws, deal));
    const c = chatAdressenWaehlen(lead, ki, erkennung);
    return c.von || c.nach ? c : null;
  } catch (err) {
    console.error("[chat-adressen]", err);
    return null;
  }
}
