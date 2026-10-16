import { describe, expect, it } from "vitest";
import { buildDocumentModel, priceSourceFromStored, renderHtml } from "@openclaw-crm/document-templates";
import { acceptedPriceFor } from "./commercial-documents";

describe("acceptedPriceFor", () => {
  it("uses the accepted total for an AB and never the snapshot notes", () => {
    const accepted = acceptedPriceFor("AB", {
      isVariable: false,
      fixedPriceCents: 172000,
      totalCents: 189000,
      lineItems: [{ type: "other", description: "Umzug Kern", quantity: 1, unitRate: 1720 }],
      notes: "INTERN-NOTIZ-GEHEIM-4711",
      documentDetails: { kitchen: { notes: "KUECHEN-NOTIZ-INTERN" } },
    });
    expect(accepted?.fixedPrice).toBe("1890.00");
    expect(accepted?.lineItems).toEqual([]);

    const html = renderHtml(
      buildDocumentModel({
        kind: "AB",
        deal: {
          firma: "kottke",
          customerName: "Kyra Heiker",
          documentDate: "2026-10-16",
        },
        quotation: priceSourceFromStored({
          isVariable: false,
          fixedPrice: "10.00",
          lineItems: [],
          depositRequiredCents: 5000,
          paymentMethodPreference: "paypal",
          validUntil: "2026-12-01",
          summary: null,
          serviceType: "clearance",
          notes: "INTERN-NOTIZ-GEHEIM-4711",
        }),
        accepted,
      })
    );
    expect(html).toContain("1.890,00");
    expect(html).toContain("PayPal");
    expect(html).toContain("Entrümpelung");
    expect(html).toContain("50,00");
    expect(html).not.toContain("INTERN-NOTIZ");
    expect(html).not.toContain("KUECHEN-NOTIZ");
    expect(html).not.toContain("10,00");
  });

  it("ignores the snapshot for a KV", () => {
    expect(acceptedPriceFor("KV", { isVariable: false, totalCents: 100, lineItems: [] })).toBeNull();
  });
});
