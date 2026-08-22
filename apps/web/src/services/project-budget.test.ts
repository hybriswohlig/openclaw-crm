import { describe, expect, it } from "vitest";
import {
  summarizeBudget,
  resolveBudgetEntryCreate,
  resolveBudgetEntryUpdate,
  type BudgetEntryData,
} from "./project-budget";

function entry(partial: Partial<BudgetEntryData>): BudgetEntryData {
  return {
    id: "e1",
    projectId: "p1",
    label: "Posten",
    amountCents: 0,
    kind: "ist",
    bookedAt: null,
    note: null,
    createdBy: null,
    createdAt: new Date("2026-08-01T00:00:00"),
    ...partial,
  };
}

describe("summarizeBudget", () => {
  it("sums only kind='ist' into the spend, kind='plan' into the breakdown", () => {
    const s = summarizeBudget(10_000_00, [
      entry({ id: "a", kind: "ist", amountCents: 2_500_00 }),
      entry({ id: "b", kind: "ist", amountCents: 1_500_00 }),
      entry({ id: "c", kind: "plan", amountCents: 9_000_00 }),
    ]);
    expect(s.spentCents).toBe(4_000_00);
    expect(s.plannedBreakdownCents).toBe(9_000_00);
    expect(s.plannedCents).toBe(10_000_00);
    expect(s.pct).toBe(40);
    expect(s.entries).toHaveLength(3);
  });

  it("has no percentage without a budget frame", () => {
    const s = summarizeBudget(null, [entry({ kind: "ist", amountCents: 500_00 })]);
    expect(s.pct).toBeNull();
    expect(s.spentCents).toBe(500_00);
  });

  it("reports an overrun above 100 percent", () => {
    const s = summarizeBudget(1_000_00, [entry({ kind: "ist", amountCents: 1_450_00 })]);
    expect(s.pct).toBe(145);
  });

  it("is all zeroes for an empty register", () => {
    const s = summarizeBudget(null, []);
    expect(s).toEqual({
      plannedCents: null,
      spentCents: 0,
      plannedBreakdownCents: 0,
      pct: null,
      entries: [],
    });
  });
});

describe("resolveBudgetEntryCreate", () => {
  it("requires a label", () => {
    expect(resolveBudgetEntryCreate({ amountCents: 100, kind: "ist" })).toEqual({
      ok: false,
      error: "Bezeichnung ist erforderlich.",
    });
  });

  it("requires an integer cent amount", () => {
    expect(resolveBudgetEntryCreate({ label: "Miete", amountCents: 12.5, kind: "ist" })).toEqual({
      ok: false,
      error: "Betrag muss eine ganze Zahl in Cent sein.",
    });
    expect(resolveBudgetEntryCreate({ label: "Miete", amountCents: "1200", kind: "ist" })).toEqual({
      ok: false,
      error: "Betrag muss eine ganze Zahl in Cent sein.",
    });
  });

  it("requires a known kind", () => {
    expect(resolveBudgetEntryCreate({ label: "Miete", amountCents: 1200, kind: "soll" })).toEqual({
      ok: false,
      error: "Ungültige Budget-Art.",
    });
  });

  it("rejects a booked date that is not YYYY-MM-DD", () => {
    expect(
      resolveBudgetEntryCreate({ label: "Miete", amountCents: 1200, kind: "ist", bookedAt: "19.08.2026" }),
    ).toEqual({ ok: false, error: "Datum muss im Format JJJJ-MM-TT angegeben werden." });
  });

  it("accepts a full entry and keeps the booked date as an ISO day string", () => {
    const r = resolveBudgetEntryCreate({
      label: "  Transporter-Miete  ",
      amountCents: 45_000,
      kind: "ist",
      bookedAt: "2026-08-19",
      note: " 3 Tage Sprinter ",
    });
    expect(r).toEqual({
      ok: true,
      values: {
        label: "Transporter-Miete",
        amountCents: 45_000,
        kind: "ist",
        bookedAt: "2026-08-19",
        note: "3 Tage Sprinter",
      },
    });
  });
});

describe("resolveBudgetEntryUpdate", () => {
  it("emits only the sent keys", () => {
    expect(resolveBudgetEntryUpdate({ amountCents: 999 })).toEqual({ ok: true, set: { amountCents: 999 } });
  });
  it("rejects a bad amount", () => {
    expect(resolveBudgetEntryUpdate({ amountCents: null })).toEqual({
      ok: false,
      error: "Betrag muss eine ganze Zahl in Cent sein.",
    });
  });
  it("clears an optional field with null", () => {
    expect(resolveBudgetEntryUpdate({ note: null, bookedAt: null })).toEqual({
      ok: true,
      set: { note: null, bookedAt: null },
    });
  });
  it("rejects a bad booked date on update too", () => {
    expect(resolveBudgetEntryUpdate({ bookedAt: "19.08.2026" })).toEqual({
      ok: false,
      error: "Datum muss im Format JJJJ-MM-TT angegeben werden.",
    });
  });
});
