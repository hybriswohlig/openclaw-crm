import { describe, expect, it } from "vitest";
import { decideEmailDeal, referencedMessageIds } from "./email-deal-policy";

const base = {
  lane: "lead" as const,
  kontaktart: "lead_kunde",
  hasDeal: false,
  replyToOwnMail: false,
  suggestionsEnabled: true,
  autoWriteEnabled: true,
  threshold: 0.85,
};

describe("decideEmailDeal", () => {
  it("creates a deal only for a sure customer inquiry", () => {
    expect(
      decideEmailDeal({
        ...base,
        classification: { verdict: "kundenanfrage", confidence: 0.92, evidenceInText: true },
      })
    ).toEqual({ action: "auto", reason: "sure_customer" });
  });

  it("suggests when the model is unsure or below the threshold", () => {
    expect(
      decideEmailDeal({
        ...base,
        classification: { verdict: "unsicher", confidence: 0.6, evidenceInText: true },
      }).action
    ).toBe("suggest");
    expect(
      decideEmailDeal({
        ...base,
        classification: { verdict: "kundenanfrage", confidence: 0.7, evidenceInText: true },
      })
    ).toMatchObject({ action: "suggest", reason: "below_threshold" });
  });

  it("never creates a deal from the lane heuristic alone", () => {
    expect(decideEmailDeal({ ...base, classification: null })).toEqual({
      action: "never",
      reason: "no_classification",
    });
  });

  it("never creates a deal for a sure non-customer", () => {
    expect(
      decideEmailDeal({
        ...base,
        classification: { verdict: "kein_kunde", confidence: 0.95, evidenceInText: true },
      })
    ).toEqual({ action: "never", reason: "not_a_customer" });
  });

  it("suggests a low-confidence non-customer instead of dropping it silently", () => {
    expect(
      decideEmailDeal({
        ...base,
        classification: { verdict: "kein_kunde", confidence: 0.4, evidenceInText: true },
      }).action
    ).toBe("suggest");
  });

  it("blocks Kontaktart, kein_lead, spam and replies to our own mail", () => {
    expect(decideEmailDeal({ ...base, kontaktart: "bewerber", classification: sure() }).reason).toBe("kontaktart");
    expect(decideEmailDeal({ ...base, lane: "kein_lead", classification: sure() }).reason).toBe("lane_blocked");
    expect(decideEmailDeal({ ...base, lane: "spam", classification: sure() }).reason).toBe("lane_blocked");
    expect(decideEmailDeal({ ...base, lane: "info", classification: sure() }).reason).toBe("lane_not_lead");
    expect(decideEmailDeal({ ...base, replyToOwnMail: true, classification: sure() }).reason).toBe(
      "reply_to_own_mail"
    );
    expect(decideEmailDeal({ ...base, hasDeal: true, classification: sure() }).reason).toBe("has_deal");
  });

  it("follows the per-company switches", () => {
    expect(
      decideEmailDeal({
        ...base,
        autoWriteEnabled: false,
        classification: sure(),
      })
    ).toMatchObject({ action: "suggest", reason: "auto_disabled" });
    expect(
      decideEmailDeal({
        ...base,
        suggestionsEnabled: false,
        autoWriteEnabled: false,
        classification: sure(),
      }).reason
    ).toBe("kill_switch");
    expect(
      decideEmailDeal({
        ...base,
        suggestionsEnabled: false,
        classification: { verdict: "unsicher", confidence: 0.5, evidenceInText: true },
      }).action
    ).toBe("never");
  });

  it("downgrades a sure verdict whose quote is not in the mail", () => {
    expect(
      decideEmailDeal({
        ...base,
        classification: { verdict: "kundenanfrage", confidence: 0.99, evidenceInText: false },
      })
    ).toMatchObject({ action: "suggest", reason: "evidence_not_in_text" });
  });
});

describe("referencedMessageIds", () => {
  it("collects In-Reply-To and References", () => {
    expect(
      referencedMessageIds({
        inReplyTo: "<a@x>",
        references: ["<a@x>", "<b@x>"],
      })
    ).toEqual(["<a@x>", "<b@x>"]);
  });
});

function sure() {
  return { verdict: "kundenanfrage" as const, confidence: 0.93, evidenceInText: true };
}
