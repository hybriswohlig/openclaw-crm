import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assignVariant,
  renderTemplateC,
  renderVariantA,
  renderVariantB,
  resolveDestination,
} from "./templates";

// KOT-624 unit coverage for the variant + template renderer (KOT-616).
// Spec source: KOT-603 §3 (variant arms), KOT-596 §4 (deterministic 50/50
// split), KOT-596 §5 (Variant B requires crew_positive_note, falls back
// to Variant A wording when null).

describe("assignVariant — deterministic 50/50 split", () => {
  it("returns the same value across 1000 calls for the same dealId", () => {
    const first = assignVariant("deal-1234");
    for (let i = 0; i < 1000; i++) {
      expect(assignVariant("deal-1234")).toBe(first);
    }
  });

  it("returns the same value for a different stable dealId across 1000 calls", () => {
    const first = assignVariant("a-different-deal-id");
    for (let i = 0; i < 1000; i++) {
      expect(assignVariant("a-different-deal-id")).toBe(first);
    }
  });

  it("produces both A and B over a representative 500-deal-id corpus (no degenerate hash)", () => {
    const counts: Record<"A" | "B", number> = { A: 0, B: 0 };
    for (let i = 0; i < 500; i++) {
      const variant = assignVariant(`deal-corpus-${i}`);
      counts[variant]++;
    }
    expect(counts.A).toBeGreaterThan(0);
    expect(counts.B).toBeGreaterThan(0);
    // SHA-1 is uniform; tolerate +/- 30% from a 250/250 ideal split.
    expect(counts.A).toBeGreaterThan(150);
    expect(counts.B).toBeGreaterThan(150);
  });

  it("only returns 'A' or 'B'", () => {
    for (let i = 0; i < 50; i++) {
      const variant = assignVariant(`only-ab-${i}`);
      expect(["A", "B"]).toContain(variant);
    }
  });
});

describe("renderVariantB — fallback when crewPositiveNote is null", () => {
  const baseArgs = {
    brand: "kottke" as const,
    firstName: "Anna",
    reviewLink: "https://example.com/r/abc",
  };

  it("falls back to Variant A body when crewPositiveNote is null", () => {
    const a = renderVariantA(baseArgs);
    const bWithNull = renderVariantB({ ...baseArgs, crewPositiveNote: null });
    expect(bWithNull).toBe(a);
  });

  it("falls back to Variant A body when crewPositiveNote is an empty string", () => {
    const a = renderVariantA(baseArgs);
    const bWithEmpty = renderVariantB({ ...baseArgs, crewPositiveNote: "" });
    expect(bWithEmpty).toBe(a);
  });

  it("falls back to Variant A body when crewPositiveNote is whitespace only", () => {
    const a = renderVariantA(baseArgs);
    const bWithSpaces = renderVariantB({ ...baseArgs, crewPositiveNote: "   \n\t" });
    expect(bWithSpaces).toBe(a);
  });

  it("uses the dedicated Variant B body when crewPositiveNote is non-empty", () => {
    const a = renderVariantA(baseArgs);
    const b = renderVariantB({
      ...baseArgs,
      crewPositiveNote: "der Kunde war besonders nett",
    });
    expect(b).not.toBe(a);
    expect(b).toContain("der Kunde war besonders nett");
  });
});

describe("brand-aware sign-off", () => {
  const baseArgs = {
    firstName: "Mehmet",
    reviewLink: "https://example.com/r/x",
  };

  it("Variant A signs off with the Kottke team for the kottke brand", () => {
    const body = renderVariantA({ ...baseArgs, brand: "kottke" });
    expect(body).toContain("Kottke-Team");
    expect(body).not.toContain("Ceylan-Team");
  });

  it("Variant A signs off with the Ceylan team for the ceylan brand", () => {
    const body = renderVariantA({ ...baseArgs, brand: "ceylan" });
    expect(body).toContain("Ceylan-Team");
    expect(body).not.toContain("Kottke-Team");
  });

  it("Template C signs off with the brand team", () => {
    const c = renderTemplateC({ brand: "ceylan", firstName: "Mehmet" });
    expect(c).toContain("Ceylan-Team");
  });
});

describe("STOP opt-out line — required by §7 UWG / DSGVO", () => {
  it("Variant A includes the STOP opt-out line", () => {
    const body = renderVariantA({
      brand: "kottke",
      firstName: "Lara",
      reviewLink: "https://example.com/r/y",
    });
    expect(body).toContain("STOP");
  });

  it("Variant B (with note) includes the STOP opt-out line", () => {
    const body = renderVariantB({
      brand: "kottke",
      firstName: "Lara",
      crewPositiveNote: "Klavier ohne Kratzer in den 3. Stock",
      reviewLink: "https://example.com/r/y",
    });
    expect(body).toContain("STOP");
  });
});

describe("resolveDestination — env-driven URL with fail-loud missing config", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.REVIEWS_GBP_URL_KOTTKE;
    delete process.env.REVIEWS_GBP_URL_CEYLAN;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns the kottke URL when REVIEWS_GBP_URL_KOTTKE is set", () => {
    process.env.REVIEWS_GBP_URL_KOTTKE = "https://g.page/r/kottke";
    expect(resolveDestination("kottke")).toEqual({
      kind: "google_kottke",
      url: "https://g.page/r/kottke",
    });
  });

  it("returns the ceylan URL when REVIEWS_GBP_URL_CEYLAN is set", () => {
    process.env.REVIEWS_GBP_URL_CEYLAN = "https://g.page/r/ceylan";
    expect(resolveDestination("ceylan")).toEqual({
      kind: "google_ceylan",
      url: "https://g.page/r/ceylan",
    });
  });

  it("throws when the brand env var is missing", () => {
    expect(() => resolveDestination("kottke")).toThrow(/REVIEWS_GBP_URL_KOTTKE/);
    expect(() => resolveDestination("ceylan")).toThrow(/REVIEWS_GBP_URL_CEYLAN/);
  });
});
