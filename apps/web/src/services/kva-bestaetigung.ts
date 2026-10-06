/**
 * Nach der KV-Annahme: Vertragsbestätigung an den Kunden (§ 312f Abs. 2 BGB,
 * dauerhafter Datenträger: Text mit allen Eckdaten plus das angenommene PDF)
 * und Alarm ans Team. Läuft über after() nach der Antwort; wirft nie.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { kvaConfirmations, customerStatusLinks } from "@/db/schema/customer-portal";
import { channelAccounts, inboxConversations } from "@/db/schema/inbox";
import { dealDocuments } from "@/db/schema/financial";
import {
  HAFTUNGSHINWEIS_451G,
  VORZEITIGER_BEGINN_CHECKBOX,
  firmaKontakt,
  keinWiderrufHinweis,
  musterWiderrufsformular,
  widerrufsbelehrung,
  type FirmaKontakt,
  type WiderrufModus,
} from "@openclaw-crm/customer-portal-core";
import { emitEvent } from "./activity-events";
import { createTask } from "./tasks";
import { workspaceMembers } from "@/db/schema/workspace";
import { sendNewEmail } from "./inbox-email";
import {
  sendBaileysMediaReply,
  sendBaileysReply,
  sendWhatsAppMediaReply,
  sendWhatsAppReply,
} from "./inbox-whatsapp";
import { resolveCustomerEmailTransport } from "./customer-portal-emails";
import { loadContextByToken, resolveCustomerLinkOrigin } from "./customer-portal-data";
import { sendeAnInterne } from "./intern/intern-senden";

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
}

const euro = (c: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(c / 100);
const datum = (ymd: string) =>
  new Date(`${ymd}T12:00:00`).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });

function eckdaten(d: BestaetigungsDaten): string[] {
  return [
    `Auftrag ${d.dealNumber}`,
    d.optionName ? `Leistung: ${d.optionName}` : null,
    `Preis: ${euro(d.preisCents)} (Endpreis)`,
    d.moveDate ? `Termin: ${datum(d.moveDate)}` : null,
    d.fromAddress ? `Von: ${d.fromAddress}` : null,
    d.toAddress ? `Nach: ${d.toAddress}` : null,
  ].filter((z): z is string => !!z);
}

function widerrufKurz(d: BestaetigungsDaten): string[] {
  if (d.widerrufModus === "ausgeschlossen") return [keinWiderrufHinweis()];
  const zeilen = [
    "Widerrufsbelehrung: Sie können diesen Vertrag binnen vierzehn Tagen ab Vertragsschluss ohne Angabe von Gründen widerrufen. Die vollständige Widerrufsbelehrung und das Muster-Widerrufsformular finden Sie in der E-Mail und im Kundenportal.",
  ];
  if (d.vorzeitigerBeginn) zeilen.push(`Sie haben verlangt, dass wir vor Ende der Widerrufsfrist beginnen: ${VORZEITIGER_BEGINN_CHECKBOX}`);
  return zeilen;
}

export function bestaetigungsTextWhatsApp(d: BestaetigungsDaten): string {
  const vorname = d.kunde?.trim().split(/\s+/)[0];
  return [
    vorname ? `Hallo ${vorname},` : "Hallo,",
    `vielen Dank, Ihr Auftrag ist verbindlich erteilt. Hier die Bestätigung von ${d.firma}:`,
    eckdaten(d).join("\n"),
    ...widerrufKurz(d),
    d.haftung ? `${HAFTUNGSHINWEIS_451G.titel}: ${HAFTUNGSHINWEIS_451G.absaetze.join(" ")}` : null,
    d.pdfDabei ? "Das angenommene Angebot mit unseren AGB schicken wir Ihnen als PDF mit." : `Das angenommene Angebot mit unseren AGB finden Sie hier: ${d.portalUrl}`,
    `Viele Grüße\n${d.firma}`,
  ].filter(Boolean).join("\n\n");
}

export function bestaetigungsMailText(d: BestaetigungsDaten): string {
  const teile = [
    d.kunde ? `Guten Tag ${d.kunde},` : "Guten Tag,",
    `vielen Dank für Ihren Auftrag. Hiermit bestätigen wir den Vertrag, den Sie am ${new Date(d.signedAt).toLocaleString("de-DE", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Berlin" })} Uhr im Kundenportal geschlossen haben.`,
    eckdaten(d).join("\n"),
    "Im Anhang finden Sie das angenommene Angebot als PDF und unsere AGB in der Fassung, die Sie bei der Annahme akzeptiert haben.",
  ];
  if (d.haftung) teile.push([HAFTUNGSHINWEIS_451G.titel, ...HAFTUNGSHINWEIS_451G.absaetze].join("\n"));
  if (d.versicherungGewuenscht) teile.push("Sie haben ein Angebot für eine weitergehende Haftung oder Versicherung gewünscht. Wir melden uns dazu vor dem Umzug.");
  if (d.widerrufModus === "ausgeschlossen") teile.push(keinWiderrufHinweis());
  else {
    const b = widerrufsbelehrung(d.kontakt);
    teile.push([b.titel, ...b.absaetze].join("\n"));
    teile.push(musterWiderrufsformular(d.kontakt).join("\n"));
    if (d.vorzeitigerBeginn) teile.push(`Ihre Erklärung bei der Annahme: ${VORZEITIGER_BEGINN_CHECKBOX}`);
  }
  teile.push(`Ihr Kundenportal: ${d.portalUrl}`, `Freundliche Grüße\n${d.firma}`);
  return teile.join("\n\n");
}

export function teamAlarmText(d: BestaetigungsDaten): string {
  return [
    `Angebot angenommen: Auftrag ${d.dealNumber}${d.kunde ? `, ${d.kunde}` : ""}, ${euro(d.preisCents)}${d.optionName ? `, ${d.optionName}` : ""}${d.moveDate ? `, Termin ${datum(d.moveDate)}` : ""}.`,
    d.versicherungGewuenscht ? "Kunde wünscht ein Angebot für Versicherung oder Höherhaftung." : null,
    "Nächster Schritt: Auftragsbestätigung erstellen und Anzahlung prüfen.",
  ].filter(Boolean).join("\n");
}

// ─── Versand ──────────────────────────────────────────────────────────────────

interface WaThread {
  conversationId: string;
  cloudApi: boolean;
}

/** Jüngster WhatsApp-Thread des Deals (Cloud-API oder hauseigenes Baileys). */
async function ladeWaThread(workspaceId: string, dealRecordId: string): Promise<WaThread | null> {
  const [thread] = await db
    .select({
      conversationId: inboxConversations.id,
      waPhoneNumberId: channelAccounts.waPhoneNumberId,
      baileysBridgeProvider: channelAccounts.baileysBridgeProvider,
    })
    .from(inboxConversations)
    .innerJoin(channelAccounts, eq(inboxConversations.channelAccountId, channelAccounts.id))
    .where(
      and(
        eq(inboxConversations.workspaceId, workspaceId),
        eq(inboxConversations.dealRecordId, dealRecordId),
        eq(channelAccounts.channelType, "whatsapp")
      )
    )
    .orderBy(sql`COALESCE(${inboxConversations.lastMessageAt}, ${inboxConversations.createdAt}) DESC`)
    .limit(1);
  if (!thread) return null;
  if (thread.waPhoneNumberId) return { conversationId: thread.conversationId, cloudApi: true };
  if (thread.baileysBridgeProvider === "inhouse") return { conversationId: thread.conversationId, cloudApi: false };
  return null;
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
      const file = {
        blob: new Blob([new Uint8Array(pdf.buf)], { type: "application/pdf" }),
        mimeType: "application/pdf",
        filename: pdf.filename,
        size: pdf.buf.length,
      };
      const caption = `Ihr angenommenes Angebot ${daten.dealNumber}`;
      if (thread.cloudApi) {
        await sendWhatsAppMediaReply({ conversationId: thread.conversationId, workspaceId, file, caption });
      } else {
        await sendBaileysMediaReply({ conversationId: thread.conversationId, workspaceId, file, caption });
      }
      pdfGesendet = true;
    } catch (err) {
      console.error("[kva-bestaetigung] PDF per WhatsApp fehlgeschlagen:", err);
    }
  }
  try {
    const body = bestaetigungsTextWhatsApp({ ...daten, pdfDabei: pdfGesendet });
    if (thread.cloudApi) {
      await sendWhatsAppReply({ conversationId: thread.conversationId, workspaceId, body });
    } else {
      await sendBaileysReply({ conversationId: thread.conversationId, workspaceId, body });
    }
    return { ok: true, pdf: pdfGesendet };
  } catch (err) {
    console.error("[kva-bestaetigung] WhatsApp-Text fehlgeschlagen:", err);
    return { ok: false, pdf: pdfGesendet };
  }
}

async function teamAufgabe(workspaceId: string, dealRecordId: string, dealNumber: string, beschreibung: string) {
  const [admin] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, "admin")))
    .orderBy(workspaceMembers.createdAt)
    .limit(1);
  if (!admin) return;
  await createTask(`AB erstellen: Auftrag ${dealNumber}`, admin.userId, workspaceId, {
    recordIds: [dealRecordId],
    description: beschreibung,
    kind: "operativ",
  });
}

/**
 * Bestätigung an den Kunden (WhatsApp und/oder E-Mail, jeweils mit dem
 * angenommenen PDF) und optional Alarm ans Team. Wirft nie.
 */
export async function annahmeNachlauf(
  confirmationId: string,
  opts: { mitTeamAlarm: boolean }
): Promise<void> {
  try {
    const [row] = await db.select().from(kvaConfirmations).where(eq(kvaConfirmations.id, confirmationId)).limit(1);
    if (!row || row.supersededAt) return;
    const [link] = await db
      .select({ token: customerStatusLinks.token })
      .from(customerStatusLinks)
      .where(eq(customerStatusLinks.id, row.customerLinkId))
      .limit(1);
    if (!link) return;
    const ctx = await loadContextByToken(link.token);
    if (!ctx) return;

    const origin = await resolveCustomerLinkOrigin(
      row.dealRecordId,
      row.workspaceId,
      process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") || null
    );
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

    const thread = await ladeWaThread(row.workspaceId, row.dealRecordId);
    if (thread) {
      const wa = await sendeWhatsApp(row.workspaceId, thread, daten, pdf);
      if (wa.ok) kanaele.push("whatsapp");
      pdfZugestellt ||= wa.pdf;
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
            filename: `AGB-${ctx.branding.firmaSlug}.html`,
            contentType: "text/html; charset=utf-8",
            content: Buffer.from(row.agbText, "utf-8"),
          });
        }
        await sendNewEmail({
          workspaceId: row.workspaceId,
          channelAccountId: transport.account.id,
          dealRecordId: row.dealRecordId,
          to: transport.customerEmail,
          subject: `Bestätigung Ihres Auftrags ${ctx.dealNumber} bei ${ctx.branding.displayName}`,
          body: bestaetigungsMailText({ ...daten, pdfDabei: attachments.some((a) => a.contentType === "application/pdf") }),
          attachments,
        });
        kanaele.push("email");
        pdfZugestellt ||= attachments.some((a) => a.contentType === "application/pdf");
      }
    } catch (err) {
      console.error("[kva-bestaetigung] E-Mail fehlgeschlagen:", err);
    }

    if (kanaele.length > 0) {
      await db
        .update(kvaConfirmations)
        .set({ confirmationSentAt: new Date(), confirmationChannels: kanaele.join(",") })
        .where(eq(kvaConfirmations.id, row.id));
    }
    await emitEvent({
      workspaceId: row.workspaceId,
      recordId: row.dealRecordId,
      objectSlug: "deals",
      eventType: "customer.kva_confirmation_sent",
      payload: { confirmationId: row.id, channels: kanaele, pdf: pdfZugestellt },
    });

    if (opts.mitTeamAlarm) {
      const text = teamAlarmText(daten);
      try {
        await sendeAnInterne(row.workspaceId, kanaele.length === 0 ? `${text}\nAchtung: Bestätigung an den Kunden ging nicht raus.` : text, { nachholen: true });
      } catch (err) {
        console.error("[kva-bestaetigung] Team-Alarm fehlgeschlagen:", err);
      }
      try {
        await teamAufgabe(row.workspaceId, row.dealRecordId, ctx.dealNumber, text);
      } catch (err) {
        console.error("[kva-bestaetigung] Aufgabe fehlgeschlagen:", err);
      }
    }
  } catch (err) {
    console.error("[kva-bestaetigung] Nachlauf fehlgeschlagen:", err);
  }
}
