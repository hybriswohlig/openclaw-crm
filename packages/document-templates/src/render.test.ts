import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildDocumentModel } from "./model";
import { priceSourceFromStored } from "./prices";
import { renderHtml } from "./html";
import { renderPdf } from "./pdf";
import { TEMPLATE_VERSION } from "./version";
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
    expect(TEMPLATE_VERSION).toBe("kv-ab-re/1");
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
