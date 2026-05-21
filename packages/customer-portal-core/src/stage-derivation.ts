/**
 * deriveStage: pure function that takes minimal portable inputs and returns
 * the stage 1-4 a customer is currently in. The CRM's data adapter populates
 * `StageInputs`; this function never touches the DB.
 *
 * Rules (ordered — first match wins):
 *   Stage 4: invoice exists OR deal moved past completion
 *   Stage 3: today is the move day, or move is in-progress (departureAt set)
 *   Stage 2: order_confirmation PDF exists AND (no Anzahlung required OR Anzahlung met)
 *   Stage 1: default
 *
 * "today is the move day" means: scheduled move date is today or yesterday in
 * Europe/Berlin (to give a buffer for late-finishing jobs).
 */

import type { CustomerLinkStage } from "./types.js";

export interface StageInputs {
  /** PDF "invoice" already uploaded to deal_documents. */
  hasInvoice: boolean;
  /** PDF "order_confirmation" already uploaded to deal_documents. */
  hasOrderConfirmation: boolean;
  /** YYYY-MM-DD or null. */
  moveDate: string | null;
  /** Set when operator clicked "Anfahrt gestartet". */
  departureAt: Date | null;
  /** Set when operator clicked "Auftrag beendet". */
  finishedAt: Date | null;
  /** From quotations.deposit_required_cents. */
  depositRequiredCents: number | null;
  /** Sum of operator-confirmed payments so far (cents). */
  paymentsReceivedCents: number;
  /** True if KVA was accepted by customer (used as a soft floor for stage 2). */
  kvaAccepted: boolean;
  /** Server clock, passed in for testability. */
  now: Date;
}

export function deriveStage(input: StageInputs): CustomerLinkStage {
  if (input.hasInvoice) return 4;
  if (input.finishedAt) return 4;

  if (input.departureAt) return 3;

  if (input.moveDate && isOnMoveDay(input.moveDate, input.now)) return 3;

  if (input.hasOrderConfirmation) {
    if (!depositCleared(input)) return 1;
    return 2;
  }

  return 1;
}

/**
 * Is the move date today (Europe/Berlin) or yesterday? Customer keeps live
 * view active for the entire job-day and the morning after, so they can see
 * final photos rolled in late.
 */
export function isOnMoveDay(moveDateYmd: string, now: Date): boolean {
  // Use Intl to get the date string in Berlin timezone without pulling in
  // a tz library.
  const berlinNow = berlinDateString(now);
  const berlinYesterday = berlinDateString(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  return moveDateYmd === berlinNow || moveDateYmd === berlinYesterday;
}

function depositCleared(input: StageInputs): boolean {
  if (input.depositRequiredCents == null) return true;
  if (input.depositRequiredCents <= 0) return true;
  return input.paymentsReceivedCents >= input.depositRequiredCents;
}

function berlinDateString(d: Date): string {
  // Intl with Europe/Berlin then format as YYYY-MM-DD.
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d); // sv-SE already gives YYYY-MM-DD
}

/**
 * Days until the move (Europe/Berlin midnight to midnight). Negative if the
 * move was in the past. `null` if the move date is unset.
 *
 * Used by the KVA acceptance flow to decide whether the Widerrufs-Verzicht
 * checkbox is mandatory (move starts before the 14-day cool-off ends).
 */
export function daysUntilMove(moveDateYmd: string | null, now: Date): number | null {
  if (!moveDateYmd) return null;
  const todayStr = berlinDateString(now);
  const today = new Date(`${todayStr}T00:00:00Z`);
  const move = new Date(`${moveDateYmd}T00:00:00Z`);
  return Math.round((move.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

export function widerrufVerzichtRequired(moveDateYmd: string | null, now: Date): boolean {
  const d = daysUntilMove(moveDateYmd, now);
  if (d == null) return false;
  return d >= 0 && d < 14;
}
