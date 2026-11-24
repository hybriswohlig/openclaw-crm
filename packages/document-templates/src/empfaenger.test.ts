import { describe, expect, it } from "vitest";
import { buildDocumentModel } from "./model";
import { renderHtml } from "./html";
import type { DealFacts, QuotationPriceSource, RenderInput } from "./types";

const deal: DealFacts = {
  firma: "kottke",
  customerName: "Angela Hermann",
  customerAddress: "Gartenstr. 1, 72218 Wildberg",
  fromAddress: "Neuweiler",
  serviceDate: "2026-12-28",
  documentDate: "2026-11-24",
  givenName: "Angela",
  addressForm: "sie",
  letterSalutation: "frau",
  representedByLine: "vertreten durch Elisabeth Bath (gesetzliche Betreuerin)",
};

const quotation: QuotationPriceSource = {
  isVariable: false,
  fixedPrice: "890.00",
  lineItems: [{ type: "other", description: "Entrümpelung", quantity: 1, unitRate: "890.00" }],
  depositRequiredCents: null,
  paymentMethodPreference: "bank_transfer",
  validUntil: "2026-12-20",
  summary: null,
  serviceType: "clearance",
};

describe("Auftraggeber auf dem Dokument", () => {
  it("nennt Angela Hermann und vertreten durch, siezt mit Frau", () => {
    const input: RenderInput = { kind: "KV", deal, quotation };
    const model = buildDocumentModel(input);
    const html = renderHtml(model);
    expect(model.recipientLines[0]).toBe("Angela Hermann");
    expect(model.recipientLines[1]).toBe("vertreten durch Elisabeth Bath (gesetzliche Betreuerin)");
    expect(model.intro[0]).toBe("Sehr geehrte Frau Hermann,");
    expect(html).toContain("vertreten durch Elisabeth Bath (gesetzliche Betreuerin)");
    expect(html).toContain("Sehr geehrte Frau Hermann,");
    expect(html).not.toContain("Elisabeth Bath,");
  });
});
