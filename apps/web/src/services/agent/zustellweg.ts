export type Zustellweg = "ueberspringen" | "entwurf" | "senden";

/**
 * What an agent engine does with a finished customer message.
 *
 * - Human-owned deal (an operator replied, also from the phone): stay out
 *   completely, no draft and no send, until the owner releases the deal.
 * - Dry run (Testlauf): queue a draft for approval, never send.
 * - Live: send directly and queue NOTHING. A queued draft would trigger a
 *   WhatsApp approval request, and approving it would send the text twice.
 */
export function zustellweg(opts: { dryRun: boolean; humanOwned: boolean }): Zustellweg {
  if (opts.humanOwned) return "ueberspringen";
  return opts.dryRun ? "entwurf" : "senden";
}
