// Single source of truth for the employee-ledger money direction.
//
// Saldo (was wir dem Mitarbeiter schulden) = Σ(credits) − Σ(debits)
//   credits: earning (Lohn), reimbursement (Auslage des Mitarbeiters)
//   debits:  payment (Bar/Überweisung), in_kind (Sachbezug, in Waren verrechnet)
//
// Used by both server services and client components so the rule can never
// drift between layers.

export type EmployeeLedgerKind = "earning" | "reimbursement" | "payment" | "in_kind";

/** payment + in_kind lower the Saldo (we settled, in cash or in goods). */
export function isLedgerDebit(kind: EmployeeLedgerKind): boolean {
  return kind === "payment" || kind === "in_kind";
}

/** Signed contribution to the Saldo: credit = +amount, debit = −amount. */
export function ledgerDelta(kind: EmployeeLedgerKind, amount: number): number {
  return isLedgerDebit(kind) ? -amount : amount;
}
