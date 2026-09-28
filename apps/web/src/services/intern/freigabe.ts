/**
 * Freigabe von KI-Entwürfen per WhatsApp an die internen Nummern.
 *
 * 1. freigabeAnfragen: nach dem Anlegen eines Entwurfs geht er an alle
 *    internen Nummern, über das WhatsApp-Konto der Firma, um die es beim Lead
 *    geht (Fallback: erstes verbundenes Konto), mit Kurzcode.
 * 2. verarbeiteInterneNachricht: "ok" / "ändern: …" / "nein" von einer
 *    internen Nummer; wer zuerst antwortet, entscheidet für beide. Gesendet
 *    wird über entwurfFreigebenUndSenden (Sicherheitsprüfung zum Sendezeitpunkt,
 *    Preisfilter, Schutz gegen doppeltes Senden). Eine menschliche Freigabe hebt
 *    nur "Hauptschalter aus" und "Deal gehört einem Menschen" auf.
 */
import { and, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { agentDrafts, agentEvents } from "@/db/schema/agent";
import { channelAccounts, inboxMessages } from "@/db/schema/inbox";
import { attributes } from "@/db/schema/objects";
import { recordValues } from "@/db/schema/records";
import { entwurfFreigebenUndSenden, type FreigabeErgebnis } from "@/services/agent/draft-senden";
import { DRAFT_CLASS_LABELS } from "@/services/agent/agent-shadow";
import { toGateMessageClass } from "@/services/agent/agent-gate";
import { befehlAus, freigabeCode } from "./freigabe-befehle";
import { sendeAnInterne } from "./intern-senden";
import type { InterneNummer } from "./interne-nummern";

/** Sperrgründe, bei denen trotzdem um Freigabe gefragt wird (ein Mensch entscheidet). */
const FRAGEN_TROTZ: ReadonlySet<string> = new Set(["master_switch_off", "human_owned", "outside_send_window"]);
/** Sperrgründe, die eine Freigabe per WhatsApp aufhebt. */
const UEBERSTIMMBAR: ReadonlySet<string> = new Set(["master_switch_off", "human_owned"]);

const GRUND_TEXT: Record<string, string> = {
  outside_send_window: "außerhalb der Sendezeit (Mo bis Sa 8 bis 20 Uhr, So 10 bis 19 Uhr), bitte später nochmal ok",
  suppressed: "Kunde hat Nachrichten abbestellt (STOP)",
  stage_terminal: "Auftrag ist abgeschlossen oder verloren",
  no_proactive_consent: "keine Einwilligung zum Nachfassen",
  min_gap: "zu kurz nach der letzten Nachricht",
  ai_paused: "KI ist für diesen Chat pausiert",
  lane_not_lead: "Chat ist kein Lead",
};

async function textWert(recordId: string | null, slug: string): Promise<string | null> {
  if (!recordId) return null;
  const [r] = await db
    .select({ text: recordValues.textValue })
    .from(recordValues)
    .innerJoin(attributes, eq(attributes.id, recordValues.attributeId))
    .where(and(eq(recordValues.recordId, recordId), eq(attributes.slug, slug)))
    .limit(1);
  return r?.text ?? null;
}

async function firmaVonKonto(kontoId: string | null): Promise<string | null> {
  if (!kontoId) return null;
  const [k] = await db
    .select({ oc: channelAccounts.operatingCompanyRecordId })
    .from(channelAccounts)
    .where(eq(channelAccounts.id, kontoId))
    .limit(1);
  return textWert(k?.oc ?? null, "name");
}

export async function freigabeAnfragen(input: {
  workspaceId: string;
  draftId: string;
  dealRecordId: string | null;
  conversationId: string | null;
  channelAccountId: string | null;
  messageClass: string;
  text: string;
  gate: { allowed: boolean; reasons: string[] } | null;
}): Promise<void> {
  try {
    const g = input.gate;
    if (!g || !(g.allowed || g.reasons.every((r) => FRAGEN_TROTZ.has(r)))) return;

    const code = freigabeCode(input.draftId);
    const [firma, deal, letzte] = await Promise.all([
      firmaVonKonto(input.channelAccountId),
      textWert(input.dealRecordId, "name"),
      input.conversationId
        ? db
            .select({ body: inboxMessages.body })
            .from(inboxMessages)
            .where(and(eq(inboxMessages.conversationId, input.conversationId), eq(inboxMessages.direction, "inbound")))
            .orderBy(desc(inboxMessages.sentAt))
            .limit(1)
        : Promise.resolve([]),
    ]);
    const klasse = DRAFT_CLASS_LABELS[toGateMessageClass(input.messageClass) as keyof typeof DRAFT_CLASS_LABELS] ?? "Entwurf";
    const kunde = (letzte[0]?.body ?? "").trim();
    const nachricht = [
      `📝 Freigabe #${code} · ${firma ?? "Firma unbekannt"} · ${klasse}`,
      deal ?? "Lead ohne Namen",
      kunde ? `Kunde: „${kunde.length > 300 ? `${kunde.slice(0, 300)}…` : kunde}“` : null,
      "",
      "Entwurf:",
      input.text,
      "",
      `ok ${code} · ändern ${code}: neuer Text · nein ${code}`,
    ]
      .filter((z) => z !== null)
      .join("\n");

    const { zugestellt } = await sendeAnInterne(input.workspaceId, nachricht, { kontoId: input.channelAccountId });
    if (zugestellt.length > 0) {
      await db
        .insert(agentEvents)
        .values({
          workspaceId: input.workspaceId,
          dealRecordId: input.dealRecordId,
          conversationId: input.conversationId,
          engine: "freigabe_whatsapp",
          eventType: "freigabe_angefragt",
          payload: { draftId: input.draftId, code, an: zugestellt },
          idempotencyKey: `freigabe-angefragt:${input.draftId}`,
        })
        .onConflictDoNothing();
    }
  } catch (err) {
    console.error("[freigabe] Anfrage fehlgeschlagen (nicht blockierend):", err);
  }
}

function ergebnisText(code: string, deal: string | null, name: string, r: FreigabeErgebnis): string {
  const wer = deal ? `${deal}` : "Lead";
  if (r.ok) return `✅ #${code} gesendet (${wer}), freigegeben von ${name}.`;
  const grund =
    r.fehler === "gate_blocked"
      ? (r.reasons ?? []).map((x) => GRUND_TEXT[x] ?? x).join(", ")
      : r.fehler === "not_pending"
        ? "schon erledigt (von jemand anderem oder direkt im CRM)"
        : r.fehler === "expired"
          ? "Entwurf ist abgelaufen"
          : r.fehler === "price_leak"
            ? "Text enthält einen Preis oder eine Zusage, bitte im CRM senden"
            : r.fehler === "session_expired"
              ? "WhatsApp-Fenster abgelaufen"
              : r.fehler === "send_uncertain"
                ? "Zustellung unklar, bitte den Chat prüfen und NICHT erneut senden"
                : "Versand fehlgeschlagen, später nochmal ok";
  return `⚠️ #${code} nicht gesendet (${wer}): ${grund}.`;
}

/** Eine Nachricht einer internen Nummer an ein Firmenkonto: Freigabe-Befehl oder nichts. */
export async function verarbeiteInterneNachricht(input: {
  workspaceId: string;
  kontoId: string;
  absender: InterneNummer;
  text: string;
}): Promise<void> {
  const befehl = befehlAus(input.text);
  if (!befehl) return;
  const antworten = (t: string) => sendeAnInterne(input.workspaceId, t, { kontoId: input.kontoId });

  // Offene Entwürfe, zu denen eine Freigabe per WhatsApp angefragt wurde.
  const angefragt = await db
    .select({ payload: agentEvents.payload })
    .from(agentEvents)
    .where(and(eq(agentEvents.workspaceId, input.workspaceId), eq(agentEvents.eventType, "freigabe_angefragt")))
    .orderBy(desc(agentEvents.createdAt))
    .limit(200);
  const ids = [...new Set(angefragt.map((a) => (a.payload as { draftId?: string } | null)?.draftId).filter((x): x is string => !!x))];
  const offen =
    ids.length === 0
      ? []
      : await db
          .select({ id: agentDrafts.id, dealRecordId: agentDrafts.dealRecordId })
          .from(agentDrafts)
          .where(
            and(
              eq(agentDrafts.workspaceId, input.workspaceId),
              inArray(agentDrafts.id, ids),
              eq(agentDrafts.status, "pending"),
              or(isNull(agentDrafts.expiresAt), gt(agentDrafts.expiresAt, new Date()))
            )
          );

  const treffer = offen.filter((d) => freigabeCode(d.id) === befehl.code);
  if (treffer.length === 0) {
    await antworten(`Keine offene Freigabe #${befehl.code} (schon erledigt, abgelaufen oder Tippfehler).`);
    return;
  }
  if (treffer.length > 1) {
    // Zwei offene Entwürfe mit gleichem Kurzcode: lieber nichts senden.
    await antworten(`#${befehl.code} ist nicht eindeutig, bitte diesen Entwurf im CRM freigeben.`);
    return;
  }

  const entwurf = treffer[0]!;
  const code = freigabeCode(entwurf.id);
  const deal = await textWert(entwurf.dealRecordId, "name");

  if (befehl.aktion === "nein") {
    const verworfen = await db
      .update(agentDrafts)
      .set({ status: "dismissed", reviewedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(agentDrafts.id, entwurf.id), eq(agentDrafts.status, "pending")))
      .returning({ id: agentDrafts.id });
    await antworten(
      verworfen.length > 0
        ? `🗑️ #${code} verworfen (${deal ?? "Lead"}) von ${input.absender.name}.`
        : `#${code} war schon erledigt.`
    );
    return;
  }

  const r = await entwurfFreigebenUndSenden({
    workspaceId: input.workspaceId,
    userId: null,
    draftId: entwurf.id,
    finalText: befehl.aktion === "aendern" ? befehl.text : undefined,
    ueberstimmbar: UEBERSTIMMBAR,
    freigegebenVon: `${input.absender.name} per WhatsApp`,
  });
  await antworten(ergebnisText(code, deal, input.absender.name, r));
}
