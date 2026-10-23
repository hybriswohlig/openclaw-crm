import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatEur } from "./money";
import { toWinAnsi } from "./pdf";

/**
 * Vertragsmappe nach der Unterschrift im Kundenportal: das angenommene
 * KV-PDF unverändert, dahinter eine Annahme-Seite mit Nachweisen und
 * Unterschrift, dahinter die AGB in der angenommenen Fassung.
 * Rechtstexte (Widerruf, Erklärung) kommen fertig vom Aufrufer.
 */
export interface VertragsmappeDaten {
  firma: string;
  dealNumber: string;
  kunde: string | null;
  preisCents: number;
  voraussichtlich: boolean;
  optionName: string | null;
  leistung: string;
  moveDate: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  angenommenAm: Date;
  annahmeIp: string;
  agbVersion: string;
  agbTextSha256: string | null;
  /** Reiner Text; der Aufrufer wandelt gespeichertes HTML vorher um. */
  agbText: string | null;
  kvSha256: string;
  widerrufHinweis: string | null;
  haftungshinweis: boolean;
  versicherungGewuenscht: boolean;
  erklaerung: string;
  unterschrift: {
    art: "gezeichnet" | "getippt";
    name: string;
    bildPng: Uint8Array | null;
    at: Date;
    ip: string;
  };
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 50;
const FOOTER_TOP = 48;
const TEXT = rgb(0.1, 0.1, 0.1);
const GRAU = rgb(0.4, 0.4, 0.4);
const TZ = "Europe/Berlin";

const datumLang = (d: Date) =>
  new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: TZ }).format(d);
const uhrzeit = (d: Date) =>
  new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(d);
const tagLang = (ymd: string) => datumLang(new Date(`${ymd}T12:00:00Z`));

/** Wortumbruch nach Zeichen; Absätze bleiben, überlange Wörter werden hart getrennt. */
export function umbrechen(text: string, maxZeichen: number): string[] {
  if (!text.trim()) return [];
  const zeilen: string[] = [];
  for (const absatz of text.split("\n")) {
    const woerter = absatz.split(/\s+/).filter(Boolean);
    if (woerter.length === 0) {
      zeilen.push("");
      continue;
    }
    let aktuell = "";
    for (let wort of woerter) {
      while (wort.length > maxZeichen) {
        if (aktuell) {
          zeilen.push(aktuell);
          aktuell = "";
        }
        zeilen.push(wort.slice(0, maxZeichen));
        wort = wort.slice(maxZeichen);
      }
      if (!wort) continue;
      const naechste = aktuell ? `${aktuell} ${wort}` : wort;
      if (naechste.length <= maxZeichen) {
        aktuell = naechste;
      } else {
        zeilen.push(aktuell);
        aktuell = wort;
      }
    }
    if (aktuell) zeilen.push(aktuell);
  }
  return zeilen;
}

function kopfZeilen(d: VertragsmappeDaten): string[] {
  const betrag = formatEur(d.preisCents);
  const z: Array<string | null> = [
    `Auftrag ${d.dealNumber}`,
    d.firma,
    "",
    d.kunde ? `Kunde: ${d.kunde}` : null,
    `Leistung: ${d.leistung}`,
    d.optionName ? `Option: ${d.optionName}` : null,
    d.voraussichtlich
      ? `Voraussichtlicher Gesamtbetrag: ${betrag}. Die Abrechnung erfolgt nach tatsächlichem Aufwand. Verbindlich ist die finale Rechnung.`
      : `Festpreis: ${betrag}`,
    d.moveDate ? `Termin: ${tagLang(d.moveDate)}` : null,
    d.fromAddress ? `Von: ${d.fromAddress}` : null,
    d.toAddress ? `Nach: ${d.toAddress}` : null,
    "",
    `Angebot angenommen am ${datumLang(d.angenommenAm)} um ${uhrzeit(d.angenommenAm)} Uhr (Europe/Berlin) im Kundenportal, IP ${d.annahmeIp}.`,
    `Angenommenes Angebot: SHA-256 ${d.kvSha256}`,
    `AGB-Fassung: ${d.agbVersion}${d.agbTextSha256 ? `, SHA-256 ${d.agbTextSha256}` : ""}`,
    d.widerrufHinweis,
    d.haftungshinweis ? "Haftungshinweis nach § 451g HGB vor der Annahme bestätigt." : null,
    d.versicherungGewuenscht ? "Angebot für Versicherung oder Höherhaftung gewünscht." : null,
    "",
    d.erklaerung,
  ];
  return z.filter((x): x is string => x !== null);
}

function unterschriftZeilen(d: VertragsmappeDaten): string[] {
  const u = d.unterschrift;
  const art = u.art === "gezeichnet" ? "eigenhändig gezeichnet" : "als Name getippt";
  return [`Name: ${u.name}`, `Unterschrieben am ${datumLang(u.at)} um ${uhrzeit(u.at)} Uhr, IP ${u.ip}, Art: ${art}.`];
}

/** Text der Annahme-Seite, eine Zeile je Eintrag, Leerzeile = "". */
export function annahmeSeiteZeilen(d: VertragsmappeDaten): string[] {
  return ["Annahme und Unterschrift", ...kopfZeilen(d), "", ...unterschriftZeilen(d)];
}

class Seiten {
  page: PDFPage;
  y = PAGE_H - MARGIN;
  readonly neu: PDFPage[] = [];

  constructor(private readonly doc: PDFDocument, private readonly font: PDFFont) {
    this.page = this.neueSeite();
  }

  neueSeite(): PDFPage {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.neu.push(this.page);
    this.y = PAGE_H - MARGIN;
    return this.page;
  }

  platz(hoehe: number) {
    if (this.y - hoehe < FOOTER_TOP + 8) this.neueSeite();
  }

  /** Umbruch nach tatsächlicher Breite; überlange Wörter werden getrennt. */
  private nachBreite(text: string, font: PDFFont, size: number): string[] {
    const breite = PAGE_W - MARGIN * 2;
    const zeilen: string[] = [];
    let aktuell = "";
    for (const wort of text.split(/\s+/).filter(Boolean)) {
      const naechste = aktuell ? `${aktuell} ${wort}` : wort;
      if (font.widthOfTextAtSize(naechste, size) <= breite) {
        aktuell = naechste;
        continue;
      }
      if (aktuell) zeilen.push(aktuell);
      aktuell = "";
      let stueck = "";
      for (const ch of wort) {
        if (font.widthOfTextAtSize(stueck + ch, size) > breite && stueck) {
          zeilen.push(stueck);
          stueck = ch;
        } else {
          stueck += ch;
        }
      }
      aktuell = stueck;
    }
    if (aktuell) zeilen.push(aktuell);
    return zeilen;
  }

  text(wert: string, opts: { font?: PDFFont; size?: number; farbe?: ReturnType<typeof rgb> } = {}) {
    const font = opts.font ?? this.font;
    const size = opts.size ?? 10;
    const zeilenhoehe = size + 3;
    if (!wert) {
      this.y -= zeilenhoehe / 2;
      return;
    }
    for (const zeile of this.nachBreite(toWinAnsi(wert), font, size)) {
      this.platz(zeilenhoehe);
      this.page.drawText(zeile, { x: MARGIN, y: this.y - size, size, font, color: opts.farbe ?? TEXT });
      this.y -= zeilenhoehe;
    }
  }
}

export async function baueVertragsmappe(kvPdf: Uint8Array, d: VertragsmappeDaten): Promise<Uint8Array> {
  const kv = await PDFDocument.load(kvPdf, { ignoreEncryption: true });
  const doc = await PDFDocument.create();
  doc.setTitle(toWinAnsi(`Vertragsmappe Auftrag ${d.dealNumber}`));
  for (const seite of await doc.copyPages(kv, kv.getPageIndices())) doc.addPage(seite);
  const kvSeiten = doc.getPageCount();

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fett = await doc.embedFont(StandardFonts.HelveticaBold);
  const kursiv = await doc.embedFont(StandardFonts.HelveticaOblique);
  const s = new Seiten(doc, font);

  s.text("Annahme und Unterschrift", { font: fett, size: 16 });
  s.y -= 6;
  for (const zeile of kopfZeilen(d)) s.text(zeile);

  // Unterschrift: Bild oder getippter Name, darunter Linie und Beschriftung.
  const feldHoehe = 80;
  s.platz(feldHoehe + 40);
  s.y -= 8;
  const u = d.unterschrift;
  if (u.art === "gezeichnet" && u.bildPng) {
    const bild = await doc.embedPng(u.bildPng);
    const massstab = Math.min(220 / bild.width, feldHoehe / bild.height);
    const w = bild.width * massstab;
    const h = bild.height * massstab;
    s.page.drawImage(bild, { x: MARGIN, y: s.y - feldHoehe + (feldHoehe - h) / 2, width: w, height: h });
  } else {
    s.page.drawText(toWinAnsi(u.name), { x: MARGIN, y: s.y - feldHoehe / 2 - 7, size: 20, font: kursiv, color: TEXT });
  }
  s.y -= feldHoehe + 2;
  s.page.drawLine({ start: { x: MARGIN, y: s.y }, end: { x: MARGIN + 220, y: s.y }, thickness: 0.8, color: GRAU });
  s.y -= 4;
  s.text("Unterschrift Kunde", { size: 8, farbe: GRAU });
  s.y -= 6;
  for (const zeile of unterschriftZeilen(d)) s.text(zeile);

  if (d.agbText) {
    s.neueSeite();
    s.text(`Allgemeine Geschäftsbedingungen (Fassung ${d.agbVersion})`, { font: fett, size: 11 });
    s.y -= 4;
    for (const absatz of d.agbText.split("\n")) s.text(absatz, { size: 9 });
  }

  const gesamt = doc.getPageCount();
  s.neu.forEach((seite, i) => {
    seite.drawText(toWinAnsi(`Vertragsmappe Auftrag ${d.dealNumber}, Seite ${kvSeiten + i + 1} von ${gesamt}`), {
      x: MARGIN,
      y: FOOTER_TOP - 20,
      size: 8,
      font,
      color: GRAU,
    });
  });
  return doc.save();
}
