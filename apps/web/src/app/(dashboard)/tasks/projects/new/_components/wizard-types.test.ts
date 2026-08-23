import { describe, it, expect } from "vitest";
import {
  clampDuration,
  clampOffset,
  dedupe,
  isBudgetAmountValid,
  isBudgetStepValid,
  offsetToISO,
  phaseEndISO,
} from "./wizard-types";

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

describe("isBudgetAmountValid", () => {
  // I4: this must reject exactly what eurosToCents rejects (I3's German
  // parsing rule), never fall back to a second, weaker parser. A blank
  // field is the one case that is fine.
  it("accepts a blank field as 'kein Budget'", () => {
    expect(isBudgetAmountValid("")).toBe(true);
    expect(isBudgetAmountValid("   ")).toBe(true);
  });

  it("accepts a well-formed German amount", () => {
    expect(isBudgetAmountValid("12.500,00")).toBe(true);
    expect(isBudgetAmountValid("12.500")).toBe(true);
    expect(isBudgetAmountValid("5000")).toBe(true);
  });

  it("accepts the exact amount the old bare-Number() parser used to silently drop", () => {
    // The brief's repro: "12500,00" reviewed fine under the old wizard
    // parser and then created a project with no budget at all, because
    // Number("12500,00") is NaN. It must be accepted (and eurosToCents
    // must turn it into real cents), not silently nulled.
    expect(isBudgetAmountValid("12500,00")).toBe(true);
  });

  it("rejects unparseable input instead of treating it as empty", () => {
    expect(isBudgetAmountValid("abc")).toBe(false);
    expect(isBudgetAmountValid("12,50,00")).toBe(false);
  });
});

describe("isBudgetStepValid", () => {
  it("passes when the frame and every entry are blank or valid", () => {
    expect(
      isBudgetStepValid({
        budgetPlannedEuros: "12.500,00",
        budgetEntries: [
          { id: "1", label: "Agentur", amountEuros: "1.500,00" },
          { id: "2", label: "Ohne Betrag", amountEuros: "" },
        ],
      })
    ).toBe(true);
  });

  it("fails when the budget frame itself does not parse", () => {
    expect(
      isBudgetStepValid({ budgetPlannedEuros: "12500,00,00", budgetEntries: [] })
    ).toBe(false);
  });

  it("fails when any single entry does not parse, even if the frame is fine", () => {
    expect(
      isBudgetStepValid({
        budgetPlannedEuros: "5000",
        budgetEntries: [{ id: "1", label: "Agentur", amountEuros: "abc" }],
      })
    ).toBe(false);
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
