import { describe, expect, it } from "vitest";
import { agentFelderBeimEingang, aiProcessedAtBeimEingang } from "./ingest-arming";

// Ingest deliberately leaves some inbound messages un-armed (ImmoScout
// notification mails, STOP replies, OTP-style messages on lead threads). The
// reply worker's safety net re-armed every lead thread with an unprocessed
// latest message, so those got bogus drafts (and auto-replies once live).
// An un-armed message is "processed" the moment it arrives.
describe("aiProcessedAtBeimEingang", () => {
  const sentAt = new Date("2026-10-23T09:30:00Z");

  it("armed message stays unprocessed", () => {
    expect(aiProcessedAtBeimEingang(true, sentAt)).toBeNull();
  });

  it("un-armed message is stamped with its send time", () => {
    expect(aiProcessedAtBeimEingang(false, sentAt)).toEqual(sentAt);
  });
});

// aiLastInboundAt is "the last message the agent should react to": it drives
// the quiet window and the draft freshness check. A door code or an
// auto-reply must neither move it (that made good drafts "stale") nor disarm
// a lead message that is still waiting for its turn.
describe("agentFelderBeimEingang", () => {
  const sentAt = new Date("2026-10-23T09:30:00Z");

  it("an armed message arms the agent and moves the timestamp", () => {
    expect(agentFelderBeimEingang({ armiert: true, declined: false, sentAt })).toEqual({
      aiNeedsReply: true,
      aiLastInboundAt: sentAt,
    });
  });

  it("a STOP disarms and moves the timestamp", () => {
    expect(agentFelderBeimEingang({ armiert: false, declined: true, sentAt })).toEqual({
      aiNeedsReply: false,
      aiLastInboundAt: sentAt,
    });
  });

  it("any other un-armed message leaves the agent fields alone", () => {
    expect(agentFelderBeimEingang({ armiert: false, declined: false, sentAt })).toEqual({});
  });
});
