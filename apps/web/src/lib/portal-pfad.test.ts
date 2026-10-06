import { describe, expect, it } from "vitest";
import { istPortalPfad } from "./portal-pfad";

describe("istPortalPfad", () => {
  it("Status-Link und Rechtsseiten sind Portal", () => {
    expect(istPortalPfad("/s/abc123")).toBe(true);
    expect(istPortalPfad("/legal/agb/kottke")).toBe(true);
  });
  it("CRM ist kein Portal", () => {
    expect(istPortalPfad("/inbox")).toBe(false);
    expect(istPortalPfad("/settings")).toBe(false);
    expect(istPortalPfad("/sales")).toBe(false);
  });
});
