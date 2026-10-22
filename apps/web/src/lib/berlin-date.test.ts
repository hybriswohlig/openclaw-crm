import { describe, expect, it } from "vitest";
import { berlinHour } from "./berlin-date";

// The KI-Wächter decides "night" from the Berlin hour. A de-DE formatter
// returns "03 Uhr", Number() of that is NaN, every comparison with NaN is
// false, so alarms went out at 3 a.m.
describe("berlinHour", () => {
  it("uses summer time (UTC+2)", () => {
    expect(berlinHour(new Date("2026-10-22T01:30:00Z"))).toBe(3);
  });

  it("uses winter time (UTC+1)", () => {
    expect(berlinHour(new Date("2026-12-01T01:30:00Z"))).toBe(2);
  });

  it("returns 0 after midnight, not 24", () => {
    expect(berlinHour(new Date("2026-12-01T23:30:00Z"))).toBe(0);
  });

  it("is a whole hour 0-23 all day long", () => {
    for (let h = 0; h < 24; h++) {
      const hour = berlinHour(new Date(Date.UTC(2026, 9, 22, h, 15)));
      expect(Number.isInteger(hour)).toBe(true);
      expect(hour).toBeGreaterThanOrEqual(0);
      expect(hour).toBeLessThanOrEqual(23);
    }
  });
});
