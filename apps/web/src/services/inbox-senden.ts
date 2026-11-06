/**
 * Senden aus einer Hand: der Textweg der Antwort-Route
 * (api/v1/inbox/conversations/[id]/messages) und die Nebenwirkungen nach einer
 * von Hand geschriebenen Nachricht. Die Route, die Akte und die
 * Bewertungsanfrage nutzen dieselben Funktionen.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { channelAccounts, inboxConversations, inboxMessages } from "@/db/schema/inbox";
import { sendEmailReply } from "@/services/inbox-email";
import {
  isWithinCustomerServiceWindow,
  sendBaileysReply,
  sendWhatsAppReply,
} from "@/services/inbox-whatsapp";
import { setHumanOwned } from "@/services/agent/agent-gate";
import { supersedePendingDrafts } from "@/services/agent/draft-schliessen";
import { setzeLetzteEigeneNachricht } from "@/services/wartet";

export type InboxMessage = typeof inboxMessages.$inferSelect;

/** WhatsApp-Nummer über OpenClaw: der CRM kann darüber nicht senden. */
export class OpenClawAusgehendFehler extends Error {
  constructor() {
    super(
      "This WhatsApp number is bridged via OpenClaw, which does not expose outbound to the CRM. Switch this account to the in-house bridge in Integrations to send replies from here."
    );
    this.name = "OpenClawAusgehendFehler";
  }
}

/** Kein Gespräch mit dieser Id im Workspace. */
export class GespraechNichtGefunden extends Error {
  constructor() {
    super("Conversation not found");
    this.name = "GespraechNichtGefunden";
  }
}

export interface GespraechKanal {
  channelType: string;
  waPhoneNumberId: string | null;
  baileysBridgeProvider: string | null;
  dealRecordId: string | null;
}

/**
 * Kanal und Deal eines Gesprächs aus seinem Kanalkonto. Einziger Ort, an dem
 * der Sendeweg gewählt wird; die Oberfläche wählt nie ein Konto selbst.
 */
export async function ladeGespraechKanal(
  workspaceId: string,
  conversationId: string
): Promise<GespraechKanal | null> {
  const [row] = await db
    .select({
      channelType: channelAccounts.channelType,
      waPhoneNumberId: channelAccounts.waPhoneNumberId,
      baileysBridgeProvider: channelAccounts.baileysBridgeProvider,
      dealRecordId: inboxConversations.dealRecordId,
    })
    .from(inboxConversations)
    .innerJoin(channelAccounts, eq(inboxConversations.channelAccountId, channelAccounts.id))
    .where(
      and(
        eq(inboxConversations.id, conversationId),
        eq(inboxConversations.workspaceId, workspaceId)
      )
    )
    .limit(1);
  return row ?? null;
}

async function sendeTextUeberKanal(
  kanal: GespraechKanal,
  input: { workspaceId: string; conversationId: string; body: string }
): Promise<InboxMessage | null> {
  const params = {
    conversationId: input.conversationId,
    workspaceId: input.workspaceId,
    body: input.body.trim(),
  };
  // Drei Wege innerhalb von WhatsApp:
  //   waPhoneNumberId gesetzt                  → WABA Cloud API
  //   ohne waPhoneNumberId, provider 'inhouse' → eigene Baileys-Bridge
  //   ohne waPhoneNumberId, sonst (OpenClaw)   → kein Ausgang über den CRM
  if (kanal.channelType === "whatsapp") {
    if (kanal.waPhoneNumberId) return sendWhatsAppReply(params);
    if (kanal.baileysBridgeProvider === "inhouse") return sendBaileysReply(params);
    throw new OpenClawAusgehendFehler();
  }
  return sendEmailReply(params);
}

/**
 * Sendet eine Textantwort im Gespräch. Wirft GespraechNichtGefunden,
 * OpenClawAusgehendFehler und die Fehler der Sendedienste (WhatsAppSessionExpiredError,
 * BaileysBridgeNotConfiguredError, BaileysBridgeError, …). Die Nebenwirkungen
 * einer Hand-Nachricht laufen erst mit nachEigenerNachricht.
 *
 * message ist null, wenn die Baileys-Bridge gesendet hat, die Zeile aber nicht
 * gespeichert werden konnte (persistBaileysSendRow); gesendet ist sie trotzdem.
 */
export async function sendeAntwort(input: {
  workspaceId: string;
  conversationId: string;
  body: string;
}): Promise<{ message: InboxMessage | null; dealRecordId: string | null }> {
  const kanal = await ladeGespraechKanal(input.workspaceId, input.conversationId);
  if (!kanal) throw new GespraechNichtGefunden();
  const message = await sendeTextUeberKanal(kanal, input);
  return { message, dealRecordId: kanal.dealRecordId };
}

/**
 * Nach einer von Hand gesendeten Nachricht (Text oder Dokument): das Gespräch
 * geht an den Menschen. Nur die Pause ist Pflicht; alles danach ist
 * Buchhaltung und darf ein erfolgreiches Senden nie scheitern lassen.
 */
export async function nachEigenerNachricht(input: {
  workspaceId: string;
  conversationId: string;
  dealRecordId: string | null;
  userId: string | null;
  sentAt: Date;
  deduped: boolean;
}): Promise<void> {
  const { workspaceId, conversationId, dealRecordId, userId } = input;

  // Der Verkaufsagent schweigt hier, bis er über den Schalter am Gespräch
  // zurückgegeben wird. Die Sendedienste fassen aiNeedsReply/aiPaused nicht an
  // (nur das WABA-Echo löscht aiNeedsReply); die eigenen Sendungen des Agenten
  // laufen nicht hierüber und pausieren darum nie.
  await db
    .update(inboxConversations)
    .set({ aiPaused: true, aiNeedsReply: false, updatedAt: new Date() })
    .where(
      and(
        eq(inboxConversations.id, conversationId),
        eq(inboxConversations.workspaceId, workspaceId)
      )
    );

  // Wartet-Signal: eigene Nachricht an diesem Deal. Ein deduplizierter
  // Dokumentversand hat nichts Neues gesendet und darf den Zeitpunkt nicht
  // vorschieben (der Kunde kann seitdem geantwortet haben).
  if (dealRecordId && !input.deduped) {
    try {
      await setzeLetzteEigeneNachricht(dealRecordId, input.sentAt);
    } catch (wartetErr) {
      console.error("[wartet] setzeLetzteEigeneNachricht failed (non-fatal):", wartetErr);
    }
  }

  // Offene Entwürfe an diesem Gespräch und diesem Deal schließen, damit ein
  // späteres approve_and_send nicht doppelt sendet.
  try {
    await supersedePendingDrafts({
      workspaceId,
      conversationId,
      dealRecordId,
      userId,
      supersededBy: "manual_send",
    });
  } catch (draftErr) {
    console.error("[inbox] supersede drafts after manual send failed (non-fatal):", draftErr);
  }

  // Übernahme des Deals durch den Menschen (docs/ai-sales-agent-plan.md): der
  // Agent bleibt stumm bis zur Freigabe über /api/v1/agent-state/release.
  if (dealRecordId) {
    try {
      await setHumanOwned(workspaceId, dealRecordId, userId);
    } catch (ownErr) {
      console.error("[inbox] setHumanOwned after manual send failed (non-fatal):", ownErr);
    }
  }
}

/**
 * Vermerk der eigenen Nachricht für Sendewege außerhalb der Antwort-Route
 * (Vorlage, erste Baileys-Nachricht, neue E-Mail): nur wenn das Gespräch an
 * einem Deal hängt. Nie ein Fehler nach außen, das Senden war erfolgreich.
 */
export async function vermerkeEigeneNachricht(input: {
  workspaceId: string;
  conversationId: string | null;
  sentAt: Date;
}): Promise<void> {
  if (!input.conversationId) return;
  try {
    const [conv] = await db
      .select({ dealRecordId: inboxConversations.dealRecordId })
      .from(inboxConversations)
      .where(
        and(
          eq(inboxConversations.id, input.conversationId),
          eq(inboxConversations.workspaceId, input.workspaceId)
        )
      )
      .limit(1);
    if (!conv?.dealRecordId) return;
    await setzeLetzteEigeneNachricht(conv.dealRecordId, input.sentAt);
  } catch (err) {
    console.error("[wartet] vermerkeEigeneNachricht failed (non-fatal):", err);
  }
}

/**
 * 24-Stunden-Fenster des Gesprächs: nur WABA kennt es. Baileys, OpenClaw und
 * E-Mail ergeben null, ebenso ein unbekanntes Gespräch.
 */
export async function istImFenster(conversationId: string): Promise<boolean | null> {
  const [row] = await db
    .select({
      channelType: channelAccounts.channelType,
      waPhoneNumberId: channelAccounts.waPhoneNumberId,
    })
    .from(inboxConversations)
    .innerJoin(channelAccounts, eq(inboxConversations.channelAccountId, channelAccounts.id))
    .where(eq(inboxConversations.id, conversationId))
    .limit(1);
  if (!row || row.channelType !== "whatsapp" || !row.waPhoneNumberId) return null;
  return isWithinCustomerServiceWindow(conversationId);
}
