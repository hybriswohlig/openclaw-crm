import { describe, expect, it } from "vitest";
import { isQuietHoursBerlin } from "./quiet-hours";

// KOT-624 unit coverage for the quiet-hours window helper (KOT-622).
// Spec §3: send only on Mon-Sat, 09:00-19:00 Europe/Berlin local time.
//
// All `Date` instances in these tests are constructed as ISO strings that
// already pre-shift for Europe/Berlin. CET is UTC+1, CEST is UTC+2; tests
// pick fixed dates where the offset is unambiguous so DST transitions
// don't make any assertion flaky.

describe("Sunday — always quiet", () => {
  it("Sunday 14:00 Berlin is quiet", () => {
    // 2026-03-08 was a Sunday. 13:00Z = 14:00 Berlin (CET, before DST).
    const sundayAfternoon = new Date("2026-03-08T13:00:00Z");
    expect(isQuietHoursBerlin(sundayAfternoon)).toBe(true);
  });

  it("Sunday 02:00 Berlin is quiet", () => {
    const sundayLate = new Date("2026-03-08T01:00:00Z");
    expect(isQuietHoursBerlin(sundayLate)).toBe(true);
  });

  it("Sunday 11:00 Berlin (would be within mid-day on a weekday) is still quiet", () => {
    const sundayMid = new Date("2026-03-08T10:00:00Z");
    expect(isQuietHoursBerlin(sundayMid)).toBe(true);
  });
});

describe("Weekday — quiet outside 09:00-19:00 Berlin", () => {
  it("Monday 21:00 Berlin is quiet", () => {
    // 2026-03-09 is Monday. 20:00Z = 21:00 Berlin (CET).
    const mondayEvening = new Date("2026-03-09T20:00:00Z");
    expect(isQuietHoursBerlin(mondayEvening)).toBe(true);
  });

  it("Monday 19:00 Berlin (boundary) is quiet (>=19)", () => {
    const mondayBoundaryEvening = new Date("2026-03-09T18:00:00Z");
    expect(isQuietHoursBerlin(mondayBoundaryEvening)).toBe(true);
  });

  it("Monday 08:00 Berlin is quiet (<9)", () => {
    const mondayEarly = new Date("2026-03-09T07:00:00Z");
    expect(isQuietHoursBerlin(mondayEarly)).toBe(true);
  });

  it("Monday 03:00 Berlin is quiet", () => {
    const mondayNight = new Date("2026-03-09T02:00:00Z");
    expect(isQuietHoursBerlin(mondayNight)).toBe(true);
  });
});

describe("Weekday — active inside 09:00-19:00 Berlin", () => {
  it("Monday 09:00 Berlin (left boundary) is active", () => {
    const mondayMorning = new Date("2026-03-09T08:00:00Z");
    expect(isQuietHoursBerlin(mondayMorning)).toBe(false);
  });

  it("Monday 10:30 Berlin is active", () => {
    const mondayLate = new Date("2026-03-09T09:30:00Z");
    expect(isQuietHoursBerlin(mondayLate)).toBe(false);
  });

  it("Wednesday 14:00 Berlin is active", () => {
    // 2026-03-11 is Wednesday.
    const wedAfternoon = new Date("2026-03-11T13:00:00Z");
    expect(isQuietHoursBerlin(wedAfternoon)).toBe(false);
  });

  it("Saturday 14:00 Berlin is active (window is Mon-Sat)", () => {
    // 2026-03-14 is Saturday.
    const satAfternoon = new Date("2026-03-14T13:00:00Z");
    expect(isQuietHoursBerlin(satAfternoon)).toBe(false);
  });

  it("Friday 18:00 Berlin (still inside window) is active", () => {
    // 2026-03-13 is Friday. 17:00Z = 18:00 Berlin (CET).
    const friLateAfternoon = new Date("2026-03-13T17:00:00Z");
    expect(isQuietHoursBerlin(friLateAfternoon)).toBe(false);
  });
});

describe("DST handling — Europe/Berlin transitions are honoured", () => {
  it("Monday 14:00 Berlin in summer (CEST = UTC+2) is active", () => {
    // 2026-06-15 is Monday. CEST → 12:00Z = 14:00 Berlin.
    const summerMonday = new Date("2026-06-15T12:00:00Z");
    expect(isQuietHoursBerlin(summerMonday)).toBe(false);
  });

  it("Sunday in summer is still quiet", () => {
    // 2026-06-14 is Sunday. CEST.
    const summerSunday = new Date("2026-06-14T12:00:00Z");
    expect(isQuietHoursBerlin(summerSunday)).toBe(true);
  });
});

// Window-missed reasoning: spec §3 says a deal whose 4-24h window falls
// entirely on Sunday must be marked suppressed with reason
// `quiet_hours_window_missed`. The cron job runs sweepWindowMissed() on
// every tick and only writes the suppressed event for deals whose
// move_completed_at is older than 24h AND consent is present AND status
// is still `not_due`. That sweep call-site is integration-tested in
// KOT-624 §4 follow-up; the quiet-hours boundary that gates the send
// loop (and thus produces those window-missed deals on Sundays) is
// pinned above.
