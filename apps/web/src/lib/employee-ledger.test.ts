import { describe, it, expect } from "vitest";
import { isLedgerDebit, ledgerDelta, type EmployeeLedgerKind } from "./employee-ledger";

describe("employee-ledger money direction", () => {
  it("treats earning and reimbursement as credits (raise the Saldo)", () => {
    expect(isLedgerDebit("earning")).toBe(false);
    expect(isLedgerDebit("reimbursement")).toBe(false);
    expect(ledgerDelta("earning", 100)).toBe(100);
    expect(ledgerDelta("reimbursement", 50)).toBe(50);
  });

  it("treats payment and in_kind as debits (lower the Saldo)", () => {
    expect(isLedgerDebit("payment")).toBe(true);
    expect(isLedgerDebit("in_kind")).toBe(true);
    expect(ledgerDelta("payment", 100)).toBe(-100);
    expect(ledgerDelta("in_kind", 80)).toBe(-80);
  });

  it("computes a Saldo as the sum of signed deltas", () => {
    // earned 1000, paid 300 cash, gave 80 in goods (Sachbezug) → owe 620.
    const entries: Array<{ kind: EmployeeLedgerKind; amount: number }> = [
      { kind: "earning", amount: 1000 },
      { kind: "payment", amount: 300 },
      { kind: "in_kind", amount: 80 },
    ];
    const saldo = entries.reduce((s, e) => s + ledgerDelta(e.kind, e.amount), 0);
    expect(saldo).toBe(620);
  });

  it("goes negative when the employee is overpaid (Vorschuss)", () => {
    // paid 200 before any earning → we are 200 ahead (overpaid).
    const saldo = ledgerDelta("payment", 200);
    expect(saldo).toBe(-200);
  });
});
