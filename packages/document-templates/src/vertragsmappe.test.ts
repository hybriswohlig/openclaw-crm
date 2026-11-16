import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { PDFDict, PDFName, PDFRawStream, decodeFromBase64 } from "pdf-lib";
import { KOTTKE_RESTBETRAG_EINSATZ, KOTTKE_RESTBETRAG_UMZUG } from "./restbetrag";
import { annahmeSeiteModell, annahmeSeiteZeilen, fuerSchrift, fussZeilen, passendeGroesse, baueVertragsmappe, umbrechen, type VertragsmappeDaten } from "./vertragsmappe";

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
  marke: { firmaSlug: "kottke", leistung: "move", akzentHex: "c2570c", ansprechpartner: "Dario Kottke", fusszeile: "Kottke Dienstleistungen · Marktstr. 8 · 72218 Wildberg" },
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
    expect(m.rechtstexte).toContain(KOTTKE_RESTBETRAG_UMZUG);
    expect(annahmeSeiteZeilen(basis).join("\n")).toContain(KOTTKE_RESTBETRAG_UMZUG);
    const ceylan = annahmeSeiteModell({ ...basis, marke: { ...basis.marke, firmaSlug: "ceylan" } });
    expect(ceylan.rechtstexte).toContain(KOTTKE_RESTBETRAG_UMZUG);
    const kueche = annahmeSeiteModell({ ...basis, leistung: "Küchenmontage", haftungshinweis: false });
    expect(kueche.rechtstexte).toContain(KOTTKE_RESTBETRAG_EINSATZ);
    expect(kueche.rechtstexte.join("\n")).not.toContain("Umzugstag");
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
      await baueVertragsmappe(await miniKv(2), { ...basis, marke: { firmaSlug: "unbekannt", leistung: null, akzentHex: "3a567f", ansprechpartner: null, fusszeile: null } }),
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

describe("passendeGroesse", () => {
  it("verkleinert den getippten Namen, bis er ins Unterschriftsfeld passt", () => {
    const breiteBei = (size: number) => size * 20; // 20 pt Breite je pt Schriftgröße
    expect(passendeGroesse(breiteBei, 600)).toBe(22);
    expect(passendeGroesse(breiteBei, 260)).toBe(13);
    expect(passendeGroesse(breiteBei, 50)).toBe(10);
  });
});

/** Größe der Bilddaten je Bild auf einer Seite. */
function bildGroessen(doc: PDFDocument, seite: number): number[] {
  const xo = doc.getPage(seite).node.Resources()?.lookup(PDFName.of("XObject"));
  if (!(xo instanceof PDFDict)) return [];
  return xo.keys().flatMap((k) => {
    const o = doc.context.lookup(xo.get(k));
    return o instanceof PDFRawStream && o.dict.get(PDFName.of("Subtype")) === PDFName.of("Image") ? [o.contents.length] : [];
  });
}

describe("Logo der Annahmeseite je Leistung", () => {
  it("nimmt für Entrümpelung ein anderes Logo als für den Umzug", async () => {
    const umzug = await PDFDocument.load(await baueVertragsmappe(await miniKv(1), basis));
    const entr = await PDFDocument.load(await baueVertragsmappe(await miniKv(1), { ...basis, marke: { ...basis.marke, leistung: "clearance" } }));
    expect(bildGroessen(umzug, 1)).toHaveLength(1);
    expect(bildGroessen(entr, 1)).toHaveLength(1);
    expect(bildGroessen(umzug, 1)[0]).not.toBe(bildGroessen(entr, 1)[0]);
  });
});

describe("Zeichen und Fußzeile", () => {
  it("lässt nur Zeichen durch, die die Schrift wirklich hat", async () => {
    const fontkit = (await import("@pdf-lib/fontkit")).default;
    const { INTER_REGULAR } = await import("./marke/schriften");
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const inter = await doc.embedFont(decodeFromBase64(INTER_REGULAR), { subset: true });
    expect(fuerSchrift("Größe – „Test“ €", inter)).toBe("Größe – „Test“ €");
    expect(fuerSchrift("Be­trieb", inter)).toBe("Betrieb");
    expect(fuerSchrift("Haken ✓", inter)).toBe("Haken ?");
  });
  it("bricht die Fußzeile um, statt sie abzuschneiden", () => {
    const umbruch = (t: string) => t.match(/.{1,40}(\s|$)/g)?.map((z) => z.trim()) ?? [];
    const lang = "Kottke Dienstleistungen · Inhaber: Darioush Kottke · Marktstr. 8";
    expect(fussZeilen([lang, "Ihr Ansprechpartner: Dario Kottke"], umbruch).join(" ")).toContain("Marktstr. 8");
    expect(fussZeilen([lang, lang, lang], umbruch)).toHaveLength(3);
  });
});

describe("Plan 5b: Wahl und Stunden-KV in der Mappe", () => {
  const gewaehlt = "Gewählt: Komfort am Donnerstag, 26. November 2026: 1.890,00 €";

  it("Wahl: eine Zeile „Gewählt“ statt Option, Festpreis und Termin", () => {
    const d = { ...basis, optionName: "Komfort", preisCents: 189000, gewaehlt };
    const m = annahmeSeiteModell(d);
    expect(m.eckdaten.map((e) => e.label)).toEqual(["Kunde", "Leistung", "Gewählt", "Von", "Nach"]);
    expect(m.eckdaten[2]).toEqual({ label: "Gewählt", wert: "Komfort am Donnerstag, 26. November 2026: 1.890,00 €", gross: true });
    const zeilen = annahmeSeiteZeilen(d);
    expect(zeilen).toContain(gewaehlt);
    expect(zeilen.some((z) => z.startsWith("Option:") || z.startsWith("Festpreis:") || z.startsWith("Termin:"))).toBe(false);
  });

  it("Wahl nur Paket: der Termin bleibt eine eigene Zeile", () => {
    const d = { ...basis, optionName: "Komfort", gewaehlt: "Gewählt: Komfort: 1.780,00 €" };
    const m = annahmeSeiteModell(d);
    expect(m.eckdaten.map((e) => e.label)).toEqual(["Kunde", "Leistung", "Gewählt", "Termin", "Von", "Nach"]);
    expect(annahmeSeiteZeilen(d)).toContain("Termin: 26. November 2026");
  });

  it("Stunden-KV aus der Version: voraussichtlich mit Mindeststunden (Entscheidung 9)", () => {
    const text = "voraussichtlich 767,50 €, abgerechnet nach Aufwand, mindestens 3 Stunden (435,00 €)";
    const d = { ...basis, voraussichtlich: true, preisCents: 76750, preisAngabe: { label: "Voraussichtlich", wert: "767,50 €", text } };
    const m = annahmeSeiteModell(d);
    expect(m.eckdaten.find((e) => e.gross)).toEqual({ label: "Voraussichtlich", wert: "767,50 €", gross: true });
    expect(m.rechtstexte).toContain("Voraussichtlich 767,50 €, abgerechnet nach Aufwand, mindestens 3 Stunden (435,00 €).");
    expect(m.rechtstexte).toContain("Die Abrechnung erfolgt nach tatsächlichem Aufwand. Verbindlich ist die finale Rechnung.");
    expect(annahmeSeiteZeilen(d)).toContain(
      "Voraussichtlich 767,50 €, abgerechnet nach Aufwand, mindestens 3 Stunden (435,00 €). Die Abrechnung erfolgt nach tatsächlichem Aufwand. Verbindlich ist die finale Rechnung."
    );
  });

  it("alter Stunden-KV: „Stundensatz 95 € je Stunde“ statt „Voraussichtlicher Gesamtbetrag 95 €“ (F11)", () => {
    const d = {
      ...basis,
      voraussichtlich: true,
      preisCents: 9500,
      preisAngabe: { label: "Stundensatz", wert: "95,00 € je Stunde", text: "Stundensatz 95,00 € je Stunde" },
    };
    const m = annahmeSeiteModell(d);
    expect(m.eckdaten.find((e) => e.gross)).toEqual({ label: "Stundensatz", wert: "95,00 € je Stunde", gross: true });
    expect(m.eckdaten.some((e) => e.label === "Voraussichtlich")).toBe(false);
    // Label und Wert sagen schon alles: kein doppelter Satz.
    expect(m.rechtstexte.some((r) => r.startsWith("Stundensatz"))).toBe(false);
    const zeilen = annahmeSeiteZeilen(d).join("\n");
    expect(zeilen).toContain("Stundensatz 95,00 € je Stunde. Die Abrechnung erfolgt nach tatsächlichem Aufwand.");
    expect(zeilen).not.toContain("Voraussichtlicher Gesamtbetrag");
  });

  it("baut die Mappe mit Wahl und mit Stunden ohne Fehler", async () => {
    for (const extra of [
      { gewaehlt },
      { voraussichtlich: true, preisAngabe: { label: "Stundensatz", wert: "95,00 € je Stunde", text: "Stundensatz 95,00 € je Stunde" } },
    ]) {
      const out = await baueVertragsmappe(await miniKv(1), { ...basis, ...extra });
      expect((await PDFDocument.load(out)).getPageCount()).toBe(3);
    }
  });
});
