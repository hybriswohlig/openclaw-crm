import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, decodeFromBase64, degrees, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import { formatEur } from "./money";
import { kottkeRestbetragSatz } from "./restbetrag";
import { toWinAnsi } from "./pdf";
import { logoPngFuer } from "./marke/logo-wahl";
import type { ServiceType } from "./types";
import { INTER_REGULAR, INTER_SEMIBOLD, JAKARTA_EXTRABOLD } from "./marke/schriften";

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
  /**
   * Plan 5b: „Gewählt: Komfort am Samstag, 21. November 2026: 1.890,00 €“
   * (fehlende Teile weggelassen). Ersetzt „Option“ und „Festpreis“.
   * Fehlt das Feld, bleibt die Mappe wie vor 5b.
   */
  gewaehlt?: string | null;
  /**
   * Plan 5b, Stunden-KV: aus der Version „Voraussichtlich“ mit der Formulierung
   * aus Entscheidung 9, alt „Stundensatz X € je Stunde“ (F11). Ersetzt die
   * Betragszeile; `text` ist der ganze Satz.
   */
  preisAngabe?: { label: string; wert: string; text: string } | null;
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
  /** Firmen-Optik der angehängten Seiten. Das KV selbst bleibt unverändert. */
  marke: {
    firmaSlug: string;
    /** Leistung für das Logo; null = Grundlogo der Firma. */
    leistung: ServiceType | null;
    /** Hex ohne #, z. B. "c2570c". */
    akzentHex: string;
    /** Steht nur in der Fußzeile, nie an der Unterschrift. */
    ansprechpartner: string | null;
    fusszeile: string | null;
  };
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 50;
const FOOTER_TOP = 48;
const farbe = (hex: string): RGB => {
  const h = hex.replace(/^#/, "").padEnd(6, "0");
  return rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
};
const TINTE = farbe("0e1f35");
const GRAU = farbe("44505f");
const LINIE = farbe("e7e9eb");
const PAPIER = farbe("f6f7f9");
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

function restbetragZeile(d: VertragsmappeDaten): string | null {
  return kottkeRestbetragSatz(d.haftungshinweis || /umzug/i.test(d.leistung));
}

/** Erster Buchstabe groß, Satzpunkt am Ende. */
const alsSatz = (text: string) => {
  const t = text.trim();
  const gross = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(gross) ? gross : `${gross}.`;
};

const gewaehltWert = (gewaehlt: string) => gewaehlt.replace(/^Gewählt:\s*/, "");

/** Der Termin steht schon in der Gewählt-Zeile: dann keine eigene Termin-Zeile. */
function terminInGewaehlt(d: VertragsmappeDaten): boolean {
  return !!d.gewaehlt && !!d.moveDate && d.gewaehlt.includes(tagLang(d.moveDate));
}

function kopfZeilen(d: VertragsmappeDaten): string[] {
  const betrag = formatEur(d.preisCents);
  const gewaehlt = d.gewaehlt?.trim() || null;
  const preisAngabe = d.preisAngabe ?? null;
  const betragZeile = preisAngabe
    ? d.voraussichtlich
      ? `${alsSatz(preisAngabe.text)} Die Abrechnung erfolgt nach tatsächlichem Aufwand. Verbindlich ist die finale Rechnung.`
      : alsSatz(preisAngabe.text)
    : d.voraussichtlich
      ? `Voraussichtlicher Gesamtbetrag: ${betrag}. Die Abrechnung erfolgt nach tatsächlichem Aufwand. Verbindlich ist die finale Rechnung.`
      : `Festpreis: ${betrag}`;
  const z: Array<string | null> = [
    `Auftrag ${d.dealNumber}`,
    d.firma,
    "",
    d.kunde ? `Kunde: ${d.kunde}` : null,
    `Leistung: ${d.leistung}`,
    ...(gewaehlt && !preisAngabe
      ? [gewaehlt]
      : [d.optionName && !gewaehlt ? `Option: ${d.optionName}` : null, gewaehlt, betragZeile]),
    d.moveDate && !terminInGewaehlt(d) ? `Termin: ${tagLang(d.moveDate)}` : null,
    d.fromAddress ? `Von: ${d.fromAddress}` : null,
    d.toAddress ? `Nach: ${d.toAddress}` : null,
    "",
    `Angebot angenommen am ${datumLang(d.angenommenAm)} um ${uhrzeit(d.angenommenAm)} Uhr (Europe/Berlin) im Kundenportal, IP ${d.annahmeIp}.`,
    `Angenommenes Angebot: SHA-256 ${d.kvSha256}`,
    `AGB-Fassung: ${d.agbVersion}${d.agbTextSha256 ? `, SHA-256 ${d.agbTextSha256}` : ""}`,
    d.widerrufHinweis,
    d.haftungshinweis ? "Haftungshinweis nach § 451g HGB vor der Annahme bestätigt." : null,
    d.versicherungGewuenscht ? "Angebot für Versicherung oder Höherhaftung gewünscht." : null,
    restbetragZeile(d),
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

export interface AnnahmeSeiteModell {
  titel: string;
  auftrag: string;
  firma: string;
  eckdaten: { label: string; wert: string; gross?: boolean }[];
  /** Abholung und Ziel vorhanden: kleine Strecke zwischen „Von“ und „Nach“. */
  strecke: boolean;
  stempel: { text: "ANGENOMMEN"; datum: string };
  rechtstexte: string[];
  unterschrift: { beschriftung: string; name: string; zeile: string };
  /** Zeiten, IP und Prüfsummen, klein am Seitenende. */
  pruefvermerk: string[];
  fusszeilen: string[];
}

const datumKurz = (d: Date) =>
  new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ }).format(d);

/** Inhalt der Annahmeseite, ohne Lage auf dem Papier. */
export function annahmeSeiteModell(d: VertragsmappeDaten): AnnahmeSeiteModell {
  const betrag = formatEur(d.preisCents).replace(/\u00a0/g, " ");
  const u = d.unterschrift;
  const art = u.art === "gezeichnet" ? "eigenhändig gezeichnet" : "als Name getippt";
  const gewaehlt = d.gewaehlt?.trim() || null;
  const preisAngabe = d.preisAngabe ?? null;
  const preisZeilen: (AnnahmeSeiteModell["eckdaten"][number] | null)[] =
    gewaehlt && !preisAngabe
      ? [{ label: "Gewählt", wert: gewaehltWert(gewaehlt), gross: true }]
      : [
          gewaehlt
            ? { label: "Gewählt", wert: gewaehltWert(gewaehlt) }
            : d.optionName
              ? { label: "Option", wert: d.optionName }
              : null,
          preisAngabe
            ? { label: preisAngabe.label, wert: preisAngabe.wert, gross: true }
            : { label: d.voraussichtlich ? "Voraussichtlich" : "Festpreis", wert: betrag, gross: true },
        ];
  // Der ganze Satz nur, wenn er mehr sagt als Label und Wert (Mindeststunden beim Stunden-KV aus der Version).
  const preisSatz =
    preisAngabe && preisAngabe.text.trim() !== `${preisAngabe.label} ${preisAngabe.wert}`
      ? alsSatz(preisAngabe.text)
      : null;
  const eckdaten: (AnnahmeSeiteModell["eckdaten"][number] | null)[] = [
    d.kunde ? { label: "Kunde", wert: d.kunde } : null,
    { label: "Leistung", wert: d.leistung },
    ...preisZeilen,
    d.moveDate && !terminInGewaehlt(d) ? { label: "Termin", wert: tagLang(d.moveDate) } : null,
    d.fromAddress ? { label: "Von", wert: d.fromAddress } : null,
    d.toAddress ? { label: "Nach", wert: d.toAddress } : null,
  ];
  const rechtstexte: (string | null)[] = [
    `Angebot angenommen am ${datumLang(d.angenommenAm)} um ${uhrzeit(d.angenommenAm)} Uhr im Kundenportal.`,
    preisSatz,
    d.voraussichtlich ? "Die Abrechnung erfolgt nach tatsächlichem Aufwand. Verbindlich ist die finale Rechnung." : null,
    d.widerrufHinweis,
    d.haftungshinweis ? "Haftungshinweis nach § 451g HGB vor der Annahme bestätigt." : null,
    d.versicherungGewuenscht ? "Angebot für Versicherung oder Höherhaftung gewünscht." : null,
    restbetragZeile(d),
    d.erklaerung,
  ];
  return {
    titel: "Annahme und Unterschrift",
    auftrag: `Auftrag ${d.dealNumber}`,
    firma: d.firma,
    eckdaten: eckdaten.filter((e): e is NonNullable<typeof e> => e !== null),
    strecke: !!d.fromAddress && !!d.toAddress,
    stempel: { text: "ANGENOMMEN", datum: datumKurz(d.angenommenAm) },
    rechtstexte: rechtstexte.filter((r): r is string => !!r),
    unterschrift: {
      beschriftung: "Unterschrift Kunde",
      name: u.name,
      zeile: `Unterschrieben am ${datumLang(u.at)} um ${uhrzeit(u.at)} Uhr, Art: ${art}.`,
    },
    pruefvermerk: [
      `Annahme: ${datumLang(d.angenommenAm)}, ${uhrzeit(d.angenommenAm)} Uhr (Europe/Berlin), IP ${d.annahmeIp}`,
      `Unterschrift: ${datumLang(u.at)}, ${uhrzeit(u.at)} Uhr (Europe/Berlin), IP ${u.ip}`,
      `Angenommenes Angebot: SHA-256 ${d.kvSha256}`,
      `AGB-Fassung: ${d.agbVersion}${d.agbTextSha256 ? `, SHA-256 ${d.agbTextSha256}` : ""}`,
    ],
    fusszeilen: [d.marke.fusszeile, d.marke.ansprechpartner ? `Ihr Ansprechpartner: ${d.marke.ansprechpartner}` : null].filter(
      (z): z is string => !!z,
    ),
  };
}

const zeichensaetze = new WeakMap<PDFFont, Set<number>>();
const kennt = (font: PDFFont, cp: number) => {
  let satz = zeichensaetze.get(font);
  if (!satz) zeichensaetze.set(font, (satz = new Set(font.getCharacterSet())));
  return satz.has(cp);
};

/**
 * Nur Zeichen, für die die Schrift eine Glyphe hat. Weiches Trennzeichen fällt weg,
 * anderes wird wie bisher über WinAnsi ersetzt und sonst zu „?“.
 */
export function fuerSchrift(text: string, font: PDFFont): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0xad) continue;
    if (ch === "\n" || kennt(font, cp)) {
      out += ch;
      continue;
    }
    const ersatz = toWinAnsi(ch);
    out += [...ersatz].every((e) => kennt(font, e.codePointAt(0) ?? 0)) ? ersatz : "?";
  }
  return out;
}

/** Fußzeilen umbrechen statt abschneiden; höchstens drei Zeilen. */
export function fussZeilen(zeilen: string[], umbruch: (text: string) => string[], max = 3): string[] {
  return zeilen.flatMap(umbruch).slice(0, max);
}

type Schriften = { text: PDFFont; semi: PDFFont; titel: PDFFont };
type Stil = { font?: PDFFont; size?: number; farbe?: RGB; x?: number; breite?: number; zeilenabstand?: number };

// Ohne Node-Buffer: das Paket wird auf Vercel mit tsc ohne Node-Typen gebaut.
const ausBase64 = (b64: string) => decodeFromBase64(b64);

/** Größte Schriftgröße zwischen 10 und 22 pt, bei der der Text höchstens maxBreite breit ist. */
export function passendeGroesse(breiteBei: (size: number) => number, maxBreite: number, start = 22, min = 10): number {
  for (let size = start; size > min; size -= 1) if (breiteBei(size) <= maxBreite) return size;
  return min;
}

class Seiten {
  page!: PDFPage;
  y = 0;
  readonly neu: PDFPage[] = [];

  constructor(
    private readonly doc: PDFDocument,
    readonly s: Schriften,
    private readonly kopf: (page: PDFPage) => number,
  ) {
    this.neueSeite();
  }

  neueSeite(): PDFPage {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.neu.push(this.page);
    this.y = this.kopf(this.page);
    return this.page;
  }

  platz(hoehe: number) {
    if (this.y - hoehe < FOOTER_TOP + 14) this.neueSeite();
  }

  /** Umbruch nach tatsächlicher Breite; überlange Wörter werden getrennt. */
  umbruch(text: string, font: PDFFont, size: number, breite: number): string[] {
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

  text(wert: string, stil: Stil = {}) {
    const font = stil.font ?? this.s.text;
    const size = stil.size ?? 10;
    const zeilenhoehe = size * (stil.zeilenabstand ?? 1.4);
    if (!wert.trim()) {
      this.y -= zeilenhoehe / 2;
      return;
    }
    for (const zeile of this.umbruch(fuerSchrift(wert, font), font, size, stil.breite ?? PAGE_W - MARGIN * 2)) {
      this.platz(zeilenhoehe);
      this.page.drawText(zeile, { x: stil.x ?? MARGIN, y: this.y - size, size, font, color: stil.farbe ?? TINTE });
      this.y -= zeilenhoehe;
    }
  }
}

/** Briefkopf der angehängten Seiten: Logo oder Firmenname, Auftrag rechts, Akzentlinie mit Pfeil. */
function briefkopf(page: PDFPage, o: { logo: PDFImage | null; logoBreite: number; firma: string; auftrag: string; s: Schriften; akzent: RGB }): number {
  const oben = PAGE_H - 42;
  let unten: number;
  if (o.logo) {
    const h = (o.logoBreite * o.logo.height) / o.logo.width;
    page.drawImage(o.logo, { x: MARGIN, y: oben - h, width: o.logoBreite, height: h });
    unten = oben - h;
  } else {
    page.drawText(fuerSchrift(o.firma, o.s.titel), { x: MARGIN, y: oben - 16, size: 15, font: o.s.titel, color: TINTE });
    unten = oben - 20;
  }
  const auftrag = fuerSchrift(o.auftrag, o.s.semi);
  page.drawText(auftrag, { x: PAGE_W - MARGIN - o.s.semi.widthOfTextAtSize(auftrag, 9), y: unten + 2, size: 9, font: o.s.semi, color: GRAU });
  const y = unten - 12;
  const ende = PAGE_W - MARGIN;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: ende, y }, thickness: 1.5, color: o.akzent });
  page.drawLine({ start: { x: ende - 6, y: y + 4 }, end: { x: ende, y }, thickness: 1.5, color: o.akzent });
  page.drawLine({ start: { x: ende - 6, y: y - 4 }, end: { x: ende, y }, thickness: 1.5, color: o.akzent });
  return y - 26;
}

/** Gedrehter Stempel: Rahmen in der Akzentfarbe, Wort und Datum zentriert. */
function stempelZeichnen(page: PDFPage, s: Schriften, akzent: RGB, x: number, y: number, st: AnnahmeSeiteModell["stempel"]) {
  const w = 128;
  const h = 44;
  const winkel = -6;
  const rad = (winkel * Math.PI) / 180;
  const punkt = (dx: number, dy: number) => ({ x: x + dx * Math.cos(rad) - dy * Math.sin(rad), y: y + dx * Math.sin(rad) + dy * Math.cos(rad) });
  page.drawRectangle({ x, y, width: w, height: h, borderColor: akzent, borderWidth: 2, rotate: degrees(winkel) });
  const zeilen: [string, PDFFont, number, number][] = [
    [st.text, s.titel, 12.5, 24],
    [st.datum, s.semi, 9.5, 9],
  ];
  for (const [text, font, size, dy] of zeilen) {
    const p = punkt((w - font.widthOfTextAtSize(text, size)) / 2, dy);
    page.drawText(text, { x: p.x, y: p.y, size, font, color: akzent, rotate: degrees(winkel) });
  }
}

export async function baueVertragsmappe(kvPdf: Uint8Array, d: VertragsmappeDaten): Promise<Uint8Array> {
  const kv = await PDFDocument.load(kvPdf, { ignoreEncryption: true });
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(toWinAnsi(`Vertragsmappe Auftrag ${d.dealNumber}`));
  for (const seite of await doc.copyPages(kv, kv.getPageIndices())) doc.addPage(seite);
  const kvSeiten = doc.getPageCount();

  const schriften: Schriften = {
    text: await doc.embedFont(ausBase64(INTER_REGULAR), { subset: true }),
    semi: await doc.embedFont(ausBase64(INTER_SEMIBOLD), { subset: true }),
    titel: await doc.embedFont(ausBase64(JAKARTA_EXTRABOLD), { subset: true }),
  };
  const akzent = farbe(d.marke.akzentHex);
  const logoB64 = logoPngFuer(d.marke.firmaSlug, d.marke.leistung);
  const logo = logoB64 ? await doc.embedPng(ausBase64(logoB64)) : null;
  const m = annahmeSeiteModell(d);

  let logoBreite = 150;
  const s = new Seiten(doc, schriften, (page) =>
    briefkopf(page, { logo, logoBreite, firma: m.firma, auftrag: m.auftrag, s: schriften, akzent }),
  );

  // Titel
  s.text(m.titel, { font: schriften.titel, size: 20, zeilenabstand: 1.2 });
  s.y -= 10;

  // Eckdaten links, Stempel rechts daneben
  const labelX = MARGIN;
  const wertX = MARGIN + 92;
  const wertBreite = PAGE_W - MARGIN - wertX - 150;
  const stempelOben = s.y;
  const strecke: number[] = [];
  for (const e of m.eckdaten) {
    const size = e.gross ? 15 : 10.5;
    const vorher = s.y;
    s.page.drawText(fuerSchrift(e.label.toUpperCase(), schriften.semi), { x: labelX, y: vorher - size + (e.gross ? 3 : 1), size: 7.5, font: schriften.semi, color: akzent });
    s.text(e.wert, { x: wertX, breite: wertBreite, size, font: e.gross ? schriften.titel : schriften.text, zeilenabstand: 1.35 });
    if (m.strecke && (e.label === "Von" || e.label === "Nach")) strecke.push(vorher - size / 2);
    s.y -= 5;
  }
  if (strecke.length === 2) {
    const x = wertX - 12;
    s.page.drawLine({ start: { x, y: strecke[0] }, end: { x, y: strecke[1] }, thickness: 1, color: LINIE });
    for (const y of strecke) s.page.drawCircle({ x, y, size: 3, color: farbe("ffffff"), borderColor: akzent, borderWidth: 1.2 });
  }
  stempelZeichnen(s.page, schriften, akzent, PAGE_W - MARGIN - 132, stempelOben - 58, m.stempel);

  // Rechtstexte wörtlich
  s.y -= 10;
  s.page.drawLine({ start: { x: MARGIN, y: s.y }, end: { x: PAGE_W - MARGIN, y: s.y }, thickness: 0.6, color: LINIE });
  s.y -= 14;
  m.rechtstexte.forEach((r, i) => {
    const letzte = i === m.rechtstexte.length - 1;
    if (letzte) s.y -= 4;
    s.text(r, { size: letzte ? 10 : 9.5, farbe: letzte ? TINTE : GRAU, font: letzte ? schriften.semi : schriften.text });
    s.y -= 3;
  });

  // Unterschrift: Bild oder getippter Name über einer dunklen Grundlinie
  const feldHoehe = 70;
  s.platz(feldHoehe + 70);
  s.y -= 12;
  const u = d.unterschrift;
  if (u.art === "gezeichnet" && u.bildPng) {
    const bild = await doc.embedPng(u.bildPng);
    const massstab = Math.min(240 / bild.width, feldHoehe / bild.height);
    s.page.drawImage(bild, { x: MARGIN + 6, y: s.y - feldHoehe, width: bild.width * massstab, height: bild.height * massstab });
  } else {
    const name = fuerSchrift(u.name, schriften.text);
    const feldBreite = PAGE_W - MARGIN * 2 - 24;
    const size = passendeGroesse((sz) => schriften.text.widthOfTextAtSize(name, sz), feldBreite);
    // Auch bei 10 pt zu lang: umbrechen statt über den Rand laufen.
    const zeilen = s.umbruch(name, schriften.text, size, feldBreite).slice(0, 3);
    zeilen.forEach((z, i) =>
      s.page.drawText(z, { x: MARGIN + 14, y: s.y - feldHoehe + 10 + (zeilen.length - 1 - i) * size * 1.2, size, font: schriften.text, color: TINTE, ySkew: degrees(14) }),
    );
  }
  s.y -= feldHoehe + 4;
  s.page.drawText("x", { x: MARGIN, y: s.y + 3, size: 9, font: schriften.text, color: GRAU });
  s.page.drawLine({ start: { x: MARGIN, y: s.y }, end: { x: MARGIN + 270, y: s.y }, thickness: 1, color: TINTE });
  s.y -= 4;
  s.text(m.unterschrift.beschriftung.toUpperCase(), { size: 7.5, font: schriften.semi, farbe: GRAU });
  s.text(m.unterschrift.name, { size: 10.5, font: schriften.semi });
  s.text(m.unterschrift.zeile, { size: 9, farbe: GRAU });

  // Prüfvermerk: Zeiten, IP und Prüfsummen in einem ruhigen Kasten
  const pruefZeilen = m.pruefvermerk.flatMap((z) => s.umbruch(fuerSchrift(z, schriften.text), schriften.text, 7, PAGE_W - MARGIN * 2 - 20));
  const kastenHoehe = 22 + pruefZeilen.length * 9.5;
  s.y -= 14;
  s.platz(kastenHoehe + 4);
  s.page.drawRectangle({ x: MARGIN, y: s.y - kastenHoehe, width: PAGE_W - MARGIN * 2, height: kastenHoehe, color: PAPIER, borderColor: LINIE, borderWidth: 0.6 });
  s.page.drawText("PRÜFVERMERK", { x: MARGIN + 10, y: s.y - 14, size: 7, font: schriften.semi, color: GRAU });
  pruefZeilen.forEach((z, i) => s.page.drawText(z, { x: MARGIN + 10, y: s.y - 26 - i * 9.5, size: 7, font: schriften.text, color: GRAU }));
  s.y -= kastenHoehe;

  if (d.agbText) {
    logoBreite = 96;
    s.neueSeite();
    s.text(`Allgemeine Geschäftsbedingungen (Fassung ${d.agbVersion})`, { font: schriften.titel, size: 13, zeilenabstand: 1.3 });
    s.y -= 4;
    for (const absatz of d.agbText.split("\n")) s.text(absatz, { size: 9, farbe: GRAU });
  }

  const gesamt = doc.getPageCount();
  s.neu.forEach((seite, i) => {
    const zaehler = `Vertragsmappe Auftrag ${fuerSchrift(d.dealNumber, schriften.text)}, Seite ${kvSeiten + i + 1} von ${gesamt}`;
    seite.drawText(zaehler, { x: PAGE_W - MARGIN - schriften.text.widthOfTextAtSize(zaehler, 7), y: FOOTER_TOP - 24, size: 7, font: schriften.text, color: GRAU });
    const fuss = fussZeilen(m.fusszeilen, (z) => s.umbruch(fuerSchrift(z, schriften.text), schriften.text, 7, PAGE_W - MARGIN * 2 - 170));
    fuss.forEach((zeile, n) => {
      seite.drawText(zeile, { x: MARGIN, y: FOOTER_TOP - 6 - n * 9, size: 7, font: schriften.text, color: GRAU });
    });
  });
  return doc.save();
}
