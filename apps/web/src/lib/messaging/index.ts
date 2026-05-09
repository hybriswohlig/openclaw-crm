// Provider-agnostic outbound messaging interface for the post-move
// reviews engine ([KOT-603] / [KOT-617]). Phase 1 ships SMS only; the
// abstraction is provider-agnostic so Phase 2 ([KOT-618]) can plug in
// the WhatsApp adapter without touching the cron job ([KOT-622]).
//
// Persistence is the caller's job. The cron writes both a `review_events`
// row (engine audit) and an `inbox_messages` row (general audit) — this
// library just hits the wire and returns the external id.

import { sendSmsViaMessageBird } from "./providers/messagebird";

export type MessagingChannel = "sms";

export interface SendSmsResult {
  id: string;
  channel: MessagingChannel;
}

export interface MessagingSendErrorCause {
  provider: string;
  status?: number;
  providerErrorCode?: string | null;
}

export class MessagingSendError extends Error {
  readonly cause: MessagingSendErrorCause;
  constructor(message: string, cause: MessagingSendErrorCause) {
    super(message);
    this.name = "MessagingSendError";
    this.cause = cause;
  }
}

// E.164 validation — at-most-15 digits including country code, leading +.
// Rejects anything looser so we can never send to a malformed number and
// have the provider quietly drop or charge for it.
const E164 = /^\+[1-9]\d{6,14}$/;

export function isE164(phone: string): boolean {
  return E164.test(phone);
}

export interface SendSmsOptions {
  // Override the configured provider for tests / one-offs. In production
  // leave undefined and rely on MESSAGING_PROVIDER env.
  provider?: "messagebird";
}

export async function sendSms(to: string, body: string, opts: SendSmsOptions = {}): Promise<SendSmsResult> {
  if (!isE164(to)) {
    throw new MessagingSendError(`Recipient is not E.164: ${to}`, { provider: "validation" });
  }
  if (body.length === 0) {
    throw new MessagingSendError("SMS body is empty", { provider: "validation" });
  }
  const provider = opts.provider ?? (process.env.MESSAGING_PROVIDER as "messagebird" | undefined) ?? "messagebird";
  if (provider !== "messagebird") {
    throw new MessagingSendError(`Unsupported MESSAGING_PROVIDER: ${provider}`, { provider });
  }
  return sendSmsViaMessageBird(to, body);
}
