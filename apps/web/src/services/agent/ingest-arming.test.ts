import { describe, expect, it } from "vitest";
import { aiProcessedAtBeimEingang } from "./ingest-arming";

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
