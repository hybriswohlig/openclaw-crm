import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { KOTTKE_LOGO_JPEG_BASE64 } from "./marke/logo-kottke-umzuege";
import type { DocumentModel } from "./types";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const NAVY_FALLBACK = rgb(0.121569, 0.227451, 0.372549);
const INK = rgb(0.133, 0.133, 0.133);
const MUTED = rgb(0.4, 0.4, 0.4);
const WHITE = rgb(1, 1, 1);
const PAY_FILL = rgb(0.956863, 0.968627, 0.984314);
const GRID = rgb(0.78, 0.83, 0.87);

/**
 * WinAnsi (the encoding of the standard PDF fonts) covers German umlauts,
 * ß and the euro sign. Anything else is folded so drawText cannot throw.
 */
export function toWinAnsi(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\n" || ch === "\t") {
      out += ch;
      continue;
    }
    if (code === 0x20ac || code === 0x2013 || code === 0x2014) {
      out += ch;
      continue;
    }
    if (code >= 32 && code <= 255 && code !== 127) {
      out += ch;
      continue;
    }
    if (ch === "−") out += "-";
    else if (ch === "„" || ch === "“" || ch === "”" || ch === "«" || ch === "»") out += '"';
    else if (ch === "‚" || ch === "‘" || ch === "’") out += "'";
    else out += "?";
  }
  return out;
}

/** Base64 to bytes without Node's Buffer. The package tsconfig has no node types. */
function decodeBase64(value: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = value.replace(/=+$/, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const n = alphabet.indexOf(ch);
    if (n < 0) continue;
    buffer = (buffer << 6) | n;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

function accentOf(hex: string) {
  const h = hex.replace("#", "");
  const n = Number.parseInt(h, 16);
  if (!Number.isFinite(n) || h.length !== 6) return NAVY_FALLBACK;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function addressLines(address: string | undefined): string[] {
  if (!address?.trim()) return [];
  const match = address.trim().match(/^(.*),\s*(\d{5}\s+.+)$/);
  if (match) return [match[1].trim(), match[2].trim()];
  return [address.trim()];
}

/** PDF via pdf-lib standard fonts plus the Kottke-Umzüge logo. No headless browser. */
export async function renderPdf(model: DocumentModel): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${model.title} · ${model.customerName}`);
  doc.setAuthor(model.issuer.displayName);
  doc.setSubject(model.displayTitle);
  doc.setKeywords([`template:${model.templateVersion}`, model.kind]);
  doc.setProducer(`Kottke CRM ${model.templateVersion}`);
  doc.setCreator(`Kottke CRM ${model.templateVersion}`);

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const oblique = await doc.embedFont(StandardFonts.HelveticaOblique);
  const logo =
    model.issuer.slug === "kottke"
      ? await doc.embedJpg(decodeBase64(KOTTKE_LOGO_JPEG_BASE64))
      : undefined;
  const page = new Layout(doc, font, bold, oblique, model, accentOf(model.issuer.accent), logo);
  page.draw();
  return doc.save();
}

class Layout {
  private page: PDFPage;
  private y = PAGE_H - 36;
  private readonly pages: PDFPage[] = [];
  private readonly accent: ReturnType<typeof rgb>;

  constructor(
    private readonly doc: PDFDocument,
    private readonly font: PDFFont,
    private readonly bold: PDFFont,
    private readonly oblique: PDFFont,
    private readonly model: DocumentModel,
    accent: ReturnType<typeof rgb>,
    private readonly logo?: PDFImage
  ) {
    this.accent = accent;
    this.page = this.addPage();
  }

  private addPage(): PDFPage {
    const page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(page);
    return page;
  }

  private footerLines(): string[] {
    const c = this.model.issuer.contact;
    const bank = this.model.issuer.bank;
    return [
      [this.model.issuer.displayName, c.owner, c.street, c.place].filter(Boolean).join(" · "),
      [
        c.phone ? `Tel.: ${c.phone}` : null,
        c.whatsapp ? `WhatsApp: ${c.whatsapp}` : null,
        c.email ? `E-Mail: ${c.email}` : null,
        c.website ? `Web: ${c.website}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      [
        `Bankverbindung: ${bank.iban}`,
        `BIC: ${bank.bic}`,
        c.kleinunternehmer ? "Kleinunternehmer gem. § 19 UStG" : null,
        c.taxNumber ? `Steuernummer ${c.taxNumber}` : null,
        `Vorlage ${this.model.templateVersion}`,
      ]
        .filter(Boolean)
        .join(" · "),
    ];
  }

  private footerReserve(): number {
    return 28 + this.footerLines().length * 11;
  }

  private ensure(height: number) {
    if (this.y - height < this.footerReserve()) {
      this.page = this.addPage();
      this.y = PAGE_H - MARGIN;
    }
  }

  private wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const lines: string[] = [];
    for (const paragraph of toWinAnsi(text).split("\n")) {
      const words = paragraph.split(/\s+/).filter(Boolean);
      if (words.length === 0) {
        lines.push("");
        continue;
      }
      let current = "";
      for (const word of words) {
        const next = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) <= width) {
          current = next;
          continue;
        }
        if (current) lines.push(current);
        if (font.widthOfTextAtSize(word, size) <= width) {
          current = word;
          continue;
        }
        let chunk = "";
        for (const ch of word) {
          const trial = chunk + ch;
          if (font.widthOfTextAtSize(trial, size) > width && chunk) {
            lines.push(chunk);
            chunk = ch;
          } else chunk = trial;
        }
        current = chunk;
      }
      if (current) lines.push(current);
    }
    return lines.length ? lines : [""];
  }

  private text(
    value: string,
    x: number,
    opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; width?: number; gap?: number } = {}
  ) {
    const font = opts.font ?? this.font;
    const size = opts.size ?? 10;
    const color = opts.color ?? INK;
    const width = opts.width ?? PAGE_W - MARGIN - x;
    const lines = this.wrap(value, font, size, width);
    const lineHeight = size + 3;
    const needed = lines.length * lineHeight + (opts.gap ?? 2);
    const room = this.y - this.footerReserve();
    const pageRoom = PAGE_H - MARGIN - this.footerReserve();
    if (needed > room && needed <= pageRoom) {
      this.page = this.addPage();
      this.y = PAGE_H - MARGIN;
    }
    for (const line of lines) {
      this.ensure(lineHeight);
      this.page.drawText(line, { x, y: this.y - size, size, font, color });
      this.y -= lineHeight;
    }
    this.y -= opts.gap ?? 2;
  }

  private rightText(value: string, right: number, y: number, size: number, font: PDFFont, color = INK) {
    const line = toWinAnsi(value);
    const w = font.widthOfTextAtSize(line, size);
    this.page.drawText(line, { x: right - w, y, size, font, color });
  }

  private centerText(value: string, y: number, size: number, font: PDFFont, color = INK) {
    const line = toWinAnsi(value);
    const w = font.widthOfTextAtSize(line, size);
    this.page.drawText(line, { x: (PAGE_W - w) / 2, y, size, font, color });
  }

  draw() {
    this.header();
    this.parties();
    this.titleBlock();
    for (const paragraph of this.model.intro) this.text(paragraph, MARGIN, { size: 10, gap: 4, width: PAGE_W - MARGIN * 2 });
    if (this.model.summary) {
      if (this.model.kind === "KV") this.heading("Leistungsumfang");
      this.text(this.model.summary, MARGIN, { size: 10, gap: 4, width: PAGE_W - MARGIN * 2 });
    }
    for (const line of this.model.scopeLines) this.text(`• ${line}`, MARGIN, { size: 10, gap: 1, width: PAGE_W - MARGIN * 2 });
    this.heading("Leistungsübersicht");
    this.lineTable();
    this.totals();
    this.text(this.model.taxNote, MARGIN, { size: 9, gap: 8, color: MUTED, width: PAGE_W - MARGIN * 2 });
    this.paymentBox();
    if (this.model.section35a) {
      this.heading("Hinweis nach § 35a EStG");
      this.text(`Anteil der Arbeits- und Fahrtkosten: ${this.model.section35a.amountLabel}.`, MARGIN, { size: 10, gap: 1 });
      if (this.model.section35a.serviceAddress) {
        this.text(`Leistungsort: ${this.model.section35a.serviceAddress}.`, MARGIN, { size: 10, gap: 1 });
      }
      this.text(this.model.section35a.note, MARGIN, { size: 10, gap: 6 });
    }
    if (this.model.hintLines.length) {
      const tail = [
        ...this.model.hintLines,
        ...this.model.closing,
        "Mit freundlichen Grüßen",
        this.model.signatory ?? "",
        this.model.issuer.displayName,
      ].filter(Boolean);
      const tailH = 30 + tail.reduce((sum, line) => sum + this.wrap(line, this.font, 10, PAGE_W - MARGIN * 2).length * 13 + 4, 0);
      const pageRoom = PAGE_H - MARGIN - this.footerReserve();
      if (tailH <= pageRoom && this.y - tailH < this.footerReserve()) {
        this.page = this.addPage();
        this.y = PAGE_H - MARGIN;
      }
      this.heading("Hinweise");
      for (const line of this.model.hintLines) this.text(line, MARGIN, { size: 10, gap: 3, width: PAGE_W - MARGIN * 2 });
    }
    for (const paragraph of this.model.closing) this.text(paragraph, MARGIN, { size: 10, gap: 3, width: PAGE_W - MARGIN * 2 });
    this.y -= 8;
    this.text("Mit freundlichen Grüßen", MARGIN, { size: 10, gap: 8 });
    if (this.model.signatory) this.text(this.model.signatory, MARGIN, { font: this.bold, size: 10, gap: 1 });
    this.text(this.model.issuer.displayName, MARGIN, { size: 10, gap: 2 });
    this.stampFooters();
  }

  private header() {
    const top = this.y;
    if (this.logo) {
      const w = 176;
      const h = (w * this.logo.height) / this.logo.width;
      this.page.drawImage(this.logo, { x: MARGIN, y: top - h, width: w, height: h });
    } else {
      this.page.drawText(toWinAnsi(this.model.issuer.displayName), {
        x: MARGIN,
        y: top - 14,
        size: 14,
        font: this.bold,
        color: this.accent,
      });
    }
    const c = this.model.issuer.contact;
    const place = [c.street, c.place].filter(Boolean).join(" · ");
    const lines = [
      this.model.issuer.displayName,
      c.owner,
      place,
      c.phone ? `Tel.: ${c.phone}` : undefined,
      c.whatsapp ? `WhatsApp: ${c.whatsapp}` : undefined,
      c.email ? `E-Mail: ${c.email}` : undefined,
      c.website ? `Web: ${c.website}` : undefined,
      c.kleinunternehmer ? "Kleinunternehmer gem. § 19 UStG" : undefined,
      c.taxNumber ? `Steuernummer ${c.taxNumber}` : undefined,
    ].filter((line): line is string => Boolean(line));
    let y = top - 11;
    lines.forEach((line, index) => {
      const italic = line.startsWith("Kleinunternehmer");
      const face = index === 0 ? this.bold : italic ? this.oblique : this.font;
      this.rightText(line, PAGE_W - MARGIN, y, index === 0 ? 11 : 8.5, face, INK);
      y -= index === 0 ? 13 : 11;
    });
    this.y = Math.min(top - (this.logo ? (176 * this.logo.height) / this.logo.width : 20), y) - 8;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_W - MARGIN, y: this.y },
      thickness: 1.4,
      color: this.accent,
    });
    this.y -= 16;
  }

  private parties() {
    const recipient = [
      this.model.recipientLines[0],
      ...addressLines(this.model.customerAddress ?? this.model.recipientLines[1]),
    ].filter((line): line is string => Boolean(line));
    const rowH = 18;
    const tableW = 268;
    const labelW = 118;
    const tableX = PAGE_W - MARGIN - tableW;
    const tableTop = this.y;
    const rows = this.model.infoRows.length;
    this.model.infoRows.forEach((row, index) => {
      const y = tableTop - (index + 1) * rowH;
      this.page.drawRectangle({
        x: tableX,
        y,
        width: labelW,
        height: rowH,
        color: PAY_FILL,
        borderColor: GRID,
        borderWidth: 0.5,
      });
      this.page.drawRectangle({
        x: tableX + labelW,
        y,
        width: tableW - labelW,
        height: rowH,
        color: WHITE,
        borderColor: GRID,
        borderWidth: 0.5,
      });
      this.page.drawText(toWinAnsi(row.label), {
        x: tableX + 6,
        y: y + 5,
        size: 8,
        font: this.bold,
        color: this.accent,
      });
      this.rightText(row.value, tableX + tableW - 6, y + 5, 8, this.font, INK);
    });
    let y = tableTop - 12;
    for (const line of recipient) {
      this.page.drawText(toWinAnsi(line), { x: MARGIN, y, size: 11, font: this.font, color: INK });
      y -= 14;
    }
    this.y = Math.min(y, tableTop - rows * rowH) - 16;
  }

  private titleBlock() {
    this.ensure(40);
    this.centerText(this.model.displayTitle, this.y - 20, 22, this.bold, this.accent);
    this.y -= 28;
    if (this.model.subtitle) {
      this.centerText(this.model.subtitle, this.y - 11, 10, this.font, MUTED);
      this.y -= 20;
    }
  }

  private heading(title: string) {
    this.ensure(22);
    this.page.drawText(toWinAnsi(title), {
      x: MARGIN,
      y: this.y - 12,
      size: 12,
      font: this.bold,
      color: this.accent,
    });
    this.y -= 16;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_W - MARGIN, y: this.y },
      thickness: 0.6,
      color: this.accent,
    });
    this.y -= 8;
  }

  private lineTable() {
    if (this.model.positions.length === 0) return;
    const widths = [32, 78, 220, 72, 97];
    const headers = ["Pos.", "Leistung", "Beschreibung", "Menge", "Betrag"];
    this.row(headers, widths, { header: true });
    this.model.positions.forEach((position, index) => {
      this.row(
        [
          String(index + 1),
          position.leistung,
          position.beschreibung,
          position.quantityLabel,
          position.amountLabel,
        ],
        widths,
        { header: false }
      );
    });
  }

  private row(cells: string[], widths: number[], opts: { header: boolean }) {
    const size = 8.5;
    const font = opts.header ? this.bold : this.font;
    const wrapped = cells.map((cell, i) => this.wrap(cell, font, size, widths[i] - 8));
    const lines = Math.max(...wrapped.map((item) => item.length));
    const height = lines * 11 + 8;
    this.ensure(height);
    if (opts.header) {
      this.page.drawRectangle({
        x: MARGIN,
        y: this.y - height,
        width: widths.reduce((sum, w) => sum + w, 0),
        height,
        color: this.accent,
      });
    }
    let x = MARGIN;
    for (let i = 0; i < cells.length; i++) {
      const alignRight = i >= 3;
      wrapped[i].forEach((line, r) => {
        const w = font.widthOfTextAtSize(line, size);
        const dx = alignRight ? x + widths[i] - 4 - w : x + 4;
        this.page.drawText(line, {
          x: dx,
          y: this.y - 12 - r * 11,
          size,
          font,
          color: opts.header ? WHITE : INK,
        });
      });
      x += widths[i];
    }
    this.y -= height;
  }

  private totals() {
    const label = this.model.totalBarLabel;
    this.ensure(52);
    for (const line of this.model.discountLines) {
      this.rightPair(line.label, line.amountLabel, false);
    }
    this.band("Zwischensumme", this.model.totalLabel, PAY_FILL, INK, true);
    if (this.model.issuer.contact.kleinunternehmer) {
      this.rightPair("Umsatzsteuer gem. § 19 UStG (Kleinunternehmer)", "0,00 €", false);
    }
    this.ensure(20);
    const barH = 20;
    this.page.drawRectangle({
      x: MARGIN,
      y: this.y - barH,
      width: PAGE_W - MARGIN * 2,
      height: barH,
      color: this.accent,
    });
    this.page.drawText(toWinAnsi(label), {
      x: MARGIN + 8,
      y: this.y - 13,
      size: 10,
      font: this.bold,
      color: WHITE,
    });
    this.rightText(this.model.totalLabel, PAGE_W - MARGIN - 8, this.y - 13, 10, this.bold, WHITE);
    this.y -= barH + 8;
  }

  private band(
    label: string,
    value: string,
    fill: ReturnType<typeof rgb>,
    ink: ReturnType<typeof rgb>,
    strong: boolean
  ) {
    const h = 16;
    this.ensure(h);
    this.page.drawRectangle({
      x: MARGIN,
      y: this.y - h,
      width: PAGE_W - MARGIN * 2,
      height: h,
      color: fill,
    });
    const face = strong ? this.bold : this.font;
    this.page.drawText(toWinAnsi(label), { x: MARGIN + 8, y: this.y - 11, size: 9, font: face, color: ink });
    this.rightText(value, PAGE_W - MARGIN - 8, this.y - 11, 9, face, ink);
    this.y -= h;
  }

  private rightPair(label: string, value: string, strong: boolean) {
    this.ensure(14);
    const font = strong ? this.bold : this.font;
    this.page.drawText(toWinAnsi(label), { x: MARGIN + 8, y: this.y - 11, size: 9, font, color: INK });
    this.rightText(value, PAGE_W - MARGIN - 8, this.y - 11, 9, font, INK);
    this.y -= 14;
  }

  private paymentBox() {
    const bits: string[] = [];
    if (this.model.paymentTerms) bits.push(this.model.paymentTerms);
    if (this.model.showBank) {
      bits.push(`Kontoinhaber: ${this.model.issuer.bank.holder}`);
      bits.push(`IBAN: ${this.model.issuer.bank.iban}`);
      bits.push(`BIC: ${this.model.issuer.bank.bic}`);
    }
    if (this.model.invoiceNumber) bits.push(`Verwendungszweck: ${this.model.invoiceNumber}`);
    if (this.model.kind === "RE") bits.push(`Betrag (offen): ${this.model.openLabel ?? this.model.totalLabel}`);
    if (this.model.depositLabel) bits.push(`Anzahlung: ${this.model.depositLabel}`);
    if (this.model.paidLabel) bits.push(`Bereits gebucht: ${this.model.paidLabel}`);
    if (this.model.paymentNote) bits.push(this.model.paymentNote);
    const innerW = PAGE_W - MARGIN * 2 - 16;
    const wrapped = bits.flatMap((bit) => this.wrap(bit, this.font, 9, innerW));
    const height = 16 + wrapped.length * 12;
    this.ensure(height + 32);
    this.heading("Zahlungsinformationen");
    this.page.drawRectangle({
      x: MARGIN,
      y: this.y - height,
      width: PAGE_W - MARGIN * 2,
      height,
      color: PAY_FILL,
    });
    this.page.drawRectangle({
      x: MARGIN,
      y: this.y - height,
      width: 4,
      height,
      color: this.accent,
    });
    let y = this.y - 14;
    for (const line of wrapped) {
      this.page.drawText(line, { x: MARGIN + 12, y, size: 9, font: this.font, color: INK });
      y -= 12;
    }
    this.y -= height + 10;
  }

  private stampFooters() {
    const lines = this.footerLines();
    for (const page of this.pages) {
      let y = 18 + (lines.length - 1) * 10;
      for (const line of lines) {
      const text = toWinAnsi(line);
      const maxW = PAGE_W - 28;
      let size = 7.5;
      const natural = this.font.widthOfTextAtSize(text, size);
      if (natural > maxW) size = (size * maxW) / natural;
      const w = this.font.widthOfTextAtSize(text, size);
      page.drawText(text, { x: (PAGE_W - w) / 2, y, size, font: this.font, color: MUTED });
        y -= 10;
      }
    }
  }
}
