/**
 * Freigabe von KI-Entwürfen per WhatsApp an die internen Nummern.
 *
 * 1. freigabeAnfragen: nach dem Anlegen eines Entwurfs geht er an alle
 *    internen Nummern, über das WhatsApp-Konto der Firma, um die es beim Lead
 *    geht (Fallback: erstes verbundenes Konto), mit Kurzcode.
 * 2. verarbeiteInterneNachricht: "ok" / "ändern: Anweisung" / "senden: Text" /
 *    "nein" von einer internen Nummer; wer zuerst antwortet, entscheidet für
 *    beide. "ändern" lässt die KI den Entwurf nach der Anweisung überarbeiten;
 *    die neue Fassung kommt mit neuem Code zur Freigabe zurück. Gesendet
 *    wird über entwurfFreigebenUndSenden (Sicherheitsprüfung zum Sendezeitpunkt,
 *    Preisfilter, Schutz gegen doppeltes Senden). Eine menschliche Freigabe hebt
 *    nur "Hauptschalter aus" und "Deal gehört einem Menschen" auf.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { agentDrafts, agentEvents } from "@/db/schema/agent";
import { channelAccounts, inboxMessages } from "@/db/schema/inbox";
import { attributes } from "@/db/schema/objects";
import { recordValues } from "@/db/schema/records";
import { entwurfFreigebenUndSenden, type FreigabeErgebnis } from "@/services/agent/draft-senden";
import { DRAFT_CLASS_LABELS } from "@/services/agent/agent-shadow";
import { leaksPriceOrCommitment } from "@/services/agent/agent-suppress";
import { ohnePreisPhrase } from "@/services/agent/preis-entwurf";
import { runAITask } from "@/services/ai/run-task";
import { AI_TASK_SLUGS } from "@/services/ai/task-registry";
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
  /** Code des Entwurfs, aus dem diese Fassung per "ändern" entstanden ist */
  ueberarbeitetAus?: string | null;
  /** Preis-Satz aus dem Angebotsrechner, falls der Entwurf einen enthält */
  preisPhrase?: string | null;
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
      `📝 Freigabe #${code} · ${firma ?? "Firma unbekannt"} · ${klasse}${input.ueberarbeitetAus ? ` · überarbeitet aus #${input.ueberarbeitetAus}` : ""}`,
      deal ?? "Lead ohne Namen",
      input.preisPhrase ? `💶 Preis aus dem Angebotsrechner: ${input.preisPhrase} (Kalkulation im CRM prüfen)` : null,
      kunde ? `Kunde: „${kunde.length > 300 ? `${kunde.slice(0, 300)}…` : kunde}“` : null,
      "",
      "Entwurf:",
      input.text,
      "",
      `ok ${code} · ändern ${code}: Wunsch · senden ${code}: eigener Text · nein ${code}`,
    ]
      .filter((z) => z !== null)
      .join("\n");

    // Erst vormerken, dann senden: der Entwurf ist per Code auffindbar, auch
    // wenn die Zustellung scheitert (erneutes Anfragen schreibt kein zweites Event).
    await db
      .insert(agentEvents)
      .values({
        workspaceId: input.workspaceId,
        dealRecordId: input.dealRecordId,
        conversationId: input.conversationId,
        engine: "freigabe_whatsapp",
        eventType: "freigabe_angefragt",
        payload: { draftId: input.draftId, code },
        idempotencyKey: `freigabe-angefragt:${input.draftId}`,
      })
      .onConflictDoNothing();
    const { zugestellt } = await sendeAnInterne(input.workspaceId, nachricht, { kontoId: input.channelAccountId });
    if (zugestellt.length === 0) console.error(`[freigabe] #${code} an niemanden zugestellt`);
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
  if (treffer.length === 0 && (await nachfolgerErneutAnfragen(input.workspaceId, ids, befehl.code, antworten))) return;
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

  if (befehl.aktion === "ueberarbeiten") {
    await entwurfUeberarbeiten({ workspaceId: input.workspaceId, draftId: entwurf.id, code, anweisung: befehl.anweisung, absender: input.absender, antworten });
    return;
  }

  const r = await entwurfFreigebenUndSenden({
    workspaceId: input.workspaceId,
    userId: null,
    draftId: entwurf.id,
    finalText: befehl.aktion === "senden" ? befehl.text : undefined,
    ueberstimmbar: UEBERSTIMMBAR,
    freigegebenVon: `${input.absender.name} per WhatsApp`,
  });
  await antworten(ergebnisText(code, deal, input.absender.name, r));
}

const UEBERARBEITEN_SYSTEM = `Du überarbeitest den Antwortentwurf eines deutschen Umzugsunternehmens an einen Kunden nach der Anweisung des Inhabers.
Regeln:
- Setze die Anweisung genau um, ändere sonst so wenig wie möglich.
- Behalte die Anrede (Du oder Sie) und die Signatur bei, außer die Anweisung sagt etwas anderes.
- Erfinde keine Preise, Rabatte, Termine oder Zusagen. Steht im Entwurf ein Preis ("ca. … €"), übernimm diese Preisangabe Zeichen für Zeichen unverändert.
- Schreibe natürlich und knapp, ohne Gedankenstriche.
- Antworte NUR mit dem fertigen Nachrichtentext, ohne Anführungszeichen und ohne Erklärung.`;

/**
 * "ändern CODE: Anweisung": die KI überarbeitet den Entwurf, die neue Fassung
 * kommt mit neuem Code zur Freigabe zurück. Der alte Entwurf wird erst nach der
 * KI-Antwort gesperrt: hat inzwischen jemand anderes entschieden, wird die
 * Überarbeitung verworfen statt doppelt zur Freigabe zu gehen.
 */
async function entwurfUeberarbeiten(input: {
  workspaceId: string;
  draftId: string;
  code: string;
  anweisung: string;
  absender: InterneNummer;
  antworten: (t: string) => Promise<unknown>;
}): Promise<void> {
  const { workspaceId, draftId, code, anweisung, absender, antworten } = input;

  // Dieselbe Anweisung nur einmal umsetzen: fertig ist sie erst, wenn der neue
  // Entwurf existiert. Ein laufender Versuch sperrt 6 Minuten; danach (z. B.
  // KI-Fehler oder abgebrochene Funktion) darf dieselbe Anweisung erneut laufen.
  const schluessel = createHash("sha1").update(`${draftId}:${anweisung}`).digest("hex").slice(0, 16);
  const [frueher] = await db
    .select({ id: agentDrafts.id, status: agentDrafts.status, draftText: agentDrafts.draftText })
    .from(agentDrafts)
    .where(sql`${agentDrafts.idempotencyKey} like ${`ueberarbeitung:${schluessel}%`}`)
    .orderBy(desc(agentDrafts.createdAt))
    .limit(1);
  if (frueher?.status === "pending") {
    // Die neue Fassung gibt es schon (z. B. Zustellung an euch fehlgeschlagen): erneut zur Freigabe schicken.
    const [alt] = await db.select().from(agentDrafts).where(eq(agentDrafts.id, draftId)).limit(1);
    await freigabeAnfragen({
      workspaceId,
      draftId: frueher.id,
      dealRecordId: alt?.dealRecordId ?? null,
      conversationId: alt?.conversationId ?? null,
      channelAccountId: alt?.channelAccountId ?? null,
      messageClass: alt?.messageClass ?? "reply",
      text: frueher.draftText,
      gate: { allowed: true, reasons: [] },
      ueberarbeitetAus: code,
    });
    return;
  }
  if (frueher && frueher.status !== "cancelled") {
    await antworten(`Die Überarbeitung von #${code} ist schon erledigt.`);
    return;
  }
  const ersatzSchluessel = `ueberarbeitung:${schluessel}:${Date.now()}`;
  const [laeuft] = await db
    .select({ id: agentEvents.id })
    .from(agentEvents)
    .where(
      and(
        eq(agentEvents.workspaceId, workspaceId),
        eq(agentEvents.eventType, "ueberarbeitung_angefragt"),
        sql`${agentEvents.payload}->>'schluessel' = ${schluessel}`,
        gt(agentEvents.createdAt, new Date(Date.now() - 6 * 60_000))
      )
    )
    .limit(1);
  if (laeuft) return;
  await db.insert(agentEvents).values({
    workspaceId,
    engine: "freigabe_whatsapp",
    eventType: "ueberarbeitung_angefragt",
    payload: { draftId, code, schluessel, anweisung: anweisung.slice(0, 500), von: absender.name },
    idempotencyKey: `ueberarbeitung-start:${schluessel}:${Date.now()}`,
  });

  const [alt] = await db.select().from(agentDrafts).where(eq(agentDrafts.id, draftId)).limit(1);
  if (!alt || alt.status !== "pending") {
    await antworten(`#${code} war schon erledigt, nichts überarbeitet.`);
    return;
  }
  await antworten(`✏️ #${code} wird überarbeitet (${absender.name}), die neue Fassung kommt in 1 bis 2 Minuten.`);

  const verlauf = alt.conversationId
    ? (
        await db
          .select({ direction: inboxMessages.direction, body: inboxMessages.body })
          .from(inboxMessages)
          .where(eq(inboxMessages.conversationId, alt.conversationId))
          .orderBy(desc(inboxMessages.sentAt))
          .limit(8)
      )
        .reverse()
        .map((m) => `${m.direction === "inbound" ? "Kunde" : "Wir"}: ${(m.body ?? "").trim()}`)
        .join("\n")
    : "";
  const bisher = alt.finalText?.trim() || alt.draftText;

  const r = await runAITask({
    workspaceId,
    taskSlug: AI_TASK_SLUGS.DEAL_REVISE_DRAFT,
    system: UEBERARBEITEN_SYSTEM,
    prompt: `${verlauf ? `Letzte Nachrichten:\n${verlauf}\n\n` : ""}Bisheriger Entwurf:\n${bisher}\n\nAnweisung des Inhabers:\n${anweisung}\n\nÜberarbeiteter Entwurf:`,
  });
  const text = r.ok ? String(r.output ?? "").trim().replace(/^["„“]|["“”]$/g, "").trim() : "";
  if (!text) {
    await antworten(`⚠️ #${code} konnte nicht überarbeitet werden (KI-Fehler). Der alte Entwurf bleibt offen, oder mit "senden ${code}: Text" selbst formulieren.`);
    return;
  }
  const preisPhrase = (alt.filterVerdicts as { preisPhrase?: string } | null)?.preisPhrase ?? null;
  if (leaksPriceOrCommitment(ohnePreisPhrase(text, preisPhrase))) {
    await antworten(`⚠️ #${code}: Die überarbeitete Fassung enthält einen anderen Preis als den aus dem Rechner oder eine Zusage und darf nicht über die Freigabe raus. Bitte selbst im Chat schreiben. Der alte Entwurf bleibt offen.`);
    return;
  }

  // Erst den neuen Entwurf anlegen, dann den alten sperren: bricht der Lauf
  // dazwischen ab, bleibt der alte Entwurf freigebbar.
  const [ersatz] = await db
    .insert(agentDrafts)
    .values({
      workspaceId,
      dealRecordId: alt.dealRecordId,
      conversationId: alt.conversationId,
      channelAccountId: alt.channelAccountId,
      messageClass: alt.messageClass,
      draftText: text,
      finalText: null,
      filterVerdicts: {
        priceOrCommitmentLeak: false,
        ueberarbeitetAus: draftId,
        anweisung: anweisung.slice(0, 500),
        ...(preisPhrase && text.includes(preisPhrase) ? { preisPhrase } : {}),
      },
      gateResults: alt.gateResults,
      status: "pending",
      idempotencyKey: ersatzSchluessel,
      expiresAt: new Date(Date.now() + 72 * 3600_000),
      promptVersion: "whatsapp-ueberarbeitung",
      modelTag: alt.modelTag,
    })
    .onConflictDoNothing()
    .returning({ id: agentDrafts.id });
  if (!ersatz) return;

  const gesperrt = await db
    .update(agentDrafts)
    .set({ status: "edited", finalText: text, reviewedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(agentDrafts.id, draftId), eq(agentDrafts.status, "pending")))
    .returning({ id: agentDrafts.id });
  if (gesperrt.length === 0) {
    await db.update(agentDrafts).set({ status: "cancelled", updatedAt: new Date() }).where(eq(agentDrafts.id, ersatz.id));
    await antworten(`#${code} wurde inzwischen anders erledigt, die Überarbeitung wird verworfen.`);
    return;
  }

  await freigabeAnfragen({
    workspaceId,
    draftId: ersatz.id,
    dealRecordId: alt.dealRecordId,
    conversationId: alt.conversationId,
    channelAccountId: alt.channelAccountId,
    messageClass: alt.messageClass,
    text,
    // Ein Mensch hat die Überarbeitung angestoßen: immer zur Freigabe schicken;
    // die Sicherheitsprüfung läuft beim Senden trotzdem erneut.
    gate: { allowed: true, reasons: [] },
    ueberarbeitetAus: code,
    preisPhrase: preisPhrase && text.includes(preisPhrase) ? preisPhrase : null,
  });
}

/**
 * Ein Code gehört zu einem schon überarbeiteten Entwurf: die neue Fassung
 * erneut zur Freigabe schicken (z. B. wenn deren Nachricht nie ankam).
 * Liefert true, wenn so ein Nachfolger gefunden wurde.
 */
async function nachfolgerErneutAnfragen(
  workspaceId: string,
  angefragteIds: readonly string[],
  code: string,
  antworten: (t: string) => Promise<unknown>
): Promise<boolean> {
  if (angefragteIds.length === 0) return false;
  const bearbeitet = (
    await db
      .select({ id: agentDrafts.id })
      .from(agentDrafts)
      .where(and(eq(agentDrafts.workspaceId, workspaceId), inArray(agentDrafts.id, [...angefragteIds]), eq(agentDrafts.status, "edited")))
  ).filter((d) => freigabeCode(d.id) === code);
  if (bearbeitet.length !== 1) return false;
  const [nachfolger] = await db
    .select()
    .from(agentDrafts)
    .where(
      and(
        eq(agentDrafts.workspaceId, workspaceId),
        eq(agentDrafts.status, "pending"),
        sql`${agentDrafts.filterVerdicts}->>'ueberarbeitetAus' = ${bearbeitet[0]!.id}`
      )
    )
    .orderBy(desc(agentDrafts.createdAt))
    .limit(1);
  if (!nachfolger) return false;
  await antworten(`#${code} wurde schon überarbeitet, die neue Fassung ist #${freigabeCode(nachfolger.id)} und kommt gleich noch einmal.`);
  await freigabeAnfragen({
    workspaceId,
    draftId: nachfolger.id,
    dealRecordId: nachfolger.dealRecordId,
    conversationId: nachfolger.conversationId,
    channelAccountId: nachfolger.channelAccountId,
    messageClass: nachfolger.messageClass,
    text: nachfolger.draftText,
    gate: { allowed: true, reasons: [] },
    ueberarbeitetAus: code,
    preisPhrase: (nachfolger.filterVerdicts as { preisPhrase?: string } | null)?.preisPhrase ?? null,
  });
  return true;
}
