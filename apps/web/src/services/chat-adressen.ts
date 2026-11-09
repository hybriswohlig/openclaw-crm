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
import { adressenAusNachrichten, chatAdressenWaehlen, kartonsAusKi, kartonsAusNachrichten } from "@/lib/chat-adressen";
import type { ChatAdressen } from "@/lib/kalkulation-p15";

/** Höchstens so viele eingehende Nachrichten werden gelesen (die neuesten). */
const NACHRICHTEN_MAX = 300;

function textOderNull(w: unknown): string | null {
  return typeof w === "string" && w.trim() !== "" ? w.trim() : null;
}

/** Letztes KI-Ereignis mit Plan-15-Feldern (`adressen`, `kartons`), sonst null. */
async function kiAngaben(ws: string, deal: string): Promise<{ von: string | null; nach: string | null; kartons: number | null } | null> {
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
  const p = e?.payload as { adressen?: { von?: unknown; nach?: unknown }; kartons?: unknown } | undefined;
  if (!p) return null;
  const a: { von?: unknown; nach?: unknown } = p.adressen && typeof p.adressen === "object" ? p.adressen : {};
  return { von: textOderNull(a.von), nach: textOderNull(a.nach), kartons: kartonsAusKi(p.kartons) };
}

/** Von der KI zuletzt herausgezogene Adressen (Ereignis-Payload `adressen`), sonst null. */
export async function kiAdressen(ws: string, deal: string): Promise<{ von: string | null; nach: string | null } | null> {
  const k = await kiAngaben(ws, deal);
  return k ? { von: k.von, nach: k.nach } : null;
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

export interface ChatAngaben {
  adressen: ChatAdressen | null;
  /** Bauteil 13: Umzugskartons aus dem Chat (oberer Wert einer Spanne), unbestätigt. */
  kartons: { anzahl: number; quelle: "ki" | "erkennung" } | null;
}

/**
 * Chat-Angaben für das, was im Lead fehlt: Adressen je Seite und die Kartonzahl.
 * Fehlt nichts, wird nichts gelesen. Wirft nie: ohne Chat-Angabe rechnet der
 * Rechner wie bisher.
 */
export async function ladeChatAngaben(
  ws: string,
  deal: string,
  lead: { von: string | null; nach: string | null; kartonsFehlen: boolean; zielGesucht?: boolean }
): Promise<ChatAngaben> {
  // Ohne Ziel (Entrümpelung, Küchenmontage) wird die Entladeseite nie aus dem Chat gefüllt.
  const ohneZiel = lead.zielGesucht === false;
  const adressenFehlen = !lead.von || (!ohneZiel && !lead.nach);
  if (!adressenFehlen && !lead.kartonsFehlen) return { adressen: null, kartons: null };
  try {
    const ki = await kiAngaben(ws, deal);
    const kiReicht = (!adressenFehlen || ((lead.von || ki?.von) && (ohneZiel || lead.nach || ki?.nach))) && (!lead.kartonsFehlen || ki?.kartons);
    const texte = kiReicht ? null : await eingehendeTexte(ws, deal);
    let adressen: ChatAdressen | null = null;
    if (adressenFehlen) {
      const c = chatAdressenWaehlen(lead, ki, texte ? adressenAusNachrichten(texte) : null);
      if (ohneZiel) {
        c.nach = null;
        c.quelleNach = null;
      }
      adressen = c.von || c.nach ? c : null;
    }
    let kartons: ChatAngaben["kartons"] = null;
    if (lead.kartonsFehlen) {
      if (ki?.kartons) kartons = { anzahl: ki.kartons, quelle: "ki" };
      else {
        const n = texte ? kartonsAusNachrichten(texte) : null;
        if (n) kartons = { anzahl: n, quelle: "erkennung" };
      }
    }
    return { adressen, kartons };
  } catch (err) {
    console.error("[chat-adressen]", err);
    return { adressen: null, kartons: null };
  }
}

/** Nur die Adressen (Bauteil 8). */
export async function ladeChatAdressen(
  ws: string,
  deal: string,
  lead: { von: string | null; nach: string | null }
): Promise<ChatAdressen | null> {
  if (lead.von && lead.nach) return null;
  return (await ladeChatAngaben(ws, deal, { ...lead, kartonsFehlen: false })).adressen;
}
