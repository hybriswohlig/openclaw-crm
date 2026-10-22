import { describe, expect, it } from "vitest";
import { zustellweg } from "./zustellweg";

// What an agent run does with a finished customer message. Before, both
// engines queued an approval draft AND sent live in live mode, so "ok CODE"
// sent the same text twice; and neither checked the sticky human ownership.
describe("zustellweg", () => {
  it("skips a human-owned deal in dry run and live", () => {
    expect(zustellweg({ dryRun: true, humanOwned: true })).toBe("ueberspringen");
    expect(zustellweg({ dryRun: false, humanOwned: true })).toBe("ueberspringen");
  });

  it("dry run queues a draft", () => {
    expect(zustellweg({ dryRun: true, humanOwned: false })).toBe("entwurf");
  });

  it("live sends without queuing a draft", () => {
    expect(zustellweg({ dryRun: false, humanOwned: false })).toBe("senden");
  });
});
