import { describe, expect, it } from "vitest";
import { portalPreview, portalSperre } from "./portal-preview";

const usable = {
  branding: { displayName: "Kottke Umzüge", primaryColor: "ff8200" },
  dealNumber: "KOT-2026-042",
  customerDisplayName: "Max Mustermann",
  meta: { revoked: false, featureDisabled: false },
} as unknown as Parameters<typeof portalPreview>[0];

describe("portalSperre", () => {
  it("reports revoked before disabled", () => {
    expect(portalSperre({ revoked: true, featureDisabled: true })).toBe("revoked");
  });

  it("reports disabled", () => {
    expect(portalSperre({ revoked: false, featureDisabled: true })).toBe("disabled");
  });

  it("returns null for a usable link", () => {
    expect(portalSperre({ revoked: false, featureDisabled: false })).toBeNull();
  });
});

describe("portalPreview", () => {
  it("is neutral for an unknown token", () => {
    expect(portalPreview(null)).toEqual({
      neutral: true,
      firma: "Auftrag",
      dealNumber: "",
      primaryColor: null,
    });
  });

  it("does not show the customer of a revoked link", () => {
    const p = portalPreview({ ...usable!, meta: { revoked: true, featureDisabled: false } } as never);
    expect(p.neutral).toBe(true);
    expect(p.dealNumber).toBe("");
  });

  it("is neutral when the portal is switched off", () => {
    expect(
      portalPreview({ ...usable!, meta: { revoked: false, featureDisabled: true } } as never).neutral
    ).toBe(true);
  });

  // Die Vorschau sieht jeder, an den der Link weitergeleitet wird (Gruppe,
  // Weiterleitung, Crawler), bevor er geöffnet ist. Der Name bleibt im Portal.
  it("shows firma and deal number but never the customer name", () => {
    expect(portalPreview(usable)).toEqual({
      neutral: false,
      firma: "Kottke Umzüge",
      dealNumber: "KOT-2026-042",
      primaryColor: "ff8200",
    });
  });
});
