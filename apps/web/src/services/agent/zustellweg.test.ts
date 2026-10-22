import { describe, expect, it } from "vitest";
import { zustellweg } from "./zustellweg";

// What an agent run does with a finished customer message. Before, both
// engines queued an approval draft AND sent live in live mode, so "ok CODE"
// sent the same text twice; and neither checked the sticky human ownership.
describe("zustellweg", () => {
  // Owner decision (ccc542a): drafts and approval requests also for deals a
  // human took over; only the automatic send is off for them.
  it("a human-owned deal gets a draft, never a live send", () => {
    expect(zustellweg({ dryRun: true, humanOwned: true })).toBe("entwurf");
    expect(zustellweg({ dryRun: false, humanOwned: true })).toBe("entwurf");
  });

  it("dry run queues a draft", () => {
    expect(zustellweg({ dryRun: true, humanOwned: false })).toBe("entwurf");
  });

  it("live sends without queuing a draft", () => {
    expect(zustellweg({ dryRun: false, humanOwned: false })).toBe("senden");
  });
});
