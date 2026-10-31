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
  customerName: "Stephanie Hennig",
  familyName: "Hennig",
  givenName: "Stephanie",
  customerAddress: "Amselweg 19, 70839 Gerlingen",
  fromAddress: "Amselweg 19, 70839 Gerlingen",
  toAddress: "Amselweg 19, 70839 Gerlingen",
  serviceDate: "2026-10-31",
  documentDate: "2026-10-31",
  letterhead: { phone: "+49 175 9498475", whatsapp: "+49 175 9498475" },
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
      salutation: "frau",
      invoiceNumber: "RE-KO-20261031-HEN",
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
        serviceAddress: "Amselweg 19, 70839 Gerlingen",
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
    expect(model.displayTitle).toBe("RECHNUNG");
    expect(model.invoiceNumber).toBe("RE-KO-20261031-HEN");
    expect(model.invoiceNumber).not.toMatch(/-2$|-3$/);
    expect(model.dueDateLabel).toBe("sofort");
    expect(model.dueDateStored).toBe("2026-10-31");
    expect(html).toContain("Sehr geehrte Frau Hennig,");
    expect(html).not.toContain("Sehr geehrte/r");
    expect(html).not.toContain("Frau/Herr");
    expect(html).not.toContain("Pauschale");
    expect(html).not.toContain("Umzug von");
    expect(html).not.toContain("9498475");
    expect(html).not.toContain("innerhalb von 7 Tagen");
    expect(html).not.toContain("07.11");
    expect(html).not.toContain("Kartenzahlung nur nach Vereinbarung");
    expect(html).toContain("Kottke-Umzüge");
    expect(html).toContain("RECHNUNG");
    expect(html).toContain("Fälligkeitsdatum");
    expect(html).toContain(">sofort<");
    expect(html).toContain("4,75 Std.");
    expect(html).toContain("kv-ab-re/4");
    expect(html).toContain("0151 59058963");
    expect(html).toContain("07054 9306962");
    expect(model.paymentMethodLabel).toBe("Überweisung");
    expect(model.paymentTerms).toContain("überweisen");
    expect(model.paymentTerms).toContain("sofort");
    expect(model.paymentTerms).not.toContain("Karte");
    expect(model.paymentTerms).not.toContain("35a");
    expect(model.paymentTerms).not.toContain("7 Tagen");
    const pay = html.slice(html.indexOf('class="paybox"'), html.indexOf('class="block35"'));
    expect(pay).not.toContain("35a");
    expect(pay).not.toContain("Kartenzahlung");
    expect(html).toContain("Hinweis nach § 35a EStG");
    expect(html).toContain("498,75");
    expect(html).toContain("Leistungsort: Amselweg 19, 70839 Gerlingen");
    expect(html).toContain("nur Zahlungen per Überweisung");
    expect(html.split("Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.").length - 1).toBe(1);
    expect(html).not.toContain("19 %");
    expect(html).toContain("Rechnungs-Nr.");
    expect(html).toContain("RE-KO-20261031-HEN");
    expect(html).toContain("Rechnungsdatum");
    expect(html).toContain("Leistungsdatum");
    expect(html).toContain("31.10.2026");
    expect(html).toContain("DE81 1001 8000 0379 5948 02");
    expect(model.serviceDateCaption).toBe("Leistungsdatum");
    expect(text).toContain("4,75");
    expect(text).toContain("105");
    expect(text).toContain("sofort");
    expect(text).toContain("35a");
    expect(text).toContain("RECHNUNG");
    expect(text).toContain("RECHNUNGSBETRAG");
    expect(text).not.toContain("Pauschale");
    expect(text).not.toContain("Sehr geehrte/r");
    expect(text).not.toContain("9498475");
    expect(text).not.toContain("Kartenzahlung nur nach Vereinbarung");

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
    expect(dated.dueDateLabel).toBe("31.10.2026");
    expect(dated.dueDateStored).toBe("2026-10-31");
  });

  it("prints a KV in the same shell", async () => {
    const model = buildDocumentModel({
      kind: "KV",
      deal: {
        firma: "kottke",
        customerName: "Stephanie Hennig",
        familyName: "Hennig",
        customerAddress: "Amselweg 19, 70839 Gerlingen",
        serviceDate: "2026-11-06",
        documentDate: "2026-10-31",
      },
      quotation: quotation({
        fixedPrice: "498.75",
        paymentMethodPreference: "bank_transfer",
        validUntil: "2026-11-14",
        lineItems: [],
      }),
      options: { salutation: "frau" },
    });
    const html = renderHtml(model);
    expect(model.displayTitle).toBe("KOSTENVORANSCHLAG");
    expect(model.totalBarLabel).toBe("ANGEBOTSBETRAG");
    expect(html).toContain("ANGEBOTSBETRAG");
    expect(model.infoRows.map((row) => row.label)).toEqual(["Angebots-Nr.", "Datum", "Gültig bis"]);
    expect(html).toContain("KOSTENVORANSCHLAG");
    expect(html).toContain("Gültig bis");
    expect(html).toContain("14.11.2026");
    expect(html).toContain("Sehr geehrte Frau Hennig,");
    expect(html).not.toContain("9498475");
    expect(model.positions).toHaveLength(1);
    expect(model.positions[0].leistung).toBe("Festpreis");
    expect(model.positions[0].beschreibung).toBe("Umzug");
    expect(model.positions[0].quantityLabel).toBe("1");
    expect(model.positions[0].amountCents).toBe(49875);
    expect(html).toContain("<th>Pos.</th>");
    expect(html).toContain("Festpreis");
    expect(html).toContain(">Umzug<");
    const sample = process.env.KOTTKE_KV_SAMPLE;
    if (sample) {
      mkdirSync(dirname(sample), { recursive: true });
      writeFileSync(sample, await renderPdf(model));
    }
  });

  it("prints a Büroumzug KV with Leistungsumfang and a discount above the subtotal", async () => {
    const scope =
      "Büroumzug Festpreis: Transport von 2 großen höhenverstellbaren Schreibtischen, 4 Monitoren, 2 kleinen Aktenschränken, EG nach EG ohne Aufzug, ca. 60 km. Inklusive Einpacken und Auspacken, Abbau und Aufbau.";
    const model = buildDocumentModel({
      kind: "KV",
      deal: {
        firma: "kottke",
        customerName: "Roman Rothe",
        familyName: "Rothe",
        customerCompany: "Sport-Thieme GmbH",
        customerAddress: "Helmstedter Straße 40, 38350 Helmstedt",
        serviceDate: "2026-11-06",
        documentDate: "2026-10-31",
      },
      quotation: quotation({
        fixedPrice: "920.00",
        paymentMethodPreference: "bank_transfer",
        validUntil: "2026-11-14",
        summary: scope,
        lineItems: [
          { type: "other", description: "Büroumzug", quantity: 1, unitRate: "990.00" },
          { type: "other", description: "Rabatt bei Termin Mo–Do", quantity: 1, unitRate: "-70.00" },
        ],
      }),
      service: { title: "Büroumzug" },
    });
    const html = renderHtml(model);
    expect(model.customerName).toBe("Sport-Thieme GmbH, z. Hd. Roman Rothe");
    expect(model.intro[0]).toBe("Sehr geehrte Damen und Herren,");
    expect(model.serviceName).toBe("Büroumzug");
    expect(model.positions).toEqual([
      expect.objectContaining({
        leistung: "Festpreis",
        beschreibung: "Büroumzug",
        quantityLabel: "1",
        amountCents: 99000,
      }),
    ]);
    expect(model.discountLines).toEqual([
      expect.objectContaining({ label: "Rabatt bei Termin Mo–Do", amountCents: -7000 }),
    ]);
    expect(model.totalCents).toBe(92000);
    expect(html).toContain("Leistungsumfang");
    expect(html).toContain("höhenverstellbaren Schreibtischen");
    expect(html).toContain("<th>Pos.</th>");
    expect(html.indexOf("Rabatt bei Termin Mo–Do")).toBeLessThan(html.indexOf("Zwischensumme"));
    expect(html).toContain("920,00");
    expect(html).not.toContain("9498475");
    const sample = process.env.KOTTKE_KV_RABATT_SAMPLE;
    if (sample) {
      mkdirSync(dirname(sample), { recursive: true });
      writeFileSync(sample, await renderPdf(model));
    }
  });
});
