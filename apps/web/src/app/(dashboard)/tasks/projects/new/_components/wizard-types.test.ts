import { describe, it, expect } from "vitest";
import { clampDuration, clampOffset, dedupe, offsetToISO, phaseEndISO } from "./wizard-types";

// These five functions are thin wrappers over the tested primitives in
// lib/work-metrics.ts (offsetDaysToDate, phaseEndOffset, toIsoDay). Every
// brief for Tasks 26-32 scoped testing to "manuell — Checkliste in Task 32",
// which is defensible for JSX but left the wrappers themselves — including
// the offsetToISO invalid-base fallback — with zero coverage. This file
// closes that gap without moving the functions (low-churn fix; the wizard's
// only other consumer, page.tsx, is unaffected).

describe("offsetToISO", () => {
  it("adds the offset to the start date", () => {
    expect(offsetToISO("2026-08-01", 13)).toBe("2026-08-14");
  });

  it("is the identity at offset 0", () => {
    expect(offsetToISO("2026-08-01", 0)).toBe("2026-08-01");
  });

  it("falls back to the raw start date when it does not parse", () => {
    // base.getTime() is NaN for "not-a-date" — offsetToISO must not throw or
    // return "Invalid Date"; it returns the original string unchanged.
    expect(offsetToISO("not-a-date", 5)).toBe("not-a-date");
  });
});

describe("phaseEndISO", () => {
  it("reproduces the inclusive-end case: a 14-day phase from day 0 ends on day 13", () => {
    // phaseEndOffset(0, 14) === 13 (lib/work-metrics.ts) — a 14-day phase
    // starting on the 1st ends on the 14th, not the 15th.
    expect(phaseEndISO("2026-08-01", 0, 14)).toBe("2026-08-14");
  });

  it("offsets a later-starting phase by the same rule", () => {
    // startOffsetDays=5, durationDays=3 → end offset 5+3-1=7.
    expect(phaseEndISO("2026-08-01", 5, 3)).toBe("2026-08-08");
  });
});

describe("clampOffset", () => {
  it("keeps a positive integer", () => {
    expect(clampOffset(7)).toBe(7);
  });

  it("floors zero to 0", () => {
    expect(clampOffset(0)).toBe(0);
  });

  it("floors a negative value to 0 — offsets before the project start are always a typo", () => {
    expect(clampOffset(-3)).toBe(0);
  });

  it("floors non-numeric input to 0", () => {
    expect(clampOffset("abc")).toBe(0);
    expect(clampOffset(undefined)).toBe(0);
  });

  it("truncates a fractional value", () => {
    expect(clampOffset(4.9)).toBe(4);
  });
});

describe("clampDuration", () => {
  it("keeps a value greater than 1", () => {
    expect(clampDuration(5)).toBe(5);
  });

  it("floors 1 to 1", () => {
    expect(clampDuration(1)).toBe(1);
  });

  it("floors 0 to 1 — a phase is always at least one day", () => {
    expect(clampDuration(0)).toBe(1);
  });

  it("floors a negative value to 1", () => {
    expect(clampDuration(-10)).toBe(1);
  });

  it("floors non-numeric input to 1", () => {
    expect(clampDuration("abc")).toBe(1);
    expect(clampDuration(null)).toBe(1);
  });
});

describe("dedupe", () => {
  it("removes case-insensitive repeats and keeps the first spelling", () => {
    expect(dedupe(["Angebote erstellen", "angebote erstellen", "Angebote ERSTELLEN"])).toEqual([
      "Angebote erstellen",
    ]);
  });

  it("preserves input order for the surviving entries", () => {
    expect(dedupe(["b", "a", "b", "c", "a"])).toEqual(["b", "a", "c"]);
  });

  it("drops blank and whitespace-only entries", () => {
    expect(dedupe(["a", "  ", "", "b"])).toEqual(["a", "b"]);
  });

  it("trims surrounding whitespace from the kept spelling", () => {
    expect(dedupe(["  a  ", "a"])).toEqual(["a"]);
  });

  it("returns an empty array for an empty array", () => {
    expect(dedupe([])).toEqual([]);
  });
});
