/**
 * Unterschrift im Kundenportal (freiwillig, nach der verbindlichen Annahme):
 * Unterschrift an der aktiven Annahme reservieren, Vertragsmappe aus dem
 * gebundenen KV-PDF bauen und als signed_contract ablegen, danach Versand
 * per WhatsApp und E-Mail. Synchron, kein Drittanbieter, kein Cron.
 * Eine Reservierung ohne abgelegten Vertrag (Abbruch mittendrin) ist nach
 * zwei Minuten wieder frei.
 */
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { customerStatusLinks, kvaConfirmations } from "@/db/schema/customer-portal";
import { dealDocuments } from "@/db/schema/financial";
import {
  keinWiderrufHinweis,
  unterschriftErklaerung,
  validateTokenShape,
  type UnterschriftPayload,
} from "@openclaw-crm/customer-portal-core";
import { baueVertragsmappe, type VertragsmappeDaten } from "@openclaw-crm/document-templates";
import { emitEvent } from "./activity-events";
import { sendNewEmail } from "./inbox-email";
import { resolveCustomerEmailTransport } from "./customer-portal-emails";
import { loadContextByToken, resolveCustomerLinkOrigin } from "./customer-portal-data";
import { ladeAktiveAnnahme, sha256Hex } from "./kva-annahme";
import { agbAlsText, ladeWaThread, sendeWhatsAppDokument, sendeWhatsAppText } from "./kva-bestaetigung";
import { leistungLabel } from "./kva-widerruf";
import { sendeAnInterne } from "./intern/intern-senden";

// ─── Texte ────────────────────────────────────────────────────────────────────

const TZ = "Europe/Berlin";
const datumLang = (d: Date) =>
  d.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: TZ });
const datumKurz = (d: Date) =>
  d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ });
const uhrzeit = (d: Date) => d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: TZ });

export function vertragNachrichtWhatsApp(d: { firma: string; kunde: string | null; dealNumber: string; portalUrl: string }): string {
  const vorname = d.kunde?.trim().split(/\s+/)[0];
  return [
    vorname ? `Hallo ${vorname},` : "Hallo,",
    `vielen Dank für Ihre Unterschrift. Ihren unterschriebenen Vertrag zu Auftrag ${d.dealNumber} schicken wir Ihnen als PDF mit, Sie finden ihn auch jederzeit hier: ${d.portalUrl}`,
    `Viele Grüße\n${d.firma}`,
  ].join("\n\n");
}

export function vertragMailText(d: {
  firma: string;
  kunde: string | null;
  dealNumber: string;
  portalUrl: string;
  unterschriftAm: Date;
}): string {
  return [
    d.kunde ? `Guten Tag ${d.kunde},` : "Guten Tag,",
    `vielen Dank für Ihre Unterschrift vom ${datumLang(d.unterschriftAm)} um ${uhrzeit(d.unterschriftAm)} Uhr. Im Anhang finden Sie Ihren unterschriebenen Vertrag zu Auftrag ${d.dealNumber} als PDF.`,
    `Sie finden ihn auch jederzeit in Ihrem Kundenportal: ${d.portalUrl}`,
    `Freundliche Grüße\n${d.firma}`,
  ].join("\n\n");
}

export function teamHinweisUnterschrift(d: { dealNumber: string; name: string; at: Date; versandOk: boolean }): string {
  const zeile = `Vertrag unterschrieben: Auftrag ${d.dealNumber}, ${d.name}, ${datumKurz(d.at)} ${uhrzeit(d.at)} Uhr.`;
  return d.versandOk ? zeile : `${zeile}\nAchtung: Der Vertrag ging nicht an den Kunden. Er liegt im Portal und am Deal.`;
}

/** Widerrufszeile der Annahme-Seite; null bei Altbestand ohne Modus. */
export function widerrufHinweisFuerMappe(modus: string | null, vorzeitigerBeginn: boolean): string | null {
  if (modus === "ausgeschlossen") return keinWiderrufHinweis();
  if (modus === "belehrung") {
    const basis = "Widerrufsbelehrung und Muster-Widerrufsformular wurden vor der Annahme bereitgestellt.";
    return vorzeitigerBeginn ? `${basis} Der Kunde hat den Beginn der Leistung vor Ablauf der Widerrufsfrist verlangt.` : basis;
  }
  return null;
}

const PNG_PRAEFIX = "data:image/png;base64,";
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Bytes eines PNG aus einer Data-URL; null bei falschem Präfix, kaputtem Base64 oder Nicht-PNG. */
export function pngAusDataUrl(dataUrl: string): Uint8Array | null {
  if (!dataUrl.startsWith(PNG_PRAEFIX)) return null;
  const b64 = dataUrl.slice(PNG_PRAEFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  const bytes = new Uint8Array(Buffer.from(b64, "base64"));
  if (bytes.length < PNG_MAGIC.length) return null;
  return PNG_MAGIC.every((b, i) => bytes[i] === b) ? bytes : null;
}

// ─── Unterschrift ─────────────────────────────────────────────────────────────

export type UnterschriftGrund =
  | "invalid_token"
  | "not_found"
  | "revoked"
  | "deaktiviert"
  | "keine_annahme"
  | "kein_pdf"
  | "bereits_unterschrieben"
  | "bild_ungueltig"
  | "pdf_fehler";

export type UnterschriftErgebnis =
  | { ok: true; nachlauf: () => Promise<void> }
  | { ok: false; reason: UnterschriftGrund };

async function reservieren(input: {
  confirmationId: string;
  payload: UnterschriftPayload;
  ipAddress: string;
  userAgent: string;
  bildSha256: string;
}): Promise<Date | null> {
  const [row] = await db
    .update(kvaConfirmations)
    .set({
      unterschriftAt: new Date(),
      unterschriftName: input.payload.name,
      unterschriftArt: input.payload.art,
      unterschriftIp: input.ipAddress.slice(0, 200),
      unterschriftUserAgent: input.userAgent.slice(0, 1000),
      unterschriftBildSha256: input.bildSha256,
    })
    .where(
      and(
        eq(kvaConfirmations.id, input.confirmationId),
        isNull(kvaConfirmations.supersededAt),
        isNull(kvaConfirmations.vertragDocumentId),
        or(
          isNull(kvaConfirmations.unterschriftAt),
          lt(kvaConfirmations.unterschriftAt, sql`now() - interval '2 minutes'`)
        )
      )
    )
    .returning({ unterschriftAt: kvaConfirmations.unterschriftAt });
  return row?.unterschriftAt ?? null;
}

/** Reservierung zurücknehmen, solange noch kein Vertrag abgelegt ist. */
async function freigeben(confirmationId: string): Promise<void> {
  await db
    .update(kvaConfirmations)
    .set({
      unterschriftAt: null,
      unterschriftName: null,
      unterschriftArt: null,
      unterschriftIp: null,
      unterschriftUserAgent: null,
      unterschriftBildSha256: null,
    })
    .where(and(eq(kvaConfirmations.id, confirmationId), isNull(kvaConfirmations.vertragDocumentId)));
}

export async function unterschriftFuerToken(
  token: string,
  payload: UnterschriftPayload,
  ctx: { ipAddress: string; userAgent: string }
): Promise<UnterschriftErgebnis> {
  if (!validateTokenShape(token)) return { ok: false, reason: "invalid_token" };
  const [link] = await db.select().from(customerStatusLinks).where(eq(customerStatusLinks.token, token)).limit(1);
  if (!link) return { ok: false, reason: "not_found" };
  if (link.revokedAt || (link.expiresAt && link.expiresAt < new Date())) return { ok: false, reason: "revoked" };

  const portal = await loadContextByToken(token);
  if (!portal) return { ok: false, reason: "not_found" };
  if (portal.meta.featureDisabled || portal.features?.signature !== true) return { ok: false, reason: "deaktiviert" };

  const row = await ladeAktiveAnnahme(link.dealRecordId);
  if (!row || row.workspaceId !== link.workspaceId) return { ok: false, reason: "keine_annahme" };
  if (!row.quotationDocumentId) return { ok: false, reason: "kein_pdf" };
  if (row.vertragDocumentId) return { ok: false, reason: "bereits_unterschrieben" };

  let bildPng: Uint8Array | null = null;
  if (payload.art === "gezeichnet") {
    bildPng = payload.bildDataUrl ? pngAusDataUrl(payload.bildDataUrl) : null;
    if (!bildPng) return { ok: false, reason: "bild_ungueltig" };
  }
  const bildSha256 = bildPng ? sha256Hex(Buffer.from(bildPng)) : sha256Hex(payload.name);

  const [kvDoc] = await db
    .select({ fileContent: dealDocuments.fileContent })
    .from(dealDocuments)
    .where(
      and(
        eq(dealDocuments.id, row.quotationDocumentId),
        eq(dealDocuments.dealRecordId, link.dealRecordId),
        eq(dealDocuments.workspaceId, link.workspaceId)
      )
    )
    .limit(1);
  if (!kvDoc) return { ok: false, reason: "kein_pdf" };
  const kvBytes = Buffer.from(kvDoc.fileContent, "base64");
  const kvSha256 = sha256Hex(kvBytes);
  // Das gebundene Dokument darf sich seit der Annahme nicht verändert haben.
  if (row.quotationDocumentSha256 && row.quotationDocumentSha256 !== kvSha256) return { ok: false, reason: "kein_pdf" };

  const unterschriftAt = await reservieren({
    confirmationId: row.id,
    payload,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    bildSha256,
  });
  if (!unterschriftAt) return { ok: false, reason: "bereits_unterschrieben" };

  let vertragDocumentId: string;
  let vertragSha256: string;
  try {
    const daten: VertragsmappeDaten = {
      firma: portal.branding.displayName,
      dealNumber: portal.dealNumber,
      kunde: row.acceptedFullName || portal.customerDisplayName,
      preisCents: row.confirmedTotalCents,
      voraussichtlich: (row.quotationSnapshot as { isVariable?: boolean } | null)?.isVariable === true,
      optionName: row.selectedOptionName,
      leistung: leistungLabel(row.serviceType),
      moveDate: row.moveDate,
      fromAddress: row.fromAddress,
      toAddress: row.toAddress,
      angenommenAm: row.signedAt,
      annahmeIp: row.ipAddress,
      agbVersion: row.agbVersionAccepted,
      agbTextSha256: row.agbTextSha256,
      agbText: row.agbText ? agbAlsText(row.agbText) : null,
      kvSha256,
      widerrufHinweis: widerrufHinweisFuerMappe(row.widerrufModus, row.vorzeitigerBeginnVerlangt),
      haftungshinweis: row.haftungshinweisBestaetigt,
      versicherungGewuenscht: row.versicherungGewuenscht,
      erklaerung: unterschriftErklaerung(datumLang(row.signedAt)),
      unterschrift: { art: payload.art, name: payload.name, bildPng, at: unterschriftAt, ip: ctx.ipAddress.slice(0, 200) },
    };
    const pdf = Buffer.from(await baueVertragsmappe(new Uint8Array(kvBytes), daten));
    vertragSha256 = sha256Hex(pdf);
    vertragDocumentId = await db.transaction(async (tx) => {
      const [doc] = await tx
        .insert(dealDocuments)
        .values({
          workspaceId: link.workspaceId,
          dealRecordId: link.dealRecordId,
          documentType: "signed_contract",
          fileName: `Vertrag-${portal.dealNumber}.pdf`.replace(/[\\/\r\n]/g, "_"),
          fileSize: pdf.byteLength,
          mimeType: "application/pdf",
          fileContent: pdf.toString("base64"),
        })
        .returning({ id: dealDocuments.id });
      await tx
        .update(kvaConfirmations)
        .set({ vertragDocumentId: doc.id, vertragSha256 })
        .where(eq(kvaConfirmations.id, row.id));
      return doc.id;
    });
  } catch (err) {
    console.error("[kva-unterschrift] Vertragsmappe fehlgeschlagen:", err);
    await freigeben(row.id).catch((e) => console.error("[kva-unterschrift] Freigabe fehlgeschlagen:", e));
    return { ok: false, reason: "pdf_fehler" };
  }

  await emitEvent({
    workspaceId: link.workspaceId,
    recordId: link.dealRecordId,
    objectSlug: "deals",
    eventType: "customer.kva_signed",
    payload: {
      confirmationId: row.id,
      vertragDocumentId,
      vertragSha256,
      art: payload.art,
      ipAddress: ctx.ipAddress.slice(0, 200),
    },
  });

  const id = row.id;
  return { ok: true, nachlauf: () => vertragNachlauf(id) };
}

// ─── Versand ──────────────────────────────────────────────────────────────────

/** Vertrag an den Kunden und Hinweis ans Team. Nur bei aktiver Annahme, nur einmal. Wirft nie. */
export async function vertragNachlauf(confirmationId: string): Promise<void> {
  try {
    const [row] = await db
      .update(kvaConfirmations)
      .set({ vertragVersandKanaele: "sending" })
      .where(
        and(
          eq(kvaConfirmations.id, confirmationId),
          isNull(kvaConfirmations.supersededAt),
          isNull(kvaConfirmations.vertragVersandAt),
          isNull(kvaConfirmations.vertragVersandKanaele)
        )
      )
      .returning();
    if (!row || !row.vertragDocumentId || !row.unterschriftAt) return;

    const [link] = await db
      .select({ token: customerStatusLinks.token })
      .from(customerStatusLinks)
      .where(eq(customerStatusLinks.id, row.customerLinkId))
      .limit(1);
    const portal = link ? await loadContextByToken(link.token) : null;
    const [doc] = await db
      .select({ fileContent: dealDocuments.fileContent, fileName: dealDocuments.fileName })
      .from(dealDocuments)
      .where(eq(dealDocuments.id, row.vertragDocumentId))
      .limit(1);
    if (!link || !portal || !doc) {
      await db.update(kvaConfirmations).set({ vertragVersandKanaele: null }).where(eq(kvaConfirmations.id, row.id));
      return;
    }

    const origin = await resolveCustomerLinkOrigin(
      row.dealRecordId,
      row.workspaceId,
      process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") || null
    );
    const portalUrl = `${origin}/s/${link.token}`;
    const kunde = row.acceptedFullName || portal.customerDisplayName;
    const pdf = { buf: Buffer.from(doc.fileContent, "base64"), filename: doc.fileName };
    const kanaele: string[] = [];

    try {
      const thread = await ladeWaThread(row.workspaceId, row.dealRecordId);
      if (thread) {
        await sendeWhatsAppDokument(row.workspaceId, thread, pdf, `Ihr unterschriebener Vertrag ${portal.dealNumber}`);
        await sendeWhatsAppText(
          row.workspaceId,
          thread,
          vertragNachrichtWhatsApp({ firma: portal.branding.displayName, kunde, dealNumber: portal.dealNumber, portalUrl })
        );
        kanaele.push("whatsapp");
      }
    } catch (err) {
      console.error("[kva-unterschrift] WhatsApp fehlgeschlagen:", err);
    }

    try {
      const transport = await resolveCustomerEmailTransport(row.workspaceId, row.dealRecordId, true);
      if (transport.ok) {
        await sendNewEmail({
          workspaceId: row.workspaceId,
          channelAccountId: transport.account.id,
          dealRecordId: row.dealRecordId,
          to: transport.customerEmail,
          subject: `Ihr unterschriebener Vertrag ${portal.dealNumber} · ${portal.branding.displayName}`,
          body: vertragMailText({
            firma: portal.branding.displayName,
            kunde,
            dealNumber: portal.dealNumber,
            portalUrl,
            unterschriftAm: row.unterschriftAt,
          }),
          attachments: pdf.buf.length <= 8 * 1024 * 1024 ? [{ filename: pdf.filename, contentType: "application/pdf", content: pdf.buf }] : [],
        });
        kanaele.push("email");
      }
    } catch (err) {
      console.error("[kva-unterschrift] E-Mail fehlgeschlagen:", err);
    }

    await db
      .update(kvaConfirmations)
      .set(kanaele.length > 0 ? { vertragVersandAt: new Date(), vertragVersandKanaele: kanaele.join(",") } : { vertragVersandKanaele: null })
      .where(eq(kvaConfirmations.id, row.id));

    try {
      await sendeAnInterne(
        row.workspaceId,
        teamHinweisUnterschrift({
          dealNumber: portal.dealNumber,
          name: row.unterschriftName ?? kunde ?? "Kunde",
          at: row.unterschriftAt,
          versandOk: kanaele.length > 0,
        }),
        { nachholen: true }
      );
    } catch (err) {
      console.error("[kva-unterschrift] Team-Hinweis fehlgeschlagen:", err);
    }
  } catch (err) {
    console.error("[kva-unterschrift] Nachlauf fehlgeschlagen:", err);
  }
}
