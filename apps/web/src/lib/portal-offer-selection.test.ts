import { describe, it, expect } from "vitest";
import {
  pickDefaultDealOption,
  resolveSelectedPackageAfterReplace,
  offerAcceptanceBlockReason,
  resolvePortalOfferView,
  acceptanceMayWritePackageSlug,
  festangebotStatusStep,
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

describe("resolvePortalOfferView", () => {
  it("is festangebot when the quote has a fixed price and no deal options", () => {
    expect(
      resolvePortalOfferView({
        hasOffer: true,
        fixedPriceCents: 85000,
        isVariable: false,
        dealOptionCount: 0,
      })
    ).toBe("festangebot");
  });

  it("stays festangebot when only the company catalogue exists beside the fixed price", () => {
    expect(
      resolvePortalOfferView({
        hasOffer: true,
        fixedPriceCents: 85000,
        isVariable: false,
        dealOptionCount: 0,
      })
    ).toBe("festangebot");
  });

  it("is paketauswahl when deal-specific options exist, even with a fixed price", () => {
    expect(
      resolvePortalOfferView({
        hasOffer: true,
        fixedPriceCents: 85000,
        isVariable: false,
        dealOptionCount: 3,
      })
    ).toBe("paketauswahl");
  });

  it("is paketauswahl when deal options exist and the quotation is not created yet", () => {
    expect(
      resolvePortalOfferView({
        hasOffer: false,
        fixedPriceCents: null,
        isVariable: false,
        dealOptionCount: 1,
      })
    ).toBe("paketauswahl");
  });

  it("is allgemeine_pakete only when no offer exists", () => {
    expect(
      resolvePortalOfferView({
        hasOffer: false,
        fixedPriceCents: null,
        isVariable: false,
        dealOptionCount: 0,
      })
    ).toBe("allgemeine_pakete");
  });

  it("does not fall back to company packages for a variable quotation", () => {
    expect(
      resolvePortalOfferView({
        hasOffer: true,
        fixedPriceCents: null,
        isVariable: true,
        dealOptionCount: 0,
      })
    ).toBe("einzelangebot");
  });

  it("does not treat a zero fixed price as a Festangebot or as company packages", () => {
    expect(
      resolvePortalOfferView({
        hasOffer: true,
        fixedPriceCents: 0,
        isVariable: false,
        dealOptionCount: 0,
      })
    ).toBe("einzelangebot");
  });

  it("ignores a variable flag paired with a stored fixed price", () => {
    expect(
      resolvePortalOfferView({
        hasOffer: true,
        fixedPriceCents: 85000,
        isVariable: true,
        dealOptionCount: 0,
      })
    ).toBe("einzelangebot");
  });
});

describe("acceptanceMayWritePackageSlug", () => {
  it("does not write a package slug when a Festangebot is accepted", () => {
    expect(acceptanceMayWritePackageSlug("festangebot")).toBe(false);
    expect(acceptanceMayWritePackageSlug("allgemeine_pakete")).toBe(false);
    expect(acceptanceMayWritePackageSlug("einzelangebot")).toBe(false);
  });

  it("writes the chosen deal option when the customer is picking packages", () => {
    expect(acceptanceMayWritePackageSlug("paketauswahl")).toBe(true);
  });
});

describe("festangebotStatusStep", () => {
  it("marks the offer while it is not accepted", () => {
    expect(festangebotStatusStep({ accepted: false, stage: 1 })).toBe("angebot");
  });

  it("marks acceptance once the customer has signed and confirmation is still pending", () => {
    expect(festangebotStatusStep({ accepted: true, stage: 1 })).toBe("annahme");
  });

  it("marks confirmation on stage 2 and the move from stage 3", () => {
    expect(festangebotStatusStep({ accepted: true, stage: 2 })).toBe("bestaetigung");
    expect(festangebotStatusStep({ accepted: true, stage: 3 })).toBe("umzug");
    expect(festangebotStatusStep({ accepted: true, stage: 4 })).toBe("umzug");
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
