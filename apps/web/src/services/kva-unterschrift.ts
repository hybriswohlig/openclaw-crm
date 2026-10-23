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
  gleicheAnnahme,
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
  /** Ist das PDF angehängt? Über 8 MB geht die Mail ohne Anhang. */
  pdfDabei: boolean;
}): string {
  const dank = `vielen Dank für Ihre Unterschrift vom ${datumLang(d.unterschriftAm)} um ${uhrzeit(d.unterschriftAm)} Uhr.`;
  return [
    d.kunde ? `Guten Tag ${d.kunde},` : "Guten Tag,",
    d.pdfDabei
      ? `${dank} Im Anhang finden Sie Ihren unterschriebenen Vertrag zu Auftrag ${d.dealNumber} als PDF.`
      : `${dank} Ihren unterschriebenen Vertrag zu Auftrag ${d.dealNumber} können Sie in Ihrem Kundenportal herunterladen.`,
    d.pdfDabei ? `Sie finden ihn auch jederzeit in Ihrem Kundenportal: ${d.portalUrl}` : `Ihr Kundenportal: ${d.portalUrl}`,
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
/** Obergrenzen für das Unterschriftsbild; das Feld liegt real bei etwa 1.400 mal 540 Pixeln. */
const PNG_MAX_BREITE = 4096;
const PNG_MAX_HOEHE = 2048;
const PNG_MAX_PIXEL = 4_000_000;

/**
 * Bytes eines PNG aus einer Data-URL; null bei falschem Präfix, kaputtem
 * Base64, Nicht-PNG oder zu großen Abmessungen (der Decoder reserviert
 * Breite mal Höhe mal 4 Bytes, ein kleines PNG könnte sonst den Speicher sprengen).
 */
export function pngAusDataUrl(dataUrl: string): Uint8Array | null {
  if (!dataUrl.startsWith(PNG_PRAEFIX)) return null;
  const b64 = dataUrl.slice(PNG_PRAEFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  const bytes = new Uint8Array(Buffer.from(b64, "base64"));
  if (bytes.length < 24 || !PNG_MAGIC.every((b, i) => bytes[i] === b)) return null;
  if (Buffer.from(bytes.subarray(12, 16)).toString("ascii") !== "IHDR") return null;
  const ansicht = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const breite = ansicht.getUint32(16);
  const hoehe = ansicht.getUint32(20);
  if (!breite || !hoehe || breite > PNG_MAX_BREITE || hoehe > PNG_MAX_HOEHE || breite * hoehe > PNG_MAX_PIXEL) return null;
  return bytes;
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
  | "angebot_geaendert"
  | "pdf_fehler";

export type UnterschriftErgebnis =
  | { ok: true; nachlauf: () => Promise<void> }
  | { ok: false; reason: UnterschriftGrund };

/**
 * Unterschrift an der Annahme reservieren. Der zurückgegebene Zeitpunkt ist
 * das Kennzeichen dieser Reservierung: Freigabe und Ablage wirken nur, solange
 * genau er noch in der Zeile steht. Eine fremde Reservierung älter als zwei
 * Minuten (Abbruch mittendrin) darf übernommen werden.
 */
export async function reservieren(input: {
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

/** Die eigene Reservierung zurücknehmen, solange noch kein Vertrag abgelegt ist. */
export async function freigeben(confirmationId: string, reservedAt: Date): Promise<void> {
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
    .where(
      and(
        eq(kvaConfirmations.id, confirmationId),
        eq(kvaConfirmations.unterschriftAt, reservedAt),
        isNull(kvaConfirmations.vertragDocumentId)
      )
    );
}

class Ueberholt extends Error {}

/**
 * Vertragsmappe ablegen und an die Annahme binden, in einer Transaktion.
 * Nur wenn die eigene Reservierung noch gilt und die Annahme weiter aktiv ist;
 * sonst wird nichts gespeichert und null zurückgegeben.
 */
export async function vertragAblegen(input: {
  confirmationId: string;
  reservedAt: Date;
  workspaceId: string;
  dealRecordId: string;
  fileName: string;
  pdf: Buffer;
  vertragSha256: string;
}): Promise<string | null> {
  try {
    return await db.transaction(async (tx) => {
      const [doc] = await tx
        .insert(dealDocuments)
        .values({
          workspaceId: input.workspaceId,
          dealRecordId: input.dealRecordId,
          documentType: "signed_contract",
          fileName: input.fileName,
          fileSize: input.pdf.byteLength,
          mimeType: "application/pdf",
          fileContent: input.pdf.toString("base64"),
        })
        .returning({ id: dealDocuments.id });
      const [gebunden] = await tx
        .update(kvaConfirmations)
        .set({ vertragDocumentId: doc.id, vertragSha256: input.vertragSha256 })
        .where(
          and(
            eq(kvaConfirmations.id, input.confirmationId),
            eq(kvaConfirmations.unterschriftAt, input.reservedAt),
            isNull(kvaConfirmations.vertragDocumentId),
            isNull(kvaConfirmations.supersededAt)
          )
        )
        .returning({ id: kvaConfirmations.id });
      if (!gebunden) throw new Ueberholt();
      return doc.id;
    });
  } catch (err) {
    if (err instanceof Ueberholt) return null;
    throw err;
  }
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
  if (!gleicheAnnahme(row.signedAt, payload.annahmeAm)) return { ok: false, reason: "angebot_geaendert" };

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

  let vertragDocumentId: string | null;
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
    vertragDocumentId = await vertragAblegen({
      confirmationId: row.id,
      reservedAt: unterschriftAt,
      workspaceId: link.workspaceId,
      dealRecordId: link.dealRecordId,
      fileName: `Vertrag-${portal.dealNumber}.pdf`.replace(/[\\/\r\n]/g, "_"),
      pdf,
      vertragSha256,
    });
  } catch (err) {
    console.error("[kva-unterschrift] Vertragsmappe fehlgeschlagen:", err);
    await freigeben(row.id, unterschriftAt).catch((e) => console.error("[kva-unterschrift] Freigabe fehlgeschlagen:", e));
    return { ok: false, reason: "pdf_fehler" };
  }
  if (!vertragDocumentId) {
    // Überholt: die Annahme wurde aufgehoben oder widerrufen, oder ein anderer
    // Versuch hat übernommen. Nichts gespeichert, eigene Reservierung freigeben.
    await freigeben(row.id, unterschriftAt).catch((e) => console.error("[kva-unterschrift] Freigabe fehlgeschlagen:", e));
    const aktuell = await ladeAktiveAnnahme(link.dealRecordId);
    return { ok: false, reason: aktuell?.id === row.id ? "bereits_unterschrieben" : "keine_annahme" };
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
    const pdfDabei = pdf.buf.length <= 8 * 1024 * 1024;
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
            pdfDabei,
          }),
          attachments: pdfDabei ? [{ filename: pdf.filename, contentType: "application/pdf", content: pdf.buf }] : [],
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
