// Per-deal send / retry orchestration for the post-move reviews cron
// ([KOT-622] / [KOT-624] §4 / [KOT-736]).
//
// Extracted from the inline block in apps/web/src/app/api/cron/reviews-send
// /route.ts so the retry-once → mark-failed contract from [KOT-624] can be
// unit-tested without standing up a full drizzle/db mock. All persistence
// is passed in via injected callbacks so the test file can assert the
// exact side-effect calls (`onSendSuccess`, `onAttemptIncrement`,
// `onFinalFailure`) the helper made.

import { MessagingSendError, type SendSmsResult } from "@/lib/messaging";

export interface TrySendReviewSmsInput {
  dealId: string;
  phone: string;
  body: string;
  variant: "A" | "B";
  currentAttempts: number;
}

export interface OnSendSuccessArgs {
  dealId: string;
  variant: "A" | "B";
  externalMessageId: string;
  attemptCount: number;
}

export interface OnAttemptIncrementArgs {
  dealId: string;
  attemptCount: number;
}

export interface OnFinalFailureArgs {
  dealId: string;
  attemptCount: number;
}

export interface TrySendReviewSmsDeps {
  sendSms: (phone: string, body: string) => Promise<SendSmsResult>;
  onSendSuccess: (args: OnSendSuccessArgs) => Promise<void>;
  onAttemptIncrement: (args: OnAttemptIncrementArgs) => Promise<void>;
  onFinalFailure: (args: OnFinalFailureArgs) => Promise<void>;
  logger?: Pick<Console, "warn">;
}

export type TrySendReviewSmsOutcome =
  | { outcome: "sent"; externalMessageId: string; attemptCount: number }
  | { outcome: "retry_pending"; attemptCount: number }
  | { outcome: "failed"; attemptCount: number };

// Retry contract ([KOT-624] §4): one network error is tolerated. The first
// throw bumps `attempt_count` to 1 and leaves the deal at `not_due` so the
// next 15-min cron tick (still inside the 24h cap) re-enters here. A second
// throw bumps `attempt_count` to 2 and transitions to `failed` — there is
// no SMS→WhatsApp fallback in Phase 1 (that's [KOT-618] Phase 2).
export async function trySendReviewSms(
  input: TrySendReviewSmsInput,
  deps: TrySendReviewSmsDeps
): Promise<TrySendReviewSmsOutcome> {
  const log = deps.logger ?? console;
  try {
    const sendResult = await deps.sendSms(input.phone, input.body);
    const attemptCount = input.currentAttempts + 1;
    await deps.onSendSuccess({
      dealId: input.dealId,
      variant: input.variant,
      externalMessageId: sendResult.id,
      attemptCount,
    });
    return { outcome: "sent", externalMessageId: sendResult.id, attemptCount };
  } catch (err) {
    const isMessagingErr = err instanceof MessagingSendError;
    log.warn("[cron/reviews-send] send failed", {
      dealId: input.dealId,
      err: isMessagingErr ? err.cause : String(err),
    });
    const attemptCount = input.currentAttempts + 1;
    await deps.onAttemptIncrement({ dealId: input.dealId, attemptCount });
    if (attemptCount >= 2) {
      await deps.onFinalFailure({ dealId: input.dealId, attemptCount });
      return { outcome: "failed", attemptCount };
    }
    return { outcome: "retry_pending", attemptCount };
  }
}
