import { describe, expect, it } from "vitest";
import { berlinDateAndTime, daysBetween, plusDays } from "./dates";

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
});
