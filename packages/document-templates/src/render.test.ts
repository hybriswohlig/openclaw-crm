import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildDocumentModel } from "./model";
import { priceSourceFromStored } from "./prices";
import { renderHtml } from "./html";
import { renderPdf } from "./pdf";
import { TEMPLATE_VERSION } from "./version";
import { logoPngFuer } from "./marke/logo-wahl";
import { LOGO_PNG } from "./marke/logos";
import { PDFDict, PDFName, PDFRawStream } from "pdf-lib";
import type { DealFacts, PriceLine, QuotationPriceSource, RenderInput } from "./types";

const NOTES = "INTERN-NOTIZ-GEHEIM-4711";
const ASSUMPTION = "SELBSTKOSTEN-MARGE-NICHT-DRUCKEN";
const OPTION_NOTE = "OPTION-NOTIZ-INTERN";

const deal: DealFacts = {
  firma: "kottke",
  customerName: "Kyra Heiker",
  customerEmail: "kyra@example.com",
  customerAddress: "Marktstr. 1, 72218 Wildberg",
  fromAddress: "Hauptstr. 5, 72202 Nagold",
  toAddress: "Gartenweg 2, 70173 Stuttgart",
  serviceDate: "2026-11-03",
  documentDate: "2026-10-16",
};

function lines(items: Array<[string, number, string, string?]>): PriceLine[] {
  return items.map(([description, quantity, unitRate, type]) => ({
    type: type ?? "other",
    description,
    quantity,
    unitRate,
  }));
}

function quotation(over: Partial<QuotationPriceSource> = {}): QuotationPriceSource {
  return {
    isVariable: false,
    fixedPrice: "1847.65",
    lineItems: [],
    depositRequiredCents: 40000,
    paymentMethodPreference: "cash",
    validUntil: "2026-11-30",
    summary: "Transport einer Waschmaschine inkl. einem Helfer",
    serviceType: "move",
    ...over,
  };
}

async function rendered(input: RenderInput) {
  const model = buildDocumentModel(input);
  const html = renderHtml(model);
  const pdf = await renderPdf(model);
  return { model, html, pdf, text: pdfPlainText(pdf) };
}

function decodePdfHex(hex: string): string {
  const clean = hex.replace(/\s/g, "");
  if (clean.length < 2 || clean.length % 2 !== 0) return "";
  const bytes = Buffer.from(clean, "hex");
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = "";
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    }
    return out;
  }
  return bytes.toString("latin1");
}

/** Inflate streams and decode PDF hex strings (WinAnsi and UTF-16 metadata). */
function pdfPlainText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  const parts = [raw];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (const match of raw.matchAll(re)) {
    try {
      parts.push(inflateSync(Buffer.from(match[1], "latin1")).toString("latin1"));
    } catch {
      parts.push(match[1]);
    }
  }
  const joined = parts.join("\n");
  const decoded = [...joined.matchAll(/<([0-9A-Fa-f\s]+)>/g)].map((m) => decodePdfHex(m[1]));
  return `${joined}\n${decoded.join("\n")}`;
}

describe("quotation mapping", () => {
  it("drops internal notes, assumptions and document details", () => {
    const source = priceSourceFromStored({
      isVariable: false,
      fixedPrice: "1847.65",
      lineItems: lines([["Umzug", 1, "1847.65"]]),
      depositRequiredCents: 40000,
      paymentMethodPreference: "cash",
      validUntil: "2026-11-30",
      summary: "Transport einer Waschmaschine",
      serviceType: "move",
      notes: NOTES,
      calculationAssumptions: { hinweis: ASSUMPTION, selbstkosten: 900 },
      documentDetails: { kitchen: { notes: "KUECHEN-NOTIZ-INTERN" } },
    });
    expect(JSON.stringify(source)).not.toContain(NOTES);
    expect(JSON.stringify(source)).not.toContain(ASSUMPTION);
    expect(JSON.stringify(source)).not.toContain("KUECHEN-NOTIZ-INTERN");
    expect(source.summary).toBe("Transport einer Waschmaschine");
    expect(source.fixedPrice).toBe("1847.65");
    expect(source.depositRequiredCents).toBe(40000);
  });

  it("prices a fixed quotation and ignores a conflicting line and free text", async () => {
    const { model, html, text } = await rendered({
      kind: "KV",
      deal,
      quotation: priceSourceFromStored({
        ...quotation(),
        lineItems: lines([["Falsche Position", 1, "9999.00"]]),
        notes: NOTES,
        calculationAssumptions: { hinweis: ASSUMPTION },
      }),
      copy: {
        intro: "Bitte zahlen Sie 9999 Euro sofort.",
        closing: "Mit freundlichen Grüßen",
        remarks: "Treppenhaus ist eng.",
      },
    });

    expect(model.totalCents).toBe(184765);
    expect(model.totalLabel).toContain("1.847,65");
    expect(model.depositLabel).toContain("400,00");
    expect(model.validUntilLabel).toBe("30.11.2026");
    expect(model.paymentMethodLabel).toBe("Bar");
    expect(model.customerName).toBe("Kyra Heiker");
    expect(model.serviceDateLabel).toBe("03.11.2026");
    expect(html).toContain("Bitte zahlen Sie 9999 Euro sofort.");
    expect(html).toContain("Treppenhaus ist eng.");
    expect(html).not.toContain(NOTES);
    expect(html).not.toContain(ASSUMPTION);
    expect(html).not.toContain("Falsche Position");
    expect(text).not.toContain(NOTES);
    expect(text).not.toContain("Falsche Position");
    expect(text).toContain("1.847,65");
    expect(text).toContain("400,00");
  });

  it("prints positions when they add up to the fixed price", async () => {
    const { model, html } = await rendered({
      kind: "KV",
      deal,
      quotation: quotation({
        fixedPrice: "1720.00",
        lineItems: lines([
          ["Umzug Kern", 1, "1500.00"],
          ["Halteverbot", 2, "110.00"],
        ]),
        depositRequiredCents: 30000,
        paymentMethodPreference: "bank_transfer",
      }),
    });
    expect(model.totalCents).toBe(172000);
    expect(html).toContain("Umzug Kern");
    expect(html).toContain("Halteverbot");
    expect(html).toContain("1.720,00");
    expect(html).toContain("Überweisung");
    expect(html).toContain("DE81 1001 8000 0379 5948 02");
  });

  it("uses the accepted snapshot for an AB and keeps deposit on the quotation", async () => {
    const { model, html } = await rendered({
      kind: "AB",
      deal,
      quotation: quotation({
        fixedPrice: "1847.65",
        notes: NOTES,
      } as QuotationPriceSource),
      accepted: {
        isVariable: false,
        fixedPrice: "1890.00",
        lineItems: [],
      },
    });
    expect(model.totalCents).toBe(189000);
    expect(model.depositLabel).toContain("400,00");
    expect(html).toContain("1.890,00");
    expect(html).not.toContain("1.847,65");
    expect(html).not.toContain(NOTES);
    expect(html).toContain("Auftragsbestätigung");
  });

  it("sums variable line items and does not treat them as a fixed price", async () => {
    const { model, html } = await rendered({
      kind: "RE",
      deal,
      quotation: quotation({
        isVariable: true,
        fixedPrice: null,
        lineItems: lines([
          ["Helfer", 3, "45.00", "helper"],
          ["Transporter", 4, "30.00", "transporter"],
        ]),
        paymentMethodPreference: "card",
      }),
      paidCents: 10000,
    });
    expect(model.totalCents).toBe(25500);
    expect(model.variable).toBe(true);
    expect(html).toContain("Voraussichtlicher Gesamtbetrag");
    expect(html).toContain("255,00");
    expect(html).toContain("Karte");
    expect(html).toContain("100,00");
    expect(model.openLabel).toContain("155,00");
  });

  it("uses a selected package option when the lines disagree", async () => {
    const { model, html } = await rendered({
      kind: "KV",
      deal,
      quotation: quotation({
        fixedPrice: "1720.00",
        lineItems: lines([["Umzug Kern", 1, "1720.00"]]),
      }),
      packageOption: {
        displayName: "Premium",
        priceCents: 189000,
        includedItems: ["Halteverbot inklusive"],
      },
    });
    expect(model.totalCents).toBe(189000);
    expect(html).toContain("Premium");
    expect(html).toContain("Halteverbot inklusive");
    expect(html).not.toContain("Umzug Kern");
    expect(html).not.toContain(OPTION_NOTE);
  });

  it("rejects a quotation with no price", () => {
    expect(() =>
      buildDocumentModel({
        kind: "KV",
        deal,
        quotation: quotation({ fixedPrice: null, lineItems: [], depositRequiredCents: null }),
      })
    ).toThrow(/Kein Preis/);
  });
});

describe("template version", () => {
  it("stamps the version into the HTML and the PDF footer and metadata", async () => {
    const { html, pdf, text } = await rendered({
      kind: "RE",
      deal: { ...deal, firma: "ceylan" },
      quotation: quotation({ paymentMethodPreference: "bank_transfer" }),
    });
    expect(TEMPLATE_VERSION).toBe("kv-ab-re/5");
    expect(html).toContain(`content="${TEMPLATE_VERSION}"`);
    expect(html).toContain(`Vorlage ${TEMPLATE_VERSION}`);
    expect(text).toContain(TEMPLATE_VERSION);
    expect(text).toContain("Ceylan");

    const reloaded = await PDFDocument.load(pdf, { updateMetadata: false });
    expect(reloaded.getKeywords()).toContain(`template:${TEMPLATE_VERSION}`);
    expect(reloaded.getProducer()).toContain(TEMPLATE_VERSION);
    expect(reloaded.getCreator()).toContain(TEMPLATE_VERSION);
  });

  it("escapes free text and still prints German", async () => {
    const { html, text } = await rendered({
      kind: "KV",
      deal,
      quotation: quotation({ summary: "Möbel, größer als die Tür" }),
      copy: { remarks: `<script>alert("x")</script> & "Angebot"` },
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Möbel, größer als die Tür");
    expect(text).toContain("Möbel");
    expect(text).toContain('alert("x")');
  });
});

describe("long company name and discount", () => {
  const longCompany =
    "Sport-Thieme GmbH Internationale Handelsgesellschaft für Sportartikel und Spielwaren mit beschränkter Haftung";

  it("wraps the recipient, prints the discount once and keeps the total on fixedPrice", async () => {
    const { model, html, text } = await rendered({
      kind: "KV",
      deal: {
        ...deal,
        customerName: "Roman Rothe",
        customerCompany: longCompany,
        customerAddress:
          "Sport-Thieme-Allee 1, Gewerbegebiet Helmstedt-Nord, Gebäude C, 38350 Helmstedt, Deutschland",
        addressForm: "du",
        letterhead: { phone: "07054 9306962" },
      },
      quotation: quotation({
        fixedPrice: "920.00",
        depositRequiredCents: null,
        paymentMethodPreference: "bank_transfer",
        summary: `${TAX_SENTENCE} Büroumzug mit Einpackservice. Der Festpreis beträgt dann 920 €.`,
        lineItems: lines([
          ["Büroumzug", 1, "990.00"],
          ["Rabatt bei Termin Mo-Do", 1, "-70.00"],
        ]),
      }),
      service: {
        showStandardInclusions: false,
        title: "Roman Rothe (Sport-Thieme GmbH) Büroumzug",
        mention: "Einpacken und Auspacken, Abbau und Aufbau",
        inventory: true,
      },
    });

    expect(model.totalCents).toBe(92000);
    expect(model.customerName).toContain("z. Hd. Roman Rothe");
    expect(model.addressForm).toBe("sie");
    expect(html).toContain(longCompany);
    expect(html).toContain("Rabatt bei Termin Mo-Do");
    expect(html).toContain("overflow-wrap: anywhere");
    expect(html.split("§ 19 UStG").length - 1).toBe(1);
    expect(html.split("920,00").length - 1).toBe(1);
    expect(html).toContain("Büroumzug mit Einpackservice");
    expect(html).not.toContain("beträgt dann");
    expect(html).not.toContain("9498475");
    expect(html).not.toContain("Keine Kartenzahlung");
    expect(html).not.toContain("vor Auftragsbeginn");

    for (const word of ["Internationale", "Handelsgesellschaft", "Spielwaren", "Helmstedt-Nord", "Roman"]) {
      expect(text).toContain(word);
    }
    expect(model.positions.map((position) => position.amountCents)).toEqual([99000, -7000]);
    expect(text).toContain("Rabatt bei Termin Mo-Do");
    expect(text).toContain("920,00");
    expect(text).toContain("§ 19 UStG");
    expect(text).toContain("07054 9306962");
    expect(text).not.toContain("9498475");
    expect(text).not.toContain("Keine Kartenzahlung");
  });
});

const TAX_SENTENCE = "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.";

/** Anzahl Bilder auf der ersten Seite. */
async function bilderSeite1(pdf: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(pdf);
  const xo = doc.getPage(0).node.Resources()?.lookup(PDFName.of("XObject"));
  if (!(xo instanceof PDFDict)) return 0;
  return xo.keys().filter((k) => {
    const o = doc.context.lookup(xo.get(k));
    return o instanceof PDFRawStream && o.dict.get(PDFName.of("Subtype")) === PDFName.of("Image");
  }).length;
}

describe("Logo im Briefkopf", () => {
  it("wählt das Logo nach Firma und Leistung", () => {
    expect(logoPngFuer("kottke", "move")).toBe(LOGO_PNG["kottke:move"]);
    expect(logoPngFuer("kottke", "clearance")).toBe(LOGO_PNG["kottke:clearance"]);
    expect(logoPngFuer("kottke", "kitchen_installation")).toBe(LOGO_PNG["kottke:kitchen_installation"]);
    expect(logoPngFuer("kottke", null)).toBe(LOGO_PNG.kottke);
    expect(logoPngFuer("ceylan", "move")).toBeNull();
    expect(new Set([LOGO_PNG.kottke, LOGO_PNG["kottke:move"], LOGO_PNG["kottke:clearance"], LOGO_PNG["kottke:kitchen_installation"]]).size).toBe(4);
  });

  it("setzt bei Kottke das Logo in KV, AB und Rechnung, bei Ceylan nicht", async () => {
    for (const kind of ["KV", "AB", "RE"] as const) {
      const { pdf } = await rendered({ kind, deal, quotation: priceSourceFromStored(quotation()) } as RenderInput);
      expect(await bilderSeite1(pdf)).toBe(1);
    }
    const { pdf } = await rendered({ kind: "KV", deal: { ...deal, firma: "ceylan" }, quotation: priceSourceFromStored(quotation()) } as RenderInput);
    expect(await bilderSeite1(pdf)).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Plan 5b: Wählbare Optionen und Stunden-KV (Vorlage kv-ab-re/5)
// ════════════════════════════════════════════════════════════════════════

const ceylan: DealFacts = { ...deal, firma: "ceylan" };
const NOTE_SIE = "Den Preis legen Sie mit Ihrer Wahl im Kundenportal fest.";
const NOTE_DU = "Den Preis legst du mit deiner Wahl im Kundenportal fest.";

/** Komfort am Sa 21.11.: Kern 1.500 € plus Halteverbot 150 € plus Montage 240 €. */
const komfortSamstag = lines([
  ["Umzug Kern", 1, "1500.00"],
  ["Halteverbot", 1, "150.00"],
  ["Montage", 1, "240.00"],
]);

const paketeTage = {
  packages: [
    { slug: "basis", name: "Basis" },
    { slug: "komfort", name: "Komfort" },
    { slug: "premium", name: "Premium" },
  ],
  days: ["2026-11-20", "2026-11-21"],
  prices: [
    { packageSlug: "basis", date: "2026-11-20", priceCents: 140000 },
    { packageSlug: "komfort", date: "2026-11-20", priceCents: 178000 },
    { packageSlug: "premium", date: "2026-11-20", priceCents: 221000 },
    { packageSlug: "basis", date: "2026-11-21", priceCents: 150000 },
    { packageSlug: "komfort", date: "2026-11-21", priceCents: 189000 },
    { packageSlug: "premium", date: "2026-11-21", priceCents: 234000 },
  ],
  current: { packageSlug: "komfort", date: "2026-11-21" },
};

describe("Wählbare Optionen (kv-ab-re/5)", () => {
  it("Pakete × Tage: Posten der Wahl wie heute, Tabelle mit allen Kundenpreisen, Satz in Sie", async () => {
    const { model, html, text } = await rendered({
      kind: "KV",
      deal: ceylan,
      quotation: quotation({ fixedPrice: "1890.00", lineItems: komfortSamstag, depositRequiredCents: 30000 }),
      packageOption: { displayName: "Komfort", priceCents: 189000, includedItems: ["Halteverbot"] },
      choices: paketeTage,
    });
    expect(model.totalCents).toBe(189000);
    expect(model.positions.map((p) => p.title)).toEqual(["Umzug Kern", "Halteverbot", "Montage"]);
    expect(model.offerLabel).toBe("Preis für Komfort am Sa., 21.11.2026");
    expect(model.choices?.layout).toBe("table");
    expect(model.choices?.header).toEqual(["Termin", "Basis", "Komfort", "Premium"]);
    expect(model.choices?.rows.map((r) => r.label)).toEqual(["Fr., 20.11.2026", "Sa., 21.11.2026"]);
    expect(model.choices?.rows[1].cells.map((c) => [c.label.replace(/\s/g, " "), c.current])).toEqual([
      ["1.500,00 €", false],
      ["1.890,00 €", true],
      ["2.340,00 €", false],
    ]);
    expect(model.choices?.note).toBe(NOTE_SIE);
    expect(html).toContain("Wählbare Optionen");
    expect(html).toContain(NOTE_SIE);
    expect(html).toContain('<td class="num current"><strong>1.890,00');
    for (const s of ["Wählbare Optionen", "Sa., 21.11.2026", "Fr., 20.11.2026", "2.210,00", "1.400,00", "Premium", NOTE_SIE]) {
      expect(text).toContain(s);
    }
    expect(text).toContain("Preis für Komfort am Sa., 21.11.2026");
  });

  it("du-Anrede: der Satz folgt addressForm", async () => {
    const { model, html } = await rendered({
      kind: "KV",
      deal: { ...ceylan, addressForm: "du", givenName: "Kyra" },
      quotation: quotation({ fixedPrice: "1890.00", lineItems: komfortSamstag }),
      choices: paketeTage,
    });
    expect(model.choices?.note).toBe(NOTE_DU);
    expect(html).toContain(NOTE_DU);
    expect(html).not.toContain(NOTE_SIE);
  });

  it("nur Tage: Liste Termin und Preis", async () => {
    const { model, text } = await rendered({
      kind: "KV",
      deal: ceylan,
      quotation: quotation({ fixedPrice: "1650.00", lineItems: lines([["Umzug", 1, "1650.00"]]) }),
      choices: {
        packages: [],
        days: ["2026-11-19", "2026-11-21", "2026-11-23"],
        prices: [
          { packageSlug: null, date: "2026-11-19", priceCents: 155000 },
          { packageSlug: null, date: "2026-11-21", priceCents: 165000 },
          { packageSlug: null, date: "2026-11-23", priceCents: 149000 },
        ],
        current: { packageSlug: null, date: "2026-11-21" },
      },
    });
    expect(model.choices?.layout).toBe("list");
    expect(model.choices?.header).toEqual(["Termin", "Preis"]);
    expect(model.choices?.rows.map((r) => r.label)).toEqual(["Do., 19.11.2026", "Sa., 21.11.2026", "Mo., 23.11.2026"]);
    expect(model.choices?.rows.map((r) => r.cells[0].current)).toEqual([false, true, false]);
    expect(model.offerLabel).toBe("Preis am Sa., 21.11.2026");
    expect(text).toContain("1.490,00");
    expect(text).toContain(NOTE_SIE);
  });

  it("nur Pakete: Liste Paket und Preis", async () => {
    const { model } = await rendered({
      kind: "KV",
      deal: ceylan,
      quotation: quotation({ fixedPrice: "1890.00", lineItems: komfortSamstag }),
      packageOption: { displayName: "Komfort", priceCents: 189000, includedItems: [] },
      choices: {
        packages: paketeTage.packages,
        days: [],
        prices: [
          { packageSlug: "basis", date: null, priceCents: 150000 },
          { packageSlug: "komfort", date: null, priceCents: 189000 },
          { packageSlug: "premium", date: null, priceCents: null },
        ],
        current: { packageSlug: "komfort", date: null },
      },
    });
    expect(model.choices?.header).toEqual(["Paket", "Preis"]);
    // Premium hat keinen Preis und erscheint nicht.
    expect(model.choices?.rows.map((r) => r.label)).toEqual(["Basis", "Komfort"]);
    expect(model.offerLabel).toBe("Preis für Komfort");
  });

  it("nimmt die Posten der Wahl aus der Version, wenn die der Quotation den Preis nicht ergeben", async () => {
    const { model } = await rendered({
      kind: "KV",
      deal: ceylan,
      quotation: quotation({ fixedPrice: "1890.00", lineItems: lines([["Umzug Kern", 1, "1720.00"]]) }),
      packageOption: { displayName: "Komfort", priceCents: 189000, includedItems: ["Halteverbot"] },
      choices: { ...paketeTage, currentLines: komfortSamstag },
    });
    expect(model.positions.map((p) => p.amountCents)).toEqual([150000, 15000, 24000]);
    expect(model.scopeLines).toEqual([]);
  });

  it("eine einzige Wahl: kein Block, keine Überschrift", async () => {
    const { model, html, text } = await rendered({
      kind: "KV",
      deal: ceylan,
      quotation: quotation({ fixedPrice: "1890.00", lineItems: komfortSamstag }),
      choices: {
        packages: [{ slug: "komfort", name: "Komfort" }],
        days: ["2026-11-21"],
        prices: [{ packageSlug: "komfort", date: "2026-11-21", priceCents: 189000 }],
        current: { packageSlug: "komfort", date: "2026-11-21" },
      },
    });
    expect(model.choices).toBeUndefined();
    expect(model.offerLabel).toBeUndefined();
    expect(html).not.toContain("Wählbare Optionen");
    expect(text).not.toContain("Kundenportal fest");
  });

  it("kein Block, wenn der Preis oben keiner der Wahlen entspricht", async () => {
    const { model } = await rendered({
      kind: "KV",
      deal: ceylan,
      quotation: quotation({ fixedPrice: "1999.00", lineItems: [] }),
      choices: paketeTage,
    });
    expect(model.totalCents).toBe(199900);
    expect(model.choices).toBeUndefined();
  });

  it("AB und Rechnung zeigen keine Wahl", async () => {
    for (const kind of ["AB", "RE"] as const) {
      const { model, html } = await rendered({
        kind,
        deal: ceylan,
        quotation: quotation({ fixedPrice: "1890.00", lineItems: komfortSamstag }),
        accepted: kind === "AB" ? { isVariable: false, fixedPrice: "1890.00", lineItems: komfortSamstag } : null,
        choices: paketeTage,
      });
      expect(model.choices).toBeUndefined();
      expect(html).not.toContain("Wählbare Optionen");
    }
  });
});

const STUNDEN = {
  helfer: 2,
  transporter: 1,
  stundenGeschaetzt: 6.5,
  mindestStunden: 3,
  satzHelferEur: 35,
  satzTransporterEur: 25,
  // 95 €/h × 6,5 h = 617,50 € plus Halteverbot 150 €
  summeGeschaetztCent: 76750,
  // 95 €/h × 3 h = 285 € plus Halteverbot 150 €
  mindestbetragCent: 43500,
  quelle: "version" as const,
};

function stundenAngebot(details: unknown) {
  return priceSourceFromStored({
    isVariable: true,
    fixedPrice: null,
    lineItems: lines([
      ["Helfer", 2, "35.00", "helper"],
      ["Transporter", 1, "25.00", "transporter"],
      ["Halteverbot", 1, "150.00", "other"],
    ]),
    depositRequiredCents: null,
    paymentMethodPreference: "cash",
    validUntil: "2026-11-30",
    summary: null,
    serviceType: "move",
    documentDetails: details,
  });
}

describe("Stunden-KV aus der Version (kv-ab-re/5)", () => {
  it("zeigt Stundensätze, Schätzung, Mindeststunden und den voraussichtlichen Betrag", async () => {
    const { model, html, text } = await rendered({
      kind: "KV",
      deal: ceylan,
      quotation: stundenAngebot({ stunden: STUNDEN, kitchen: { notes: "KUECHEN-NOTIZ-INTERN" } }),
    });
    expect(model.variable).toBe(true);
    expect(model.totalCents).toBe(76750);
    expect(model.totalCaption).toBe("Voraussichtlicher Gesamtbetrag");
    expect(model.hourly?.rates.map((r) => [r.title, r.quantityLabel])).toEqual([
      ["Helfer", "2 Pers."],
      ["Transporter", "1"],
    ]);
    expect(model.hourly?.perHourLabel.replace(/\s/g, " ")).toBe("95,00 €");
    expect(model.positions.map((p) => [p.title, p.quantityLabel, p.amountCents])).toEqual([
      ["Geschätzter Aufwand", "6,5 Std.", 61750],
      ["Halteverbot", "1", 15000],
    ]);
    expect(model.positions.reduce((s, p) => s + p.amountCents, 0)).toBe(model.totalCents);
    expect(model.hourly?.minimumSentence.replace(/\s/g, " ")).toBe(
      "Abgerechnet wird nach Aufwand, mindestens 3 Stunden (435,00 €)."
    );
    expect(model.choices).toBeUndefined();
    for (const s of ["Stundensatz gesamt", "Satz je Std.", "Geschätzter Aufwand", "767,50", "617,50", "435,00", "mindestens 3 Stunden"]) {
      expect(text).toContain(s);
      expect(html).toContain(s);
    }
    expect(html).not.toContain("KUECHEN-NOTIZ-INTERN");
    expect(text).not.toContain("KUECHEN-NOTIZ-INTERN");
  });

  it("ein Stunden-KV ohne Angaben aus der Version bleibt wie heute", async () => {
    for (const details of [null, {}, { stunden: { ...STUNDEN, quelle: "alt" } }, { stunden: { ...STUNDEN, helfer: "2" } }]) {
      const { model } = await rendered({ kind: "KV", deal: ceylan, quotation: stundenAngebot(details) });
      expect(model.hourly).toBeUndefined();
      // Heute: Summe der Posten (Stundensatz plus Halteverbot).
      expect(model.totalCents).toBe(24500);
      expect(model.positions).toHaveLength(3);
    }
  });

  it("verweigert ein PDF, wenn Stunden und Posten nicht zusammenpassen", () => {
    expect(() =>
      buildDocumentModel({
        kind: "KV",
        deal: ceylan,
        quotation: stundenAngebot({ stunden: { ...STUNDEN, summeGeschaetztCent: 80000 } }),
      })
    ).toThrow(/Stundenangaben passen nicht/);
  });

  it("Rechnung und AB nutzen die Stundenangaben nicht", async () => {
    const { model } = await rendered({ kind: "RE", deal: ceylan, quotation: stundenAngebot({ stunden: STUNDEN }) });
    expect(model.hourly).toBeUndefined();
    expect(model.totalCents).toBe(24500);
  });
});
