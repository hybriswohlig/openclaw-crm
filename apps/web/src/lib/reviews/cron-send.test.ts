import { describe, expect, it, vi } from "vitest";
import { trySendReviewSms, type TrySendReviewSmsDeps } from "./cron-send";
import { MessagingSendError } from "../messaging";

// KOT-736 / KOT-624 §4 — retry-once → mark failed contract.
//
// The helper extracts the per-deal send/retry block from the cron at
// apps/web/src/app/api/cron/reviews-send/route.ts. Side effects flow
// through the four injected callbacks so we can assert exactly which
// transitions fired without standing up a drizzle/db mock:
//
//   - onSendSuccess        — wired to stampSendSuccess (status=sent_sms,
//                             review_events.sent_sms row with variant +
//                             external_message_id, attempt_count++).
//   - onAttemptIncrement   — wired to upsertNumberValue(attempts_attr).
//   - onFinalFailure       — wired to markFailed (status=failed +
//                             review_events.failed row).
//
// "review_events.failed row exists" in the spec is therefore equivalent
// to "onFinalFailure was called once" in this layer, because markFailed
// in route.ts is the one that writes that row.

function makeDeps(overrides: Partial<TrySendReviewSmsDeps> = {}): TrySendReviewSmsDeps {
  return {
    sendSms: vi.fn(async () => ({ id: "msg_default", channel: "sms" as const })),
    onSendSuccess: vi.fn(async () => undefined),
    onAttemptIncrement: vi.fn(async () => undefined),
    onFinalFailure: vi.fn(async () => undefined),
    logger: { warn: vi.fn() },
    ...overrides,
  };
}

describe("trySendReviewSms — success path", () => {
  it("stamps sent_sms with external_message_id + variant and bumps attempt_count from 0 to 1", async () => {
    const deps = makeDeps({
      sendSms: vi.fn(async () => ({ id: "mb_abc123", channel: "sms" as const })),
    });

    const outcome = await trySendReviewSms(
      {
        dealId: "deal-1",
        phone: "+491701234567",
        body: "Hi Anna, danke für Ihren Umzug...",
        variant: "A",
        currentAttempts: 0,
      },
      deps
    );

    expect(outcome).toEqual({
      outcome: "sent",
      externalMessageId: "mb_abc123",
      attemptCount: 1,
    });
    expect(deps.sendSms).toHaveBeenCalledOnce();
    expect(deps.sendSms).toHaveBeenCalledWith(
      "+491701234567",
      "Hi Anna, danke für Ihren Umzug..."
    );
    expect(deps.onSendSuccess).toHaveBeenCalledOnce();
    expect(deps.onSendSuccess).toHaveBeenCalledWith({
      dealId: "deal-1",
      variant: "A",
      externalMessageId: "mb_abc123",
      attemptCount: 1,
    });
    expect(deps.onAttemptIncrement).not.toHaveBeenCalled();
    expect(deps.onFinalFailure).not.toHaveBeenCalled();
  });

  it("propagates variant B through to onSendSuccess (variant arg in review_events.sent_sms)", async () => {
    const deps = makeDeps({
      sendSms: vi.fn(async () => ({ id: "mb_variant_b", channel: "sms" as const })),
    });

    await trySendReviewSms(
      {
        dealId: "deal-2",
        phone: "+491701234567",
        body: "...",
        variant: "B",
        currentAttempts: 0,
      },
      deps
    );

    expect(deps.onSendSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "B", externalMessageId: "mb_variant_b" })
    );
  });

  it("on success after a prior failed attempt, attempt_count becomes 2", async () => {
    // Realistic: the first cron tick failed (currentAttempts is now 1
    // in the DB), the second tick re-enters here and succeeds. The
    // total send count we stamp must reflect the cumulative attempts.
    const deps = makeDeps({
      sendSms: vi.fn(async () => ({ id: "mb_retry_ok", channel: "sms" as const })),
    });

    const outcome = await trySendReviewSms(
      {
        dealId: "deal-3",
        phone: "+491701234567",
        body: "...",
        variant: "A",
        currentAttempts: 1,
      },
      deps
    );

    expect(outcome).toEqual({
      outcome: "sent",
      externalMessageId: "mb_retry_ok",
      attemptCount: 2,
    });
    expect(deps.onSendSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ attemptCount: 2 })
    );
  });
});

describe("trySendReviewSms — first failure leaves status not_due", () => {
  it("MessagingSendError on attempt 1 increments attempts to 1 and does NOT call onFinalFailure", async () => {
    const networkErr = new MessagingSendError("connect ETIMEDOUT", {
      provider: "messagebird",
      status: undefined,
      providerErrorCode: null,
    });
    const deps = makeDeps({
      sendSms: vi.fn(async () => {
        throw networkErr;
      }),
    });

    const outcome = await trySendReviewSms(
      {
        dealId: "deal-4",
        phone: "+491701234567",
        body: "...",
        variant: "A",
        currentAttempts: 0,
      },
      deps
    );

    expect(outcome).toEqual({ outcome: "retry_pending", attemptCount: 1 });
    expect(deps.onAttemptIncrement).toHaveBeenCalledOnce();
    expect(deps.onAttemptIncrement).toHaveBeenCalledWith({
      dealId: "deal-4",
      attemptCount: 1,
    });
    expect(deps.onSendSuccess).not.toHaveBeenCalled();
    expect(deps.onFinalFailure).not.toHaveBeenCalled();
  });

  it("also tolerates a plain Error (not just MessagingSendError) on attempt 1", async () => {
    // The catch block was originally narrowed only to MessagingSendError
    // for the log shape. The retry decision must NOT depend on the error
    // type — any throw should bump the counter and let the next tick re-try.
    const deps = makeDeps({
      sendSms: vi.fn(async () => {
        throw new Error("socket hang up");
      }),
    });

    const outcome = await trySendReviewSms(
      {
        dealId: "deal-4b",
        phone: "+491701234567",
        body: "...",
        variant: "A",
        currentAttempts: 0,
      },
      deps
    );

    expect(outcome).toEqual({ outcome: "retry_pending", attemptCount: 1 });
    expect(deps.onAttemptIncrement).toHaveBeenCalledOnce();
    expect(deps.onFinalFailure).not.toHaveBeenCalled();
  });

  it("logs the messagebird cause shape on a MessagingSendError (audit-trail readability)", async () => {
    const warn = vi.fn();
    const cause = {
      provider: "messagebird",
      status: 502,
      providerErrorCode: "upstream_timeout",
    };
    const deps = makeDeps({
      sendSms: vi.fn(async () => {
        throw new MessagingSendError("bad gateway", cause);
      }),
      logger: { warn },
    });

    await trySendReviewSms(
      {
        dealId: "deal-4c",
        phone: "+491701234567",
        body: "...",
        variant: "A",
        currentAttempts: 0,
      },
      deps
    );

    expect(warn).toHaveBeenCalledWith(
      "[cron/reviews-send] send failed",
      expect.objectContaining({ dealId: "deal-4c", err: cause })
    );
  });
});

describe("trySendReviewSms — second failure transitions to failed", () => {
  it("MessagingSendError on the 2nd attempt bumps attempts to 2, calls onFinalFailure once, returns 'failed'", async () => {
    // This is the integration target of KOT-624 §4: first tick already
    // bumped attempts to 1 (currentAttempts=1 below). A second network
    // error must now move the deal to review_request_status='failed'
    // and write a review_events.failed row (via onFinalFailure).
    const deps = makeDeps({
      sendSms: vi.fn(async () => {
        throw new MessagingSendError("connect ETIMEDOUT", {
          provider: "messagebird",
        });
      }),
    });

    const outcome = await trySendReviewSms(
      {
        dealId: "deal-5",
        phone: "+491701234567",
        body: "...",
        variant: "A",
        currentAttempts: 1,
      },
      deps
    );

    expect(outcome).toEqual({ outcome: "failed", attemptCount: 2 });
    expect(deps.onAttemptIncrement).toHaveBeenCalledOnce();
    expect(deps.onAttemptIncrement).toHaveBeenCalledWith({
      dealId: "deal-5",
      attemptCount: 2,
    });
    expect(deps.onFinalFailure).toHaveBeenCalledOnce();
    expect(deps.onFinalFailure).toHaveBeenCalledWith({
      dealId: "deal-5",
      attemptCount: 2,
    });
    expect(deps.onSendSuccess).not.toHaveBeenCalled();
  });

  it("also marks failed if currentAttempts is already >= 1 (defensive: counts can drift past 1)", async () => {
    // Belt-and-braces: if the DB ever reports currentAttempts=2 (e.g.
    // a redrive or duplicate cron), one more failure should still flip
    // to failed rather than silently retrying forever.
    const deps = makeDeps({
      sendSms: vi.fn(async () => {
        throw new Error("network");
      }),
    });

    const outcome = await trySendReviewSms(
      {
        dealId: "deal-5b",
        phone: "+491701234567",
        body: "...",
        variant: "B",
        currentAttempts: 2,
      },
      deps
    );

    expect(outcome).toEqual({ outcome: "failed", attemptCount: 3 });
    expect(deps.onFinalFailure).toHaveBeenCalledOnce();
  });
});

describe("trySendReviewSms — callback ordering", () => {
  it("on final failure, onAttemptIncrement runs before onFinalFailure (counter is durable even if mark crashes)", async () => {
    const calls: string[] = [];
    const deps = makeDeps({
      sendSms: vi.fn(async () => {
        throw new MessagingSendError("x", { provider: "messagebird" });
      }),
      onAttemptIncrement: vi.fn(async () => {
        calls.push("increment");
      }),
      onFinalFailure: vi.fn(async () => {
        calls.push("final");
      }),
    });

    await trySendReviewSms(
      {
        dealId: "deal-6",
        phone: "+491701234567",
        body: "...",
        variant: "A",
        currentAttempts: 1,
      },
      deps
    );

    expect(calls).toEqual(["increment", "final"]);
  });
});
