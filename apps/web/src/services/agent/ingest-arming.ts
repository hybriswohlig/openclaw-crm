/**
 * `ai_processed_at` for an inbound message at ingest. A message that does not
 * arm the reply agent (ImmoScout notification mail, STOP reply, non-lead
 * message on a lead thread) counts as processed right away, so the worker's
 * safety net (`wiederAnstossen`) never re-arms it. Armed messages stay null
 * until the worker handles them.
 */
export function aiProcessedAtBeimEingang(armiert: boolean, sentAt: Date): Date | null {
  return armiert ? null : sentAt;
}

/**
 * Agent fields to write on the conversation for an inbound message.
 * `aiLastInboundAt` means "last message the agent should react to": it drives
 * the quiet window and the draft freshness check. Armed messages arm and move
 * it; a STOP disarms and moves it (pending drafts must not go out). Any other
 * un-armed message (door code, auto-reply, IS24 notification) leaves both
 * fields alone, so it neither makes a good draft stale nor disarms a lead
 * message that is still waiting for its turn.
 */
export function agentFelderBeimEingang(opts: {
  armiert: boolean;
  declined: boolean;
  sentAt: Date;
}): { aiNeedsReply?: boolean; aiLastInboundAt?: Date } {
  if (opts.armiert) return { aiNeedsReply: true, aiLastInboundAt: opts.sentAt };
  if (opts.declined) return { aiNeedsReply: false, aiLastInboundAt: opts.sentAt };
  return {};
}
