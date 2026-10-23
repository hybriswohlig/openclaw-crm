import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { PDFDict, PDFName, PDFRawStream } from "pdf-lib";
import { annahmeSeiteModell, annahmeSeiteZeilen, baueVertragsmappe, umbrechen, type VertragsmappeDaten } from "./vertragsmappe";

async function miniKv(seiten: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < seiten; i++) doc.addPage([595.28, 841.89]);
  return doc.save();
}

const basis: VertragsmappeDaten = {
  firma: "Kottke Dienstleistungen", dealNumber: "K-1042", kunde: "Anna Muster",
  preisCents: 175000, voraussichtlich: false, optionName: null, leistung: "Umzug",
  moveDate: "2026-11-26", fromAddress: "Hauptstr. 5, 72202 Nagold", toAddress: "Gartenweg 2, 70173 Stuttgart",
  angenommenAm: new Date("2026-10-22T08:15:00Z"), annahmeIp: "203.0.113.5",
  agbVersion: "kottke-2026-10", agbTextSha256: "ab".repeat(32), agbText: "§ 1 Geltung\nDiese AGB gelten für alle Umzüge.\n\n§ 2 Preise\nAlle Preise verstehen sich inklusive Mehrwertsteuer.",
  kvSha256: "cd".repeat(32),
  widerrufHinweis: "Für Umzugsaufträge mit festem Termin besteht kein gesetzliches Widerrufsrecht (§ 312g Abs. 2 Satz 1 Nr. 9 BGB).",
  haftungshinweis: true, versicherungGewuenscht: false,
  erklaerung: "Mit meiner Unterschrift bestätige ich den oben bezeichneten Vertrag, den ich am 22. Oktober 2026 im Kundenportal geschlossen habe.",
  unterschrift: { art: "getippt", name: "Anna Muster", bildPng: null, at: new Date("2026-10-22T08:20:00Z"), ip: "203.0.113.5" },
  marke: { firmaSlug: "kottke", akzentHex: "c2570c", ansprechpartner: "Dario Kottke", fusszeile: "Kottke Dienstleistungen · Marktstr. 8 · 72218 Wildberg" },
};

/** Schriftnamen aller eingebetteten Fonts. */
function schriften(doc: PDFDocument): string[] {
  return doc.context
    .enumerateIndirectObjects()
    .map(([, o]) => o)
    .filter((o): o is PDFDict => o instanceof PDFDict && o.get(PDFName.of("Type")) === PDFName.of("Font"))
    .map((o) => String(o.get(PDFName.of("BaseFont")) ?? ""));
}

/** Anzahl Bilder auf einer Seite. */
function bilder(doc: PDFDocument, seite: number): number {
  const xo = doc.getPage(seite).node.Resources()?.lookup(PDFName.of("XObject"));
  if (!(xo instanceof PDFDict)) return 0;
  return xo.keys().filter((k) => {
    const o = doc.context.lookup(xo.get(k));
    return o instanceof PDFRawStream && o.dict.get(PDFName.of("Subtype")) === PDFName.of("Image");
  }).length;
}

describe("annahmeSeiteModell", () => {
  it("stempelt ANGENOMMEN mit Datum und legt IP und Prüfsummen in den Prüfvermerk", () => {
    const m = annahmeSeiteModell(basis);
    expect(m.titel).toBe("Annahme und Unterschrift");
    expect(m.stempel).toEqual({ text: "ANGENOMMEN", datum: "22.10.2026" });
    expect(m.eckdaten).toContainEqual({ label: "Festpreis", wert: "1.750,00 €", gross: true });
    expect(m.eckdaten.map((e) => e.label)).toEqual(["Kunde", "Leistung", "Festpreis", "Termin", "Von", "Nach"]);
    expect(m.strecke).toBe(true);
    const pruef = m.pruefvermerk.join("\n");
    expect(pruef).toContain(`SHA-256 ${"cd".repeat(32)}`);
    expect(pruef).toContain("203.0.113.5");
    expect(pruef).toContain("AGB-Fassung: kottke-2026-10");
    expect(m.rechtstexte.join("\n")).not.toContain("203.0.113.5");
    expect(m.rechtstexte.join("\n")).toContain("§ 451g HGB");
    expect(m.rechtstexte.at(-1)).toBe(basis.erklaerung);
    expect(m.unterschrift.beschriftung).toBe("Unterschrift Kunde");
  });
  it("nennt den Ansprechpartner nur in der Fußzeile, nie an der Unterschrift", () => {
    const m = annahmeSeiteModell(basis);
    const ohneFuss = JSON.stringify({ ...m, fusszeilen: [] });
    expect(ohneFuss).not.toContain("Dario");
    expect(m.fusszeilen.join(" ")).toContain("Ihr Ansprechpartner: Dario Kottke");
  });
  it("nach Aufwand und ohne Adressen: voraussichtlich, keine Strecke", () => {
    const m = annahmeSeiteModell({ ...basis, voraussichtlich: true, fromAddress: null });
    expect(m.eckdaten).toContainEqual({ label: "Voraussichtlich", wert: "1.750,00 €", gross: true });
    expect(m.rechtstexte).toContain("Die Abrechnung erfolgt nach tatsächlichem Aufwand. Verbindlich ist die finale Rechnung.");
    expect(m.strecke).toBe(false);
  });
});

describe("Annahmeseite im Kottke-Look", () => {
  it("bettet Inter und Plus Jakarta Sans und das Logo ein", async () => {
    const doc = await PDFDocument.load(await baueVertragsmappe(await miniKv(1), basis));
    const namen = schriften(doc).join(" ");
    expect(namen).toMatch(/Inter/);
    expect(namen).toMatch(/PlusJakartaSans/);
    expect(namen).not.toMatch(/Helvetica/);
    expect(bilder(doc, 1)).toBe(1); // Logo, getippte Unterschrift ohne Bild
  });
  it("gezeichnete Unterschrift kommt als zweites Bild dazu", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    const doc = await PDFDocument.load(
      await baueVertragsmappe(await miniKv(1), { ...basis, unterschrift: { ...basis.unterschrift, art: "gezeichnet", bildPng: new Uint8Array(png) } }),
    );
    expect(bilder(doc, 1)).toBe(2);
  });
  it("unbekannte Firma: kein Logo, kein Fehler, gleiche Seitenzahl", async () => {
    const doc = await PDFDocument.load(
      await baueVertragsmappe(await miniKv(2), { ...basis, marke: { firmaSlug: "unbekannt", akzentHex: "3a567f", ansprechpartner: null, fusszeile: null } }),
    );
    expect(doc.getPageCount()).toBe(4);
    expect(bilder(doc, 2)).toBe(0);
  });
});

describe("umbrechen", () => {
  it("bricht an Wortgrenzen und erhält Absätze", () => {
    expect(umbrechen("aaa bbb ccc", 7)).toEqual(["aaa bbb", "ccc"]);
    expect(umbrechen("eins\nzwei", 10)).toEqual(["eins", "zwei"]);
    expect(umbrechen("", 10)).toEqual([]);
    expect(umbrechen("x".repeat(25), 10)).toEqual(["x".repeat(10), "x".repeat(10), "x".repeat(5)]);
  });
});

describe("annahmeSeiteZeilen", () => {
  it("Festpreis, Termin, Hashes, Widerruf ausgeschlossen, Haftung, Unterschrift", () => {
    const z = annahmeSeiteZeilen(basis).join("\n");
    expect(z).toContain("Auftrag K-1042");
    expect(z).toContain("Festpreis: 1.750,00");
    expect(z).toContain("Termin: 26. November 2026");
    expect(z).toContain(`SHA-256 ${"cd".repeat(32)}`);
    expect(z).toContain("AGB-Fassung: kottke-2026-10");
    expect(z).toContain("kein gesetzliches Widerrufsrecht");
    expect(z).toContain("§ 451g HGB");
    expect(z).toContain("am 22. Oktober 2026 im Kundenportal");
    expect(z).toContain("Name: Anna Muster");
    expect(z).toContain("10:20 Uhr");
    expect(z).not.toMatch(/[—–]/);
  });
  it("nach Aufwand: voraussichtlich und Rechnung maßgeblich", () => {
    const z = annahmeSeiteZeilen({ ...basis, voraussichtlich: true }).join("\n");
    expect(z).toContain("Voraussichtlicher Gesamtbetrag: 1.750,00");
    expect(z).toContain("Verbindlich ist die finale Rechnung.");
    expect(z).not.toContain("Festpreis");
  });
  it("ohne Widerrufshinweis (Altbestand) keine Widerrufszeile", () => {
    const z = annahmeSeiteZeilen({ ...basis, widerrufHinweis: null }).join("\n");
    expect(z).not.toContain("Widerruf");
  });
});

describe("baueVertragsmappe", () => {
  it("KV-Seiten plus Annahme-Seite plus AGB-Anhang auf eigener Seite, gültiges PDF", async () => {
    const out = await baueVertragsmappe(await miniKv(2), basis);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(4);
    expect(Buffer.from(out.subarray(0, 5)).toString()).toBe("%PDF-");
  });
  it("ohne AGB-Text nur KV plus Annahme-Seite", async () => {
    const out = await baueVertragsmappe(await miniKv(1), { ...basis, agbText: null, agbTextSha256: null });
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
  });
  it("gezeichnete Unterschrift als PNG wird eingebettet", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    const out = await baueVertragsmappe(await miniKv(1), { ...basis, unterschrift: { ...basis.unterschrift, art: "gezeichnet", bildPng: new Uint8Array(png) } });
    expect((await PDFDocument.load(out)).getPageCount()).toBe(3);
  });
  it("Umlaute und Sonderzeichen werfen nicht", async () => {
    const out = await baueVertragsmappe(await miniKv(1), { ...basis, kunde: "Jürgen Ößlér", agbText: "Größe – „Test“ ✓" });
    expect((await PDFDocument.load(out)).getPageCount()).toBe(3);
  });
});
