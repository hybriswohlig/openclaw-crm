import { describe, it, expect } from "vitest";
import {
  pickDefaultDealOption,
  resolveSelectedPackageAfterReplace,
  offerAcceptanceBlockReason,
} from "@openclaw-crm/customer-portal-core";

describe("pickDefaultDealOption", () => {
  const options = [
    { id: "basis", isRecommended: false },
    { id: "komfort", isRecommended: true },
    { id: "premium", isRecommended: false },
  ];

  it("keeps a still-valid current selection", () => {
    expect(pickDefaultDealOption(options, "premium")?.id).toBe("premium");
  });

  it("falls back to the recommended option when nothing is selected", () => {
    expect(pickDefaultDealOption(options, null)?.id).toBe("komfort");
  });

  it("falls back to the recommended option when the current id is stale", () => {
    expect(pickDefaultDealOption(options, "deleted-uuid")?.id).toBe("komfort");
  });

  it("falls back to the first option when none is recommended", () => {
    const plain = [
      { id: "a", isRecommended: false },
      { id: "b", isRecommended: false },
    ];
    expect(pickDefaultDealOption(plain, null)?.id).toBe("a");
  });

  it("returns null when there are no options", () => {
    expect(pickDefaultDealOption([], null)).toBeNull();
  });
});

describe("resolveSelectedPackageAfterReplace", () => {
  const inserted = [
    { catalogueSlug: "basis", isRecommended: false },
    { catalogueSlug: "komfort", isRecommended: true },
    { catalogueSlug: "premium", isRecommended: false },
  ];

  it("keeps the customer's previous catalogue slug after a rewrite", () => {
    expect(
      resolveSelectedPackageAfterReplace(inserted, "premium")?.catalogueSlug
    ).toBe("premium");
  });

  it("falls back to recommended when the previous slug is gone", () => {
    expect(
      resolveSelectedPackageAfterReplace(inserted, "old-tier")?.catalogueSlug
    ).toBe("komfort");
  });

  it("falls back to recommended when there was no previous selection", () => {
    expect(
      resolveSelectedPackageAfterReplace(inserted, null)?.catalogueSlug
    ).toBe("komfort");
  });
});

describe("offerAcceptanceBlockReason", () => {
  const dealOptions = [
    { id: "komfort", priceCents: 129000 },
    { id: "premium", priceCents: 189000 },
  ];

  it("blocks accept when per-deal options exist but none is selected", () => {
    expect(
      offerAcceptanceBlockReason({
        dealOptions,
        selectedOptionId: null,
        totalCents: 0,
        isVariable: false,
        hasOpenDateChoice: false,
      })
    ).toBe("option");
  });

  it("blocks accept when the selected option id is stale", () => {
    expect(
      offerAcceptanceBlockReason({
        dealOptions,
        selectedOptionId: "deleted",
        totalCents: 129000,
        isVariable: false,
        hasOpenDateChoice: false,
      })
    ).toBe("option");
  });

  it("blocks a 0 € fixed-price accept even without package options", () => {
    expect(
      offerAcceptanceBlockReason({
        dealOptions: [],
        selectedOptionId: null,
        totalCents: 0,
        isVariable: false,
        hasOpenDateChoice: false,
      })
    ).toBe("zero_price");
  });

  it("blocks when the selected option itself is 0 €", () => {
    expect(
      offerAcceptanceBlockReason({
        dealOptions: [{ id: "empty", priceCents: 0 }],
        selectedOptionId: "empty",
        totalCents: 0,
        isVariable: false,
        hasOpenDateChoice: false,
      })
    ).toBe("zero_price");
  });

  it("blocks when a date still has to be picked", () => {
    expect(
      offerAcceptanceBlockReason({
        dealOptions,
        selectedOptionId: "komfort",
        totalCents: 129000,
        isVariable: false,
        hasOpenDateChoice: true,
      })
    ).toBe("date");
  });

  it("allows a selected option with a real price", () => {
    expect(
      offerAcceptanceBlockReason({
        dealOptions,
        selectedOptionId: "komfort",
        totalCents: 129000,
        isVariable: false,
        hasOpenDateChoice: false,
      })
    ).toBeNull();
  });
});
