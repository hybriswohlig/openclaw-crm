/**
 * Rules for recording an outbound WhatsApp row.
 *
 * Recording never transmits to WhatsApp. Delivery stays in the bridge
 * `POST /accounts/:id/send` (and the CRM wrappers that call it). Backfill
 * and echo handling only insert a history row.
 */

export type WhatsAppOutboundOrigin = "phone" | "bridge-send" | "backfill";

export interface WhatsAppOutboundPolicy {
  /** Phone-typed messages clear "needs reply". Bridge sends and backfill
   * must not: the composer route and the agent own that flag. */
  clearAiNeedsReply: boolean;
  /** Only a message typed on the linked phone is a human takeover. */
  takeHumanOwnership: boolean;
  /** Backfill must not emit `message.sent` (that event drives live workflows). */
  emitSentEvent: boolean;
  /** Historical rows must not rewind the thread preview. */
  previewOnlyIfNewer: boolean;
  /** Always false. A true value would mean this path can deliver a message. */
  sendsToWhatsApp: false;
}

export function outboundIngestPolicy(
  origin: WhatsAppOutboundOrigin,
): WhatsAppOutboundPolicy {
  if (origin === "phone") {
    return {
      clearAiNeedsReply: true,
      takeHumanOwnership: true,
      emitSentEvent: true,
      previewOnlyIfNewer: false,
      sendsToWhatsApp: false,
    };
  }
  if (origin === "bridge-send") {
    return {
      clearAiNeedsReply: false,
      takeHumanOwnership: false,
      emitSentEvent: true,
      previewOnlyIfNewer: false,
      sendsToWhatsApp: false,
    };
  }
  return {
    clearAiNeedsReply: false,
    takeHumanOwnership: false,
    emitSentEvent: false,
    previewOnlyIfNewer: true,
    sendsToWhatsApp: false,
  };
}

/** Postgres unique-violation, including when a driver wraps it in `cause`. */
export function isWhatsAppMessageConflict(err: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const e = current as { message?: unknown; code?: unknown; cause?: unknown };
    if (e.code === "23505") return true;
    if (
      typeof e.message === "string" &&
      /duplicate key|unique constraint/i.test(e.message)
    ) {
      return true;
    }
    current = e.cause;
  }
  return false;
}

/**
 * Insert a row once. A unique conflict loads the winner instead of failing
 * the caller — the WhatsApp send, if any, already happened upstream.
 */
export async function insertOnce<T>(args: {
  insert: () => Promise<T | null>;
  loadExisting: () => Promise<T | null>;
}): Promise<{ row: T | null; duplicate: boolean }> {
  try {
    const row = await args.insert();
    return { row, duplicate: false };
  } catch (err) {
    if (!isWhatsAppMessageConflict(err)) throw err;
    return { row: await args.loadExisting(), duplicate: true };
  }
}

/**
 * Dedupe identity is the WhatsApp message id scoped to one channel account.
 * The same id on another account (Kottke vs Ceylan) is a different message
 * and must be left alone.
 */
export function isSameAccountMessage(
  stored: { accountId: string; externalMessageId: string },
  incoming: { accountId: string; externalMessageId: string },
): boolean {
  return (
    incoming.externalMessageId.length > 0 &&
    stored.accountId === incoming.accountId &&
    stored.externalMessageId === incoming.externalMessageId
  );
}
