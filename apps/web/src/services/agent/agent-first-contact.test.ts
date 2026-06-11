import { describe, expect, it } from "vitest";
import { isWithinSendWindow } from "./agent-first-contact";

// Regression guard for the locale trap: berlinHour() must NOT use a de-DE
// formatter, because de-DE renders the hour as "17 Uhr" and Number("17 Uhr") is
// NaN — which made isWithinSendWindow() always return false and the first-
// contact engine silently never send. These assert real hours work.
describe("isWithinSendWindow — Europe/Berlin outreach window", () => {
  it("is OPEN on a weekday afternoon (Thu 17:30 Berlin)", () => {
    // 2026-06-11 is a Thursday. 15:30 UTC = 17:30 Berlin (CEST).
    expect(isWithinSendWindow(new Date("2026-06-11T15:30:00Z"))).toBe(true);
  });
  it("is CLOSED late at night (Thu 00:30 Berlin)", () => {
    expect(isWithinSendWindow(new Date("2026-06-11T22:30:00Z"))).toBe(false);
  });
  it("is CLOSED just before 8am (Thu 07:00 Berlin)", () => {
    expect(isWithinSendWindow(new Date("2026-06-11T05:00:00Z"))).toBe(false);
  });
  it("is OPEN right at 8am (Thu 08:00 Berlin)", () => {
    expect(isWithinSendWindow(new Date("2026-06-11T06:00:00Z"))).toBe(true);
  });
  it("Sunday is tighter: closed at 09:00, open at 11:00 Berlin", () => {
    // 2026-06-14 is a Sunday.
    expect(isWithinSendWindow(new Date("2026-06-14T07:00:00Z"))).toBe(false); // 09:00 Berlin
    expect(isWithinSendWindow(new Date("2026-06-14T09:00:00Z"))).toBe(true); // 11:00 Berlin
  });
});
