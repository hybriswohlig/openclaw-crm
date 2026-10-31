import { inflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDocumentModel } from "./model";
import { renderHtml } from "./html";
import { renderPdf } from "./pdf";
import type { DealFacts, QuotationPriceSource, RenderInput } from "./types";

const deal: DealFacts = {
  firma: "kottke",
  customerName: "Erika Hennig",
  familyName: "Hennig",
  givenName: "Erika",
  customerAddress: "Gartenstr. 4, 72202 Nagold",
  fromAddress: "Gartenstr. 4, 72202 Nagold",
  toAddress: "Gartenstr. 4, 72202 Nagold",
  serviceDate: "2026-10-28",
  documentDate: "2026-10-31",
  invoiceNumber: "RE-2026-014",
  letterhead: { taxNumber: "12345/67890" },
};

function quotation(over: Partial<QuotationPriceSource> = {}): QuotationPriceSource {
  return {
    isVariable: false,
    fixedPrice: "9999.00",
    lineItems: [],
    depositRequiredCents: null,
    paymentMethodPreference: "card",
    validUntil: null,
    summary: null,
    serviceType: "move",
    ...over,
  };
}

function hennig(): RenderInput {
  return {
    kind: "RE",
    deal,
    quotation: quotation(),
    options: {
      allowCard: false,
      dueDate: "sofort",
      invoiceNumber: "RE-2026-014",
      lineItems: [
        {
          description: "Inhouse-Umzug 1. OG ins EG",
          workers: 3,
          hours: 4.75,
          rate: 105,
          includesTravel: true,
        },
      ],
      section35a: {
        labourCents: 49875,
        serviceAddress: "Gartenstr. 4, 72202 Nagold",
      },
    },
  };
}

function pdfPlainText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  const parts = [raw];
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      parts.push(inflateSync(Buffer.from(match[1], "latin1")).toString("latin1"));
    } catch {
      parts.push(match[1]);
    }
  }
  const joined = parts.join("\n");
  const decoded = [...joined.matchAll(/<([0-9A-Fa-f\s]+)>/g)].map((m) => {
    const clean = m[1].replace(/\s/g, "");
    if (clean.length < 2 || clean.length % 2 !== 0) return "";
    return Buffer.from(clean, "hex").toString("latin1");
  });
  return `${joined}\n${decoded.join("\n")}`;
}

describe("Kottke Rechnung", () => {
  it("prints the hourly line, § 35a, transfer only, and sofort", async () => {
    const model = buildDocumentModel(hennig());
    const html = renderHtml(model);
    const text = pdfPlainText(await renderPdf(model));

    expect(model.positions).toHaveLength(1);
    expect(model.positions[0].title).toBe(
      "Inhouse-Umzug 1. OG ins EG, 3 Mitarbeiter, 4,75 Std. à 105 € inkl. Anfahrt"
    );
    expect(model.positions[0].quantityLabel).toBe("4,75 Std.");
    expect(model.totalCents).toBe(49875);
    expect(model.totalLabel).toContain("498,75");
    expect(html).toContain("Guten Tag Erika Hennig,");
    expect(html).not.toContain("Sehr geehrte/r");
    expect(html).not.toContain("Frau/Herr");
    expect(html).not.toContain("Pauschale");
    expect(html).not.toContain("Umzug von");
    expect(model.paymentMethodLabel).toBe("Überweisung");
    expect(model.paymentTerms).toContain("überweisen");
    expect(model.paymentTerms).toContain("sofort");
    expect(model.paymentTerms).not.toContain("Karte");
    expect(model.paymentTerms).not.toContain("35a");
    expect(html).toContain("Hinweis nach § 35a EStG");
    expect(html).toContain("498,75");
    expect(html).toContain("Leistungsort: Gartenstr. 4, 72202 Nagold");
    expect(html).toContain("nur Zahlungen per Überweisung");
    expect(html.split("§ 19 UStG").length - 1).toBe(1);
    expect(html).not.toContain("19 %");
    expect(html).toContain("Rechnungsnummer");
    expect(html).toContain("RE-2026-014");
    expect(html).toContain("Rechnungsdatum");
    expect(html).toContain("31.10.2026");
    expect(html).toContain("Leistungsdatum");
    expect(html).toContain("28.10.2026");
    expect(html).toContain("DE81 1001 8000 0379 5948 02");
    expect(html).toContain("Steuernummer 12345/67890");
    expect(model.serviceDateCaption).toBe("Leistungsdatum");
    expect(text).toContain("4,75");
    expect(text).toContain("105");
    expect(text).toContain("sofort");
    expect(text).toContain("35a");
    expect(text).not.toContain("Pauschale");
    expect(text).not.toContain("Sehr geehrte/r");

    const sample = process.env.KOTTKE_RE_SAMPLE;
    if (sample) {
      mkdirSync(dirname(sample), { recursive: true });
      writeFileSync(sample, await renderPdf(model));
    }
  });

  it("greets from the salutation and keeps a company on Sie", () => {
    const frau = buildDocumentModel({
      kind: "RE",
      deal: { ...deal, salutation: "frau" },
      quotation: quotation({ paymentMethodPreference: "bank_transfer", fixedPrice: "10.00" }),
    });
    expect(frau.intro[0]).toBe("Sehr geehrte Frau Hennig,");

    const herr = buildDocumentModel({
      kind: "RE",
      deal: { ...deal, customerName: "Max Hennig", familyName: "Hennig", salutation: "herr" },
      quotation: quotation({ paymentMethodPreference: "bank_transfer", fixedPrice: "10.00" }),
    });
    expect(herr.intro[0]).toBe("Sehr geehrter Herr Hennig,");

    const firm = buildDocumentModel({
      kind: "RE",
      deal: {
        ...deal,
        customerName: "Roman Rothe",
        customerCompany: "Sport-Thieme GmbH",
        salutation: "herr",
      },
      quotation: quotation({ paymentMethodPreference: "bank_transfer", fixedPrice: "10.00" }),
    });
    expect(firm.customerName).toBe("Sport-Thieme GmbH, z. Hd. Roman Rothe");
    expect(firm.intro[0]).toBe("Sehr geehrte Damen und Herren,");
    expect(firm.intro.join(" ")).not.toContain("Sehr geehrte/r");
  });

  it("keeps a KV without a due date and without an invoice number", () => {
    const kv = buildDocumentModel({
      kind: "KV",
      deal: { ...deal, firma: "ceylan", letterhead: undefined },
      quotation: quotation({ paymentMethodPreference: "cash", fixedPrice: "10.00" }),
    });
    expect(kv.invoiceNumber).toBeUndefined();
    expect(kv.serviceDateCaption).toBe("Termin");
    expect(kv.paymentTerms ?? "").not.toContain("sofort");
    expect(kv.issuer.displayName).toContain("Ceylan");
    expect(kv.issuer.lines.join(" ")).not.toContain("Steuernummer");
    expect(kv.issuer.bank.iban).toBe("DE93 1001 8000 0601 9731 97");
  });

  it("uses a free due date", () => {
    const dated = buildDocumentModel({
      ...hennig(),
      options: { ...hennig().options, dueDate: "2026-10-31" },
    });
    expect(dated.paymentTerms).toContain("31.10.2026");
    expect(dated.paymentTerms).not.toContain("sofort");
  });
});
