import { describe, expect, it } from "vitest";
import { buildDocumentModel, priceSourceFromStored, renderHtml } from "@openclaw-crm/document-templates";
import { acceptedPriceFor, documentAddressForm, documentDueDate, leadTypeFromPayload } from "./commercial-documents";

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

  // K2: Stunden-KV aus der Version. Die AB rechnet wie der KV mit der Schätzung.
  const stundenSnapshot = {
    isVariable: true,
    fixedPriceCents: null,
    totalCents: 76_750,
    calculationVersionId: "ver_1",
    stundenModell: "version",
    stunden: {
      helfer: 2,
      transporter: 1,
      stundenGeschaetzt: 6.5,
      mindestStunden: 3,
      satzHelferEur: 35,
      satzTransporterEur: 25,
      summeGeschaetztCent: 76_750,
      mindestbetragCent: 43_500,
      quelle: "version",
    },
    lineItems: [
      { type: "helper", description: "Helfer", quantity: 2, unitRate: 35, lineTotal: 70 },
      { type: "transporter", description: "Transporter", quantity: 1, unitRate: 25, lineTotal: 25 },
      { type: "other", description: "Halteverbot", quantity: 1, unitRate: 150, lineTotal: 150 },
    ],
  };
  const stundenQuotation = priceSourceFromStored({
    isVariable: true,
    fixedPrice: null,
    lineItems: stundenSnapshot.lineItems.map((l) => ({ type: l.type, description: l.description, quantity: l.quantity, unitRate: l.unitRate.toFixed(2) })),
    depositRequiredCents: null,
    paymentMethodPreference: "cash",
    validUntil: null,
    summary: null,
    serviceType: "move",
    documentDetails: { stunden: stundenSnapshot.stunden },
    calculationVersionId: "ver_1",
  });
  const deal = { firma: "ceylan" as const, customerName: "Kyra Heiker", documentDate: "2026-10-16" };

  it("Stunden-KV aus der Version: KV und AB haben denselben Gesamtbetrag (die Schätzung)", () => {
    const accepted = acceptedPriceFor("AB", stundenSnapshot);
    expect(accepted?.hourly).toMatchObject({ helpers: 2, vans: 1, estimatedTotalCents: 76_750 });
    const kv = buildDocumentModel({ kind: "KV", deal, quotation: stundenQuotation });
    const ab = buildDocumentModel({ kind: "AB", deal, quotation: stundenQuotation, accepted });
    expect(kv.totalCents).toBe(76_750);
    expect(ab.totalCents).toBe(kv.totalCents);
    expect(ab.positions.map((p) => p.quantityLabel)).not.toContain("1 Std.");
  });

  it("Annahme eines alten Stunden-KV (ohne Version) bleibt wie heute", () => {
    const { stunden: _s, stundenModell: _m, calculationVersionId: _v, ...alt } = stundenSnapshot;
    void _s; void _m; void _v;
    for (const snap of [{ ...alt, stundenModell: "alt" }, { ...stundenSnapshot, calculationVersionId: null }]) {
      const accepted = acceptedPriceFor("AB", snap);
      expect(accepted).not.toHaveProperty("hourly");
      expect(buildDocumentModel({ kind: "AB", deal, quotation: stundenQuotation, accepted }).totalCents).toBe(24_500);
    }
  });

  it("ignores the snapshot for a KV", () => {
    expect(acceptedPriceFor("KV", { isVariable: false, totalCents: 100, lineItems: [] })).toBeNull();
  });
});

describe("document address, due date and lead type", () => {
  it("follows the opt-out rule: customer text, else the stored register, else Sie", () => {
    expect(documentAddressForm("Kannst du am Samstag?", { deal: "sie", conversation: "sie" })).toBe("du");
    expect(documentAddressForm("Wir schicken Ihnen die Fotos.", { deal: "du" })).toBe("sie");
    expect(documentAddressForm("Kurze Nachfrage.", { deal: "du" })).toBe("du");
    expect(documentAddressForm("Kurze Nachfrage.", { conversation: "du", deal: "sie" })).toBe("sie");
    expect(documentAddressForm("")).toBe("sie");
    expect(documentAddressForm(null)).toBe("sie");
  });

  it("reads a stored due date and never substitutes the service date", () => {
    expect(documentDueDate("2026-10-13", null)).toBe("2026-10-13");
    expect(documentDueDate(null, "13.10.2026")).toBe("2026-10-13");
    expect(documentDueDate("2026-10-13T00:00:00.000Z", "2026-11-01")).toBe("2026-10-13");
    expect(documentDueDate(undefined, undefined)).toBeUndefined();
    expect(documentDueDate(null, "2026-11-03")).not.toBeUndefined();
  });

  it("reads the lead type from the deal payload", () => {
    expect(leadTypeFromPayload({ leadType: "entruempelung" })).toBe("entruempelung");
    expect(leadTypeFromPayload({ LeadType: "klavier" })).toBe("klavier");
    expect(leadTypeFromPayload('{"leadType":"lager"}')).toBe("lager");
    expect(leadTypeFromPayload(null)).toBeNull();
    expect(leadTypeFromPayload("not-json")).toBeNull();
  });
});
