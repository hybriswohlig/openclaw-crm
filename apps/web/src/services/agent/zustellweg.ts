export type Zustellweg = "entwurf" | "senden";

/**
 * What an agent engine does with a finished customer message.
 *
 * - Human-owned deal (an operator replied, also from the phone): never send
 *   automatically. A draft with an approval request is still fine — owner
 *   decision ccc542a, approving lifts human_owned for that one send.
 * - Dry run (Testlauf): queue a draft for approval, never send.
 * - Live: send directly and queue NOTHING. A queued draft would trigger a
 *   WhatsApp approval request, and approving it would send the text twice.
 */
export function zustellweg(opts: { dryRun: boolean; humanOwned: boolean }): Zustellweg {
  return opts.dryRun || opts.humanOwned ? "entwurf" : "senden";
}
