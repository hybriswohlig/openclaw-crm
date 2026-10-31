import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { DocumentModel } from "./types";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 50;
const BLACK = rgb(0, 0, 0);

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
    if (code === 0x20ac) {
      out += ch;
      continue;
    }
    if (code >= 32 && code <= 255 && code !== 127) {
      out += ch;
      continue;
    }
    if (ch === "–" || ch === "—" || ch === "−") out += "-";
    else if (ch === "„" || ch === "“" || ch === "”" || ch === "«" || ch === "»") out += '"';
    else if (ch === "‚" || ch === "‘" || ch === "’") out += "'";
    else out += "?";
  }
  return out;
}

class Writer {
  private page: PDFPage;
  private y: number;
  private readonly pages: PDFPage[] = [];

  constructor(
    private readonly doc: PDFDocument,
    private readonly font: PDFFont,
    private readonly bold: PDFFont,
    private readonly model: DocumentModel
  ) {
    this.page = this.addPage();
    this.y = PAGE_H - MARGIN;
  }

  private addPage(): PDFPage {
    const page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(page);
    return page;
  }

  private footerLines(): string[] {
    return this.wrap(
      [this.model.issuer.displayName, ...this.model.issuer.lines, `Vorlage ${this.model.templateVersion}`].join(
        " · "
      ),
      this.font,
      9,
      PAGE_W - MARGIN * 2
    );
  }

  private footerReserve(): number {
    return 20 + this.footerLines().length * 12;
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
          } else {
            chunk = trial;
          }
        }
        current = chunk;
      }
      if (current) lines.push(current);
    }
    return lines.length ? lines : [""];
  }

  text(value: string, opts: { font?: PDFFont; size?: number; gap?: number; color?: ReturnType<typeof rgb> } = {}) {
    const font = opts.font ?? this.font;
    const size = opts.size ?? 10;
    const color = opts.color ?? BLACK;
    const lines = this.wrap(value, font, size, PAGE_W - MARGIN * 2);
    const lineHeight = size + 3;
    for (const line of lines) {
      this.ensure(lineHeight);
      this.page.drawText(line, { x: MARGIN, y: this.y - size, size, font, color });
      this.y -= lineHeight;
    }
    this.y -= opts.gap ?? 4;
  }

  rule() {
    this.ensure(8);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_W - MARGIN, y: this.y },
      thickness: 1,
      color: rgb(0.12, 0.23, 0.37),
    });
    this.y -= 12;
  }

  columns(cells: string[], widths: number[], opts: { bold?: boolean; size?: number } = {}) {
    const font = opts.bold ? this.bold : this.font;
    const size = opts.size ?? 9;
    const wrapped = cells.map((cell, i) => this.wrap(cell, font, size, widths[i] - 6));
    const rows = Math.max(...wrapped.map((lines) => lines.length));
    const lineHeight = size + 3;
    this.ensure(rows * lineHeight + 4);
    let x = MARGIN;
    for (let i = 0; i < cells.length; i++) {
      const alignRight = i > 0;
      for (let r = 0; r < wrapped[i].length; r++) {
        const line = wrapped[i][r];
        const w = font.widthOfTextAtSize(line, size);
        const dx = alignRight ? x + widths[i] - 4 - w : x + 2;
        this.page.drawText(line, {
          x: dx,
          y: this.y - size - r * lineHeight,
          size,
          font,
          color: BLACK,
        });
      }
      x += widths[i];
    }
    this.y -= rows * lineHeight + 4;
  }

  stampFooters() {
    for (const page of this.pages) {
      const lines = this.footerLines();
      let y = 16 + (lines.length - 1) * 12;
      for (const line of lines) {
        page.drawText(line, {
          x: MARGIN,
          y,
          size: 9,
          font: this.font,
          color: BLACK,
        });
        y -= 12;
      }
    }
  }
}

/** PDF via pdf-lib standard fonts. No embedded font files, no headless browser. */
export async function renderPdf(model: DocumentModel): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${model.title} · ${model.customerName}`);
  doc.setAuthor(model.issuer.displayName);
  doc.setSubject(model.title);
  doc.setKeywords([`template:${model.templateVersion}`, model.kind]);
  doc.setProducer(`Kottke CRM ${model.templateVersion}`);
  doc.setCreator(`Kottke CRM ${model.templateVersion}`);

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, font, bold, model);

  w.text(model.issuer.displayName, { font: bold, size: 14, gap: 2 });
  for (const line of model.issuer.lines) w.text(line, { size: 11, gap: 0 });
  w.text(model.documentDateLabel, { size: 11, gap: 8 });
  w.rule();
  w.text(model.title, { font: bold, size: 16, gap: 8 });
  for (const line of model.recipientLines) w.text(line, { size: 11, gap: 1 });
  w.text("", { gap: 6 });

  const facts: Array<[string, string | undefined]> = [
    ["E-Mail", model.customerEmail],
    ["Leistung", model.serviceLabel],
    ["Auszug", model.fromAddress],
    ["Einzug", model.toAddress],
    ["Rechnungsnummer", model.invoiceNumber],
    ["Rechnungsdatum", model.kind === "RE" ? model.documentDateLabel : undefined],
    [model.serviceDateCaption, model.serviceDateLabel],
    ["Gültig bis", model.validUntilLabel],
  ];
  for (const [label, value] of facts) {
    if (value) w.text(`${label}: ${value}`, { size: 11, gap: 1 });
  }
  w.text("", { gap: 4 });

  for (const paragraph of model.intro) w.text(paragraph, { size: 11, gap: 6 });
  if (model.summary) {
    w.text("Leistungsumfang", { font: bold, size: 12, gap: 2 });
    w.text(model.summary, { size: 11, gap: 6 });
  }
  for (const line of model.scopeLines) w.text(`• ${line}`, { size: 11, gap: 1 });

  const widths = [255, 50, 95, 95];
  if (model.positions.length > 0) {
    w.columns(["Position", "Menge", "Einzelpreis", "Betrag"], widths, { bold: true, size: 11 });
    for (const position of model.positions) {
      w.columns(
        [position.title, position.quantityLabel, position.unitRateLabel, position.amountLabel],
        widths,
        { size: 11 }
      );
    }
  }
  w.text(`${model.totalCaption}: ${model.totalLabel}`, { font: bold, size: 12, gap: 6 });

  if (model.depositLabel) w.text(`Anzahlung: ${model.depositLabel}`, { size: 11, gap: 1 });
  if (model.remainderLabel) w.text(`Rest nach Anzahlung: ${model.remainderLabel}`, { size: 11, gap: 1 });
  if (model.paymentMethodLabel) w.text(`Zahlungsart: ${model.paymentMethodLabel}`, { size: 11, gap: 1 });
  if (model.paidLabel) w.text(`Bereits gebucht: ${model.paidLabel}`, { size: 11, gap: 1 });
  if (model.openLabel) w.text(`Offen: ${model.openLabel}`, { size: 11, gap: 4 });
  if (model.paymentTerms) w.text(model.paymentTerms, { size: 11, gap: 6 });

  if (model.remarks) {
    w.text("Hinweise", { font: bold, size: 12, gap: 2 });
    w.text(model.remarks, { size: 11, gap: 6 });
  }
  for (const paragraph of model.closing) w.text(paragraph, { size: 11, gap: 4 });
  w.text(model.taxNote, { size: 11, gap: 6 });
  if (model.section35a) {
    w.text("Hinweis nach § 35a EStG", { font: bold, size: 12, gap: 2 });
    w.text(`Anteil der Arbeits- und Fahrtkosten: ${model.section35a.amountLabel}.`, { size: 11, gap: 1 });
    if (model.section35a.serviceAddress) {
      w.text(`Leistungsort: ${model.section35a.serviceAddress}.`, { size: 11, gap: 1 });
    }
    w.text(model.section35a.note, { size: 11, gap: 6 });
  }
  if (model.showBank) {
    w.text("Bankverbindung", { font: bold, size: 12, gap: 2 });
    w.text(model.issuer.bank.holder, { size: 11, gap: 0 });
    w.text(`IBAN ${model.issuer.bank.iban}`, { size: 11, gap: 0 });
    w.text(`BIC ${model.issuer.bank.bic}`, { size: 11, gap: 4 });
  }

  w.stampFooters();
  return doc.save();
}
