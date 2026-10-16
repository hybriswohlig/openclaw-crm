import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CONSENT_GATE,
  decideDraftClose,
  flagTrue,
  gateReasonsBlockingSend,
  outboundStateTouch,
  parseCloseAction,
} from "./draft-freigabe";

const MASTER = new Set(["master_switch_off"]);

describe("gateReasonsBlockingSend", () => {
  it("keeps human_owned and ai_paused blocking without a human approval", () => {
    const { blocking, consentOverridden } = gateReasonsBlockingSend({
      reasons: ["human_owned", "ai_paused", "master_switch_off"],
      overridable: MASTER,
    });
    expect(blocking).toEqual(["human_owned", "ai_paused"]);
    expect(consentOverridden).toBe(false);
  });

  it("lifts only human_owned and ai_paused when a human approved", () => {
    const { blocking } = gateReasonsBlockingSend({
      reasons: ["human_owned", "ai_paused", "suppressed", "stage_terminal", "min_gap"],
      overridable: MASTER,
      humanApproved: true,
    });
    expect(blocking).toEqual(["suppressed", "stage_terminal", "min_gap"]);
  });

  it("keeps no_proactive_consent blocking unless overrideConsent is set with the approval", () => {
    const reasons = ["human_owned", "ai_paused", CONSENT_GATE];
    const held = gateReasonsBlockingSend({
      reasons,
      overridable: MASTER,
      humanApproved: true,
      overrideConsent: false,
    });
    expect(held.blocking).toEqual([CONSENT_GATE]);
    expect(held.consentOverridden).toBe(false);

    const alone = gateReasonsBlockingSend({
      reasons,
      overridable: MASTER,
      humanApproved: false,
      overrideConsent: true,
    });
    expect(alone.blocking).toEqual(["human_owned", "ai_paused", CONSENT_GATE]);
    expect(alone.consentOverridden).toBe(false);

    const lifted = gateReasonsBlockingSend({
      reasons,
      overridable: MASTER,
      humanApproved: true,
      overrideConsent: true,
    });
    expect(lifted.blocking).toEqual([]);
    expect(lifted.consentOverridden).toBe(true);
  });

  it("does not treat price_leak, expiry, or send failures as gate reasons it can lift", () => {
    const { blocking } = gateReasonsBlockingSend({
      reasons: ["price_leak", "expired", "session_expired", "human_owned"],
      overridable: MASTER,
      humanApproved: true,
      overrideConsent: true,
    });
    expect(blocking).toEqual(["price_leak", "expired", "session_expired"]);
  });
});

describe("outboundStateTouch", () => {
  it("writes only the send timestamp, never ownership flags", () => {
    const now = new Date("2026-10-16T09:00:00Z");
    expect(outboundStateTouch(now)).toEqual({ lastOutboundAt: now, updatedAt: now });
  });
});

describe("parseCloseAction", () => {
  it("accepts dismiss and mark_taken aliases", () => {
    expect(parseCloseAction("dismiss")?.status).toBe("dismissed");
    expect(parseCloseAction("dismissed")?.status).toBe("dismissed");
    expect(parseCloseAction("mark_taken")?.status).toBe("superseded");
    expect(parseCloseAction("mark_sent_manually")?.status).toBe("superseded");
    expect(parseCloseAction("taken")?.status).toBe("edited");
    expect(parseCloseAction("approve_and_send")).toBeNull();
  });

  it("closes a pending draft and is idempotent once the draft is already closed", () => {
    const mark = parseCloseAction("mark_taken")!;
    expect(decideDraftClose(mark, "pending")).toEqual({ kind: "update", status: "superseded" });
    expect(decideDraftClose(mark, "cancelled")).toEqual({ kind: "idempotent" });
    expect(decideDraftClose(mark, "superseded")).toEqual({ kind: "idempotent" });
    expect(decideDraftClose(mark, "sent")).toEqual({ kind: "idempotent" });
    expect(decideDraftClose(mark, "approved")).toEqual({ kind: "noop" });
    expect(decideDraftClose(mark, "send_uncertain")).toEqual({ kind: "noop" });

    const dismiss = parseCloseAction("dismiss")!;
    expect(decideDraftClose(dismiss, "pending")).toEqual({ kind: "update", status: "dismissed" });
    expect(decideDraftClose(dismiss, "send_uncertain")).toEqual({ kind: "update", status: "dismissed" });
    expect(decideDraftClose(dismiss, "dismissed")).toEqual({ kind: "idempotent" });
    expect(decideDraftClose(dismiss, "superseded")).toEqual({ kind: "idempotent" });
  });
});

describe("flagTrue", () => {
  it("accepts a boolean true and the string true", () => {
    expect(flagTrue(true)).toBe(true);
    expect(flagTrue("true")).toBe(true);
    expect(flagTrue(false)).toBe(false);
    expect(flagTrue("false")).toBe(false);
    expect(flagTrue(undefined)).toBe(false);
  });
});

describe("approve-and-send does not clear ownership flags", () => {
  it("never assigns humanOwned or aiPaused to false on the send path", () => {
    const src = readFileSync(new URL("./draft-senden.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/humanOwned:\s*false/);
    expect(src).not.toMatch(/aiPaused:\s*false/);
    expect(src).toContain("outboundStateTouch");
  });
});
