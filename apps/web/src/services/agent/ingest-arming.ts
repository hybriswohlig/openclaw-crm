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
