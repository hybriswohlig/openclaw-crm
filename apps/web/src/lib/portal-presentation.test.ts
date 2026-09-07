import { describe, expect, it } from "vitest";
import { formatPortalMoney, recordedMoveStatus } from "../app/(public)/s/[token]/_components/portal-presentation";

describe("customer portal presentation", () => {
  it("preserves quoted cents", () => {
    expect(formatPortalMoney(163049).replace(/\s/g, " ")).toBe("1.630,49 €");
    expect(formatPortalMoney(163000).replace(/\s/g, " ")).toBe("1.630 €");
  });
  it("does not claim live activity without recorded events", () => {
    expect(recordedMoveStatus({ departureAt: null, onsiteAt: null, finishedAt: null })).toBeNull();
  });
  it("reports only the latest recorded milestone", () => {
    expect(recordedMoveStatus({ departureAt: "2026-09-06T07:00:00Z", onsiteAt: null, finishedAt: null })).toBe("Team unterwegs");
    expect(recordedMoveStatus({ departureAt: null, onsiteAt: "2026-09-06T08:00:00Z", finishedAt: null })).toBe("Team vor Ort");
    expect(recordedMoveStatus({ departureAt: null, onsiteAt: null, finishedAt: "2026-09-06T15:00:00Z" })).toBe("Umzug abgeschlossen");
  });
});
