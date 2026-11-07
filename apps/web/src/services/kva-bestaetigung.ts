/**
 * Nach der KV-Annahme: Vertragsbestätigung an den Kunden (§ 312f Abs. 2 BGB,
 * dauerhafter Datenträger: Text mit allen Eckdaten plus das angenommene PDF)
 * und Alarm ans Team. Läuft über after() nach der Antwort; wirft nie.
 */
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { kvaConfirmations, customerStatusLinks } from "@/db/schema/customer-portal";
import { channelAccounts, inboxContacts, inboxConversations } from "@/db/schema/inbox";
import { attributes, objects } from "@/db/schema/objects";
import { recordValues } from "@/db/schema/records";
import { dealDocuments, dealNumbers } from "@/db/schema/financial";
import {
  firmaKontakt,
  haftungshinweis,
  keinWiderrufHinweis,
  kundenAnrede,
  kundenText,
  musterWiderrufsformular,
  vorzeitigerBeginnCheckbox,
  widerrufsbelehrung,
  gewaehltText,
  stundenAngebotAus,
  stundensatzAltCents,
  stundensatzText,
  stundenVersionText,
  tagLang,
  type FirmaKontakt,
  type KvaAnnahmeSnapshot,
  type KundenAnrede,
  type PortalStundenAngebot,
  type WiderrufModus,
} from "@openclaw-crm/customer-portal-core";
import { emitEvent } from "./activity-events";
import { createTask } from "./tasks";
import { workspaceMembers } from "@/db/schema/workspace";
import { sendNewEmail } from "./inbox-email";
import {
  isWithinCustomerServiceWindow,
  sendBaileysMediaReply,
  sendBaileysReply,
  sendWhatsAppMediaReply,
  sendWhatsAppReply,
} from "./inbox-whatsapp";
import { resolveCustomerEmailTransport } from "./customer-portal-emails";
import { loadContextByToken, resolveCustomerLinkOrigin } from "./customer-portal-data";
import { sendeAnInterne } from "./intern/intern-senden";
import { kottkeRestbetragSatz } from "@openclaw-crm/document-templates/src/restbetrag";

export interface BestaetigungsDaten {
  firma: string;
  kontakt: FirmaKontakt;
  dealNumber: string;
  kunde: string | null;
  preisCents: number;
  optionName: string | null;
  moveDate: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  widerrufModus: WiderrufModus;
  vorzeitigerBeginn: boolean;
  haftung: boolean;
  versicherungGewuenscht: boolean;
  portalUrl: string;
  signedAt: string;
  pdfDabei: boolean;
  /** Angebot nach Aufwand: Betrag ist eine Schätzung, kein Festpreis. */
  voraussichtlich?: boolean;
  /** AGB-Fassung der Annahme liegt der Mail bei. */
  agbDabei?: boolean;
  /** Plan 5b: Wahl mit Paket- oder Tagespreisen aus der Version; fehlt im Altbestand. */
  wahl?: AnnahmeWahlText | null;
  /** Plan 5b: Stunden-KV aus der Version oder von Hand (F11); fehlt beim Festpreis. */
  stunden?: AnnahmeStunden | null;
}

export interface AnnahmeWahlText {
  paketName: string | null;
  /** YYYY-MM-DD. */
  datum: string | null;
}

export type AnnahmeStunden =
  | { modell: "version"; angebot: PortalStundenAngebot }
  | { modell: "alt"; satzCents: number };

/**
 * Wahl und Stunden-KV aus dem Annahme-Schnappschuss, für Bestätigung und
 * Vertragsmappe. Ohne Plan-5-Wahl `wahl: null`. Beim Stunden-KV ohne
 * Angebot aus der Version gilt „alt“ (F11), auch für Schnappschüsse von vor 5b.
 */
export function annahmeWahlUndStunden(snapshot: unknown): { wahl: AnnahmeWahlText | null; stunden: AnnahmeStunden | null } {
  const s = (snapshot && typeof snapshot === "object" ? snapshot : {}) as Partial<KvaAnnahmeSnapshot>;
  const wahl = s.wahl && (s.wahl.paketName || s.wahl.datum) ? { paketName: s.wahl.paketName ?? null, datum: s.wahl.datum ?? null } : null;
  if (s.isVariable !== true) return { wahl, stunden: null };
  const angebot = s.stundenModell === "version" ? stundenAngebotAus(s.stunden) : null;
  const stunden: AnnahmeStunden = angebot
    ? { modell: "version", angebot }
    : { modell: "alt", satzCents: stundensatzAltCents(Array.isArray(s.lineItems) ? s.lineItems : [], s.totalCents ?? 0) };
  return { wahl, stunden };
}

const euro = (c: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(c / 100);
const datum = (ymd: string) =>
  new Date(`${ymd}T12:00:00`).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });

function firmaFuerAnrede(d: BestaetigungsDaten): string {
  return `${d.kontakt.firma} ${d.firma}`;
}

function anredeVon(d: BestaetigungsDaten): KundenAnrede {
  return kundenAnrede(firmaFuerAnrede(d));
}

function text(d: BestaetigungsDaten, sie: string, du: string): string {
  return kundenText(firmaFuerAnrede(d), sie, du);
}

function restbetragHinweis(d: BestaetigungsDaten): string | null {
  const name = `${d.kontakt.firma} ${d.kontakt.email ?? ""}`;
  if (!/kottke/i.test(name)) return null;
  return kottkeRestbetragSatz(d.widerrufModus === "ausgeschlossen");
}

/** Preiszeile: Stunden-KV nach F10 und F11, sonst wie vor 5b. */
function preisZeile(d: BestaetigungsDaten): string {
  if (d.stunden?.modell === "version") return `Preis: ${stundenVersionText(d.stunden.angebot, euro)}`;
  if (d.stunden?.modell === "alt") return `Preis: ${stundensatzText(d.stunden.satzCents, euro)} (Abrechnung nach tatsächlichem Aufwand)`;
  return d.voraussichtlich
    ? `Preis: ${euro(d.preisCents)} (voraussichtlich, Abrechnung nach tatsächlichem Aufwand)`
    : `Preis: ${euro(d.preisCents)} (Endpreis)`;
}

function eckdaten(d: BestaetigungsDaten): string[] {
  // Plan 5b: „Gewählt: Komfort am Samstag, 28. November 2026: 1.640,00 € (Endpreis)“ statt Leistung und Preis.
  const gewaehlt = d.wahl && !d.stunden
    ? gewaehltText({ paket: d.wahl.paketName, tag: d.wahl.datum ? tagLang(d.wahl.datum) : null, betrag: `${euro(d.preisCents)} (Endpreis)` })
    : null;
  const terminSchonGenannt = !!gewaehlt && !!d.wahl?.datum && d.wahl.datum === d.moveDate;
  return [
    `Auftrag ${d.dealNumber}`,
    gewaehlt ?? (d.optionName ? `Leistung: ${d.optionName}` : null),
    gewaehlt ? null : preisZeile(d),
    d.moveDate && !terminSchonGenannt ? `Termin: ${datum(d.moveDate)}` : null,
    d.fromAddress ? `Von: ${d.fromAddress}` : null,
    d.toAddress ? `Nach: ${d.toAddress}` : null,
  ].filter((z): z is string => !!z);
}

/**
 * Widerrufsteil der WhatsApp-Bestätigung. Bei Belehrung steht der volle
 * Text samt Formular in der Nachricht selbst: Viele Kunden haben nur
 * WhatsApp, und die Nachricht ist der dauerhafte Datenträger (§ 312f BGB).
 */
function widerrufTeil(d: BestaetigungsDaten): string[] {
  const anrede = anredeVon(d);
  if (d.widerrufModus === "ausgeschlossen") return [keinWiderrufHinweis(anrede)];
  // Gesetzliches Muster bleibt Sie, auch bei Kottke.
  const b = widerrufsbelehrung(d.kontakt, { portalUrl: d.portalUrl });
  const zeilen = [[b.titel, ...b.absaetze].join("\n"), musterWiderrufsformular(d.kontakt).join("\n")];
  if (d.vorzeitigerBeginn) {
    zeilen.push(`${text(d, "Ihre Erklärung bei der Annahme", "Deine Erklärung bei der Annahme")}: ${vorzeitigerBeginnCheckbox(anrede)}`);
  }
  return zeilen;
}

export function bestaetigungsTextWhatsApp(d: BestaetigungsDaten): string {
  const vorname = d.kunde?.trim().split(/\s+/)[0];
  const h = haftungshinweis(anredeVon(d));
  return [
    vorname ? `Hallo ${vorname},` : "Hallo,",
    text(
      d,
      `vielen Dank, Ihr Auftrag ist verbindlich erteilt. Hier die Bestätigung von ${d.firma}:`,
      `vielen Dank, dein Auftrag ist verbindlich erteilt. Hier die Bestätigung von ${d.firma}:`,
    ),
    eckdaten(d).join("\n"),
    restbetragHinweis(d),
    ...widerrufTeil(d),
    d.haftung ? `${h.titel}: ${h.absaetze.join(" ")}` : null,
    d.pdfDabei
      ? text(d, "Das angenommene Angebot mit unseren AGB schicken wir Ihnen als PDF mit.", "Das angenommene Angebot mit unseren AGB schicken wir dir als PDF mit.")
      : text(d, `Das angenommene Angebot mit unseren AGB finden Sie hier: ${d.portalUrl}`, `Das angenommene Angebot mit unseren AGB findest du hier: ${d.portalUrl}`),
    `Viele Grüße\n${d.firma}`,
  ].filter(Boolean).join("\n\n");
}

export function bestaetigungsMailText(d: BestaetigungsDaten): string {
  const wann = new Date(d.signedAt).toLocaleString("de-DE", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Berlin" });
  const h = haftungshinweis(anredeVon(d));
  const teile = [
    d.kunde ? `Guten Tag ${d.kunde},` : "Guten Tag,",
    text(
      d,
      `vielen Dank für Ihren Auftrag. Hiermit bestätigen wir den Vertrag, den Sie am ${wann} Uhr im Kundenportal geschlossen haben.`,
      `vielen Dank für deinen Auftrag. Hiermit bestätigen wir den Vertrag, den du am ${wann} Uhr im Kundenportal geschlossen hast.`,
    ),
    eckdaten(d).join("\n"),
    restbetragHinweis(d),
    anhangSatz(d),
  ];
  if (d.haftung) teile.push([h.titel, ...h.absaetze].join("\n"));
  if (d.versicherungGewuenscht) {
    teile.push(text(
      d,
      "Sie haben ein Angebot für eine weitergehende Haftung oder Versicherung gewünscht. Wir melden uns dazu vor dem Umzug.",
      "Du hast ein Angebot für eine weitergehende Haftung oder Versicherung gewünscht. Wir melden uns dazu vor dem Umzug.",
    ));
  }
  if (d.widerrufModus === "ausgeschlossen") teile.push(keinWiderrufHinweis(anredeVon(d)));
  else {
    const b = widerrufsbelehrung(d.kontakt, { portalUrl: d.portalUrl });
    teile.push([b.titel, ...b.absaetze].join("\n"));
    teile.push(musterWiderrufsformular(d.kontakt).join("\n"));
    if (d.vorzeitigerBeginn) {
      teile.push(`${text(d, "Ihre Erklärung bei der Annahme", "Deine Erklärung bei der Annahme")}: ${vorzeitigerBeginnCheckbox(anredeVon(d))}`);
    }
  }
  teile.push(text(d, `Ihr Kundenportal: ${d.portalUrl}`, `Dein Kundenportal: ${d.portalUrl}`), `Freundliche Grüße\n${d.firma}`);
  return teile.join("\n\n");
}

function anhangSatz(d: BestaetigungsDaten): string {
  if (d.pdfDabei && d.agbDabei) {
    return text(
      d,
      "Im Anhang finden Sie das angenommene Angebot als PDF und unsere AGB in der Fassung, die Sie bei der Annahme akzeptiert haben.",
      "Im Anhang findest du das angenommene Angebot als PDF und unsere AGB in der Fassung, die du bei der Annahme akzeptiert hast.",
    );
  }
  if (d.pdfDabei) {
    return text(
      d,
      `Im Anhang finden Sie das angenommene Angebot als PDF. Unsere AGB finden Sie in Ihrem Kundenportal: ${d.portalUrl}`,
      `Im Anhang findest du das angenommene Angebot als PDF. Unsere AGB findest du in deinem Kundenportal: ${d.portalUrl}`,
    );
  }
  if (d.agbDabei) {
    return text(
      d,
      `Im Anhang finden Sie unsere AGB in der Fassung, die Sie bei der Annahme akzeptiert haben. Das angenommene Angebot finden Sie in Ihrem Kundenportal: ${d.portalUrl}`,
      `Im Anhang findest du unsere AGB in der Fassung, die du bei der Annahme akzeptiert hast. Das angenommene Angebot findest du in deinem Kundenportal: ${d.portalUrl}`,
    );
  }
  return text(
    d,
    `Das angenommene Angebot und unsere AGB finden Sie in Ihrem Kundenportal: ${d.portalUrl}`,
    `Das angenommene Angebot und unsere AGB findest du in deinem Kundenportal: ${d.portalUrl}`,
  );
}

/** Versand gilt erst als erledigt, wenn er abgeschlossen ist (nicht nur beansprucht). */
export function bestaetigungVerschickt(row: { confirmationSentAt: Date | null; confirmationChannels: string | null }): boolean {
  return !!row.confirmationSentAt && row.confirmationChannels !== "sending";
}

/**
 * Nachholen nur für Annahmen mit neuem Nachweis. Altbestand (vor 2026-10,
 * ohne Widerrufsmodus) wurde vom alten Weg bestätigt und kennt Termin,
 * Adressen und Auftragsart nicht.
 */
export function nachlaufNoetig(row: {
  widerrufModus: string | null;
  confirmationSentAt: Date | null;
  confirmationChannels: string | null;
}): boolean {
  return row.widerrufModus != null && !bestaetigungVerschickt(row);
}

/** AGB-Seite (HTML) als schlichter Text für den Mail-Anhang. */
export function agbAlsText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|h[1-6]|li|div|tr)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function teamAlarmText(d: BestaetigungsDaten): string {
  return [
    `Angebot angenommen: Auftrag ${d.dealNumber}${d.kunde ? `, ${d.kunde}` : ""}, ${euro(d.preisCents)}${d.optionName ? `, ${d.optionName}` : ""}${d.moveDate ? `, Termin ${datum(d.moveDate)}` : ""}.`,
    d.versicherungGewuenscht ? "Kunde wünscht ein Angebot für Versicherung oder Höherhaftung." : null,
    "Nächster Schritt: Auftragsbestätigung erstellen und Anzahlung prüfen.",
  ].filter(Boolean).join("\n");
}

// ─── Versand ──────────────────────────────────────────────────────────────────

export interface WaThread {
  conversationId: string;
  cloudApi: boolean;
}

/**
 * Chat der Kundenperson des Deals vor allen anderen (Vermieter, Angehörige),
 * sonst der neueste. Erwartet die Threads nach Aktualität sortiert.
 */
export function waThreadWaehlen(
  threads: Array<WaThread & { kontaktPersonId: string | null }>,
  kundePersonId: string | null
): WaThread | null {
  const wahl = (kundePersonId && threads.find((t) => t.kontaktPersonId === kundePersonId)) || threads[0];
  return wahl ? { conversationId: wahl.conversationId, cloudApi: wahl.cloudApi } : null;
}

/** Erste verknüpfte Person des Deals (associated_people), wie beim E-Mail-Versand. */
async function ladeKundenPersonId(workspaceId: string, dealRecordId: string): Promise<string | null> {
  const [attr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .innerJoin(objects, eq(attributes.objectId, objects.id))
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals"), eq(attributes.slug, "associated_people")))
    .limit(1);
  if (!attr) return null;
  const [link] = await db
    .select({ personId: recordValues.referencedRecordId })
    .from(recordValues)
    .where(and(eq(recordValues.recordId, dealRecordId), eq(recordValues.attributeId, attr.id)))
    .orderBy(recordValues.sortOrder)
    .limit(1);
  return link?.personId ?? null;
}

type WaKandidat = WaThread & { kontaktPersonId: string | null };

/** Nur der Chat der Kundenperson selbst, kein Rückfall auf Dritte. */
export function kundenThread(threads: WaKandidat[], kundePersonId: string | null): WaThread | null {
  const t = kundePersonId ? threads.find((x) => x.kontaktPersonId === kundePersonId) : undefined;
  return t ? { conversationId: t.conversationId, cloudApi: t.cloudApi } : null;
}

/** Sendbare WhatsApp-Threads des Deals (Cloud-API oder hauseigenes Baileys), neueste zuerst. */
async function ladeWaKandidaten(workspaceId: string, dealRecordId: string): Promise<WaKandidat[]> {
  const rows = await db
    .select({
      conversationId: inboxConversations.id,
      waPhoneNumberId: channelAccounts.waPhoneNumberId,
      baileysBridgeProvider: channelAccounts.baileysBridgeProvider,
      kontaktPersonId: inboxContacts.crmRecordId,
    })
    .from(inboxConversations)
    .innerJoin(channelAccounts, eq(inboxConversations.channelAccountId, channelAccounts.id))
    .leftJoin(inboxContacts, eq(inboxConversations.contactId, inboxContacts.id))
    .where(
      and(
        eq(inboxConversations.workspaceId, workspaceId),
        eq(inboxConversations.dealRecordId, dealRecordId),
        eq(channelAccounts.channelType, "whatsapp")
      )
    )
    .orderBy(sql`COALESCE(${inboxConversations.lastMessageAt}, ${inboxConversations.createdAt}) DESC`)
    .limit(20);
  return rows.flatMap((r): WaKandidat[] =>
    r.waPhoneNumberId
      ? [{ conversationId: r.conversationId, cloudApi: true, kontaktPersonId: r.kontaktPersonId }]
      : r.baileysBridgeProvider === "inhouse"
        ? [{ conversationId: r.conversationId, cloudApi: false, kontaktPersonId: r.kontaktPersonId }]
        : []
  );
}

/** WhatsApp-Thread für die Annahme-Bestätigung: Kunden-Chat, sonst der neueste. */
export async function ladeWaThread(workspaceId: string, dealRecordId: string): Promise<WaThread | null> {
  const sendbar = await ladeWaKandidaten(workspaceId, dealRecordId);
  if (sendbar.length === 0) return null;
  const kundePersonId = sendbar.length > 1 ? await ladeKundenPersonId(workspaceId, dealRecordId) : null;
  return waThreadWaehlen(sendbar, kundePersonId);
}

/**
 * Für Nachrichten, die nicht bei Dritten landen dürfen (Widerruf): nur der
 * Chat der Kundenperson, bei der Cloud-API nur im 24-Stunden-Fenster, weil
 * freier Text sonst abgelehnt wird.
 */
export async function ladeKundenWaThread(workspaceId: string, dealRecordId: string): Promise<WaThread | null> {
  const sendbar = await ladeWaKandidaten(workspaceId, dealRecordId);
  if (sendbar.length === 0) return null;
  const thread = kundenThread(sendbar, await ladeKundenPersonId(workspaceId, dealRecordId));
  if (!thread) return null;
  if (thread.cloudApi && !(await isWithinCustomerServiceWindow(thread.conversationId))) return null;
  return thread;
}

/** Reiner Text in den gewählten Thread. Wirft bei Fehlern. */
export async function sendeWhatsAppText(workspaceId: string, thread: WaThread, body: string): Promise<void> {
  if (thread.cloudApi) {
    await sendWhatsAppReply({ conversationId: thread.conversationId, workspaceId, body });
  } else {
    await sendBaileysReply({ conversationId: thread.conversationId, workspaceId, body });
  }
}

/** PDF mit Bildunterschrift in den gewählten Thread. Wirft bei Fehlern. */
export async function sendeWhatsAppDokument(
  workspaceId: string,
  thread: WaThread,
  pdf: { buf: Buffer; filename: string },
  caption: string
): Promise<void> {
  const file = {
    blob: new Blob([new Uint8Array(pdf.buf)], { type: "application/pdf" }),
    mimeType: "application/pdf",
    filename: pdf.filename,
    size: pdf.buf.length,
  };
  if (thread.cloudApi) {
    await sendWhatsAppMediaReply({ conversationId: thread.conversationId, workspaceId, file, caption });
  } else {
    await sendBaileysMediaReply({ conversationId: thread.conversationId, workspaceId, file, caption });
  }
}

async function sendeWhatsApp(
  workspaceId: string,
  thread: WaThread,
  daten: BestaetigungsDaten,
  pdf: { buf: Buffer; filename: string } | null
): Promise<{ ok: boolean; pdf: boolean }> {
  let pdfGesendet = false;
  if (pdf) {
    try {
      await sendeWhatsAppDokument(workspaceId, thread, pdf, text(daten, `Ihr angenommenes Angebot ${daten.dealNumber}`, `Dein angenommenes Angebot ${daten.dealNumber}`));
      pdfGesendet = true;
    } catch (err) {
      console.error("[kva-bestaetigung] PDF per WhatsApp fehlgeschlagen:", err);
    }
  }
  try {
    await sendeWhatsAppText(workspaceId, thread, bestaetigungsTextWhatsApp({ ...daten, pdfDabei: pdfGesendet }));
    return { ok: true, pdf: pdfGesendet };
  } catch (err) {
    console.error("[kva-bestaetigung] WhatsApp-Text fehlgeschlagen:", err);
    return { ok: false, pdf: pdfGesendet };
  }
}

/** Aufgabe für den ersten Admin des Workspace, am Deal verknüpft. */
export async function adminAufgabe(workspaceId: string, dealRecordId: string, titel: string, beschreibung: string) {
  const [admin] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, "admin")))
    .orderBy(workspaceMembers.createdAt)
    .limit(1);
  if (!admin) return;
  await createTask(titel, admin.userId, workspaceId, {
    recordIds: [dealRecordId],
    description: beschreibung,
    kind: "operativ",
  });
}

/**
 * Versand beanspruchen: nur eine Ausführung sendet. Eine hängengebliebene
 * Beanspruchung (Abbruch mitten im Versand) wird nach 10 Minuten frei.
 * Altbestand ohne Widerrufsmodus und aufgehobene Annahmen sendet nichts.
 */
async function versandBeanspruchen(id: string): Promise<KvaRow | null> {
  const [row] = await db
    .update(kvaConfirmations)
    .set({ confirmationChannels: "sending", confirmationSentAt: new Date() })
    .where(
      and(
        eq(kvaConfirmations.id, id),
        isNull(kvaConfirmations.supersededAt),
        isNotNull(kvaConfirmations.widerrufModus),
        or(
          isNull(kvaConfirmations.confirmationSentAt),
          and(
            eq(kvaConfirmations.confirmationChannels, "sending"),
            lt(kvaConfirmations.confirmationSentAt, sql`now() - interval '10 minutes'`)
          )
        )
      )
    )
    .returning();
  return row ?? null;
}

type KvaRow = typeof kvaConfirmations.$inferSelect;

async function ladeDealNummer(dealRecordId: string): Promise<string | null> {
  const [row] = await db
    .select({ dealNumber: dealNumbers.dealNumber })
    .from(dealNumbers)
    .where(eq(dealNumbers.dealRecordId, dealRecordId))
    .limit(1);
  return row?.dealNumber ?? null;
}

/** Bestätigung an den Kunden senden. Liefert die erfolgreichen Kanäle. */
async function kundeBestaetigen(row: KvaRow): Promise<{ kanaele: string[]; pdf: boolean; daten: BestaetigungsDaten | null }> {
  const [link] = await db
    .select({ token: customerStatusLinks.token })
    .from(customerStatusLinks)
    .where(eq(customerStatusLinks.id, row.customerLinkId))
    .limit(1);
  if (!link) return { kanaele: [], pdf: false, daten: null };
  const ctx = await loadContextByToken(link.token);
  if (!ctx) return { kanaele: [], pdf: false, daten: null };

  const origin = await resolveCustomerLinkOrigin(
    row.dealRecordId,
    row.workspaceId,
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") || null
  );
  const snapshot = row.quotationSnapshot as { isVariable?: boolean } | null;
  const { wahl, stunden } = annahmeWahlUndStunden(row.quotationSnapshot);
  const daten: BestaetigungsDaten = {
    firma: ctx.branding.displayName,
    kontakt: firmaKontakt(ctx.branding.firmaSlug),
    dealNumber: ctx.dealNumber,
    kunde: row.acceptedFullName || ctx.customerDisplayName,
    preisCents: row.confirmedTotalCents,
    optionName: row.selectedOptionName,
    moveDate: row.moveDate,
    fromAddress: row.fromAddress,
    toAddress: row.toAddress,
    widerrufModus: row.widerrufModus === "belehrung" ? "belehrung" : "ausgeschlossen",
    vorzeitigerBeginn: row.vorzeitigerBeginnVerlangt,
    haftung: row.haftungshinweisBestaetigt || row.serviceType === "move",
    versicherungGewuenscht: row.versicherungGewuenscht,
    portalUrl: `${origin}/s/${link.token}`,
    signedAt: row.signedAt.toISOString(),
    pdfDabei: false,
    voraussichtlich: snapshot?.isVariable === true,
    wahl,
    stunden,
  };

  let pdf: { buf: Buffer; filename: string } | null = null;
  if (row.quotationDocumentId) {
    const [doc] = await db
      .select({ fileContent: dealDocuments.fileContent, fileName: dealDocuments.fileName })
      .from(dealDocuments)
      .where(eq(dealDocuments.id, row.quotationDocumentId))
      .limit(1);
    if (doc) {
      pdf = {
        buf: Buffer.from(doc.fileContent, "base64"),
        filename: doc.fileName.replace(/[\\/\r\n]/g, "_").slice(0, 180) || `Angebot-${ctx.dealNumber}.pdf`,
      };
    }
  }

  const kanaele: string[] = [];
  let pdfZugestellt = false;

  try {
    const thread = await ladeWaThread(row.workspaceId, row.dealRecordId);
    if (thread) {
      const wa = await sendeWhatsApp(row.workspaceId, thread, daten, pdf);
      if (wa.ok) kanaele.push("whatsapp");
      pdfZugestellt ||= wa.pdf;
    }
  } catch (err) {
    console.error("[kva-bestaetigung] WhatsApp fehlgeschlagen:", err);
  }

  try {
    const transport = await resolveCustomerEmailTransport(row.workspaceId, row.dealRecordId, true);
    if (transport.ok) {
      const attachments: Array<{ filename: string; contentType: string; content: Buffer }> = [];
      if (pdf && pdf.buf.length <= 8 * 1024 * 1024) {
        attachments.push({ filename: pdf.filename, contentType: "application/pdf", content: pdf.buf });
      }
      if (row.agbText) {
        attachments.push({
          filename: `AGB-${ctx.branding.firmaSlug}.txt`,
          contentType: "text/plain; charset=utf-8",
          content: Buffer.from(agbAlsText(row.agbText), "utf-8"),
        });
      }
      const pdfDabei = attachments.some((a) => a.contentType === "application/pdf");
      await sendNewEmail({
        workspaceId: row.workspaceId,
        channelAccountId: transport.account.id,
        dealRecordId: row.dealRecordId,
        to: transport.customerEmail,
        subject: text(
          daten,
          `Bestätigung Ihres Auftrags ${ctx.dealNumber} bei ${ctx.branding.displayName}`,
          `Bestätigung deines Auftrags ${ctx.dealNumber} bei ${ctx.branding.displayName}`,
        ),
        body: bestaetigungsMailText({ ...daten, pdfDabei, agbDabei: !!row.agbText }),
        attachments,
      });
      kanaele.push("email");
      pdfZugestellt ||= pdfDabei;
    }
  } catch (err) {
    console.error("[kva-bestaetigung] E-Mail fehlgeschlagen:", err);
  }

  return { kanaele, pdf: pdfZugestellt, daten };
}

/**
 * Nach der Annahme: Bestätigung an den Kunden (WhatsApp und/oder E-Mail,
 * jeweils mit dem angenommenen PDF) und optional Alarm ans Team. Jeder
 * Schritt hat seinen eigenen Fehlerfang; der Team-Alarm geht auch dann
 * raus, wenn der Kundenversand scheitert. Wirft nie.
 */
export async function annahmeNachlauf(
  confirmationId: string,
  opts: { mitTeamAlarm: boolean }
): Promise<void> {
  let row: KvaRow | null = null;
  try {
    row = await versandBeanspruchen(confirmationId);
  } catch (err) {
    console.error("[kva-bestaetigung] Beanspruchen fehlgeschlagen:", err);
  }

  let ergebnis: { kanaele: string[]; pdf: boolean; daten: BestaetigungsDaten | null } = { kanaele: [], pdf: false, daten: null };
  if (row) {
    try {
      ergebnis = await kundeBestaetigen(row);
    } catch (err) {
      console.error("[kva-bestaetigung] Kundenbestätigung fehlgeschlagen:", err);
    }
    try {
      await db
        .update(kvaConfirmations)
        .set(
          ergebnis.kanaele.length > 0
            ? { confirmationSentAt: new Date(), confirmationChannels: ergebnis.kanaele.join(",") }
            : { confirmationSentAt: null, confirmationChannels: null }
        )
        .where(eq(kvaConfirmations.id, row.id));
    } catch (err) {
      console.error("[kva-bestaetigung] Versandstatus nicht gespeichert:", err);
    }
    try {
      await emitEvent({
        workspaceId: row.workspaceId,
        recordId: row.dealRecordId,
        objectSlug: "deals",
        eventType: "customer.kva_confirmation_sent",
        payload: { confirmationId: row.id, channels: ergebnis.kanaele, pdf: ergebnis.pdf },
      });
    } catch (err) {
      console.error("[kva-bestaetigung] Event fehlgeschlagen:", err);
    }
  }

  if (!opts.mitTeamAlarm) return;
  try {
    const [basis] = row
      ? [row]
      : await db.select().from(kvaConfirmations).where(eq(kvaConfirmations.id, confirmationId)).limit(1);
    if (!basis) return;
    const dealNumber = ergebnis.daten?.dealNumber ?? (await ladeDealNummer(basis.dealRecordId)) ?? "ohne Nummer";
    const text = ergebnis.daten
      ? teamAlarmText(ergebnis.daten)
      : `Angebot angenommen: Auftrag ${dealNumber}, ${new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(basis.confirmedTotalCents / 100)}.`;
    const mitWarnung =
      ergebnis.kanaele.length === 0 ? `${text}\nAchtung: Bestätigung an den Kunden ging nicht raus.` : text;
    try {
      await sendeAnInterne(basis.workspaceId, mitWarnung, { nachholen: true });
    } catch (err) {
      console.error("[kva-bestaetigung] Team-Alarm fehlgeschlagen:", err);
    }
    try {
      await adminAufgabe(basis.workspaceId, basis.dealRecordId, `AB erstellen: Auftrag ${dealNumber}`, mitWarnung);
    } catch (err) {
      console.error("[kva-bestaetigung] Aufgabe fehlgeschlagen:", err);
    }
  } catch (err) {
    console.error("[kva-bestaetigung] Team-Benachrichtigung fehlgeschlagen:", err);
  }
}
