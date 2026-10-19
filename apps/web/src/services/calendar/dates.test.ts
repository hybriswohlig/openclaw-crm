import { describe, expect, it } from "vitest";
import { agendaVisibleDays, berlinDateAndTime, berlinTodayKey, berlinWallDate, daysBetween, plusDays } from "./dates";

describe("Berlin calendar dates", () => {
  it("converts summer and winter instants to Berlin wall time", () => {
    expect(berlinDateAndTime(new Date("2026-07-01T06:00:00.000Z"))).toEqual({
      date: "2026-07-01",
      time: "08:00",
    });
    expect(berlinDateAndTime(new Date("2026-01-15T07:00:00.000Z"))).toEqual({
      date: "2026-01-15",
      time: "08:00",
    });
  });

  it("steps across month ends", () => {
    expect(plusDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(daysBetween("2026-10-19", "2026-10-21")).toBe(2);
  });

  it("uses the Berlin civil date after UTC has already rolled to the previous day", () => {
    // 00:30 on 20 Oct in Berlin (CEST, UTC+2) is still 19 Oct in UTC.
    const instant = new Date("2026-10-19T22:30:00.000Z");
    expect(berlinTodayKey(instant)).toBe("2026-10-20");
    const wall = berlinWallDate(instant);
    expect(wall.getFullYear()).toBe(2026);
    expect(wall.getMonth()).toBe(9);
    expect(wall.getDate()).toBe(20);
  });
});

describe("agendaVisibleDays", () => {
  const october = ["2026-10-01", "2026-10-13", "2026-10-19", "2026-10-23"];

  it("keeps today in the agenda when that day has no events", () => {
    const events = new Set(["2026-10-01", "2026-10-13"]);
    expect(agendaVisibleDays(october, "2026-10-19", null, (day) => events.has(day))).toEqual([
      "2026-10-01",
      "2026-10-13",
      "2026-10-19",
    ]);
  });

  it("does not invent today when the open month is a different one", () => {
    expect(agendaVisibleDays(["2026-05-13"], "2026-10-19", null, () => false)).toEqual([]);
  });
});
