import { describe, expect, it } from "vitest";
import { isWithinSendWindow } from "./agent-gate";

// July dates: Europe/Berlin = UTC+2 (CEST). The offsets below encode Berlin
// wall-clock times directly, so the assertions read as Berlin hours.

describe("isWithinSendWindow — Mon–Sat 08–20, Sun 10–19, Europe/Berlin", () => {
  it("allows a weekday mid-morning", () => {
    // Thursday 2026-07-23 09:30 Berlin
    expect(isWithinSendWindow(new Date("2026-07-23T09:30:00+02:00"))).toBe(true);
  });
  it("allows the weekday edge minutes (08:00 open, 19:59 last)", () => {
    expect(isWithinSendWindow(new Date("2026-07-23T08:00:00+02:00"))).toBe(true);
    expect(isWithinSendWindow(new Date("2026-07-23T19:59:00+02:00"))).toBe(true);
  });
  it("blocks weekday early morning and evening (07:59, 20:00)", () => {
    expect(isWithinSendWindow(new Date("2026-07-23T07:59:00+02:00"))).toBe(false);
    expect(isWithinSendWindow(new Date("2026-07-23T20:00:00+02:00"))).toBe(false);
  });
  it("blocks the night hours", () => {
    expect(isWithinSendWindow(new Date("2026-07-23T02:00:00+02:00"))).toBe(false);
    expect(isWithinSendWindow(new Date("2026-07-23T23:30:00+02:00"))).toBe(false);
  });
  it("uses the narrower Sunday window (10–19)", () => {
    // Sunday 2026-07-26
    expect(isWithinSendWindow(new Date("2026-07-26T09:30:00+02:00"))).toBe(false);
    expect(isWithinSendWindow(new Date("2026-07-26T10:00:00+02:00"))).toBe(true);
    expect(isWithinSendWindow(new Date("2026-07-26T18:59:00+02:00"))).toBe(true);
    expect(isWithinSendWindow(new Date("2026-07-26T19:00:00+02:00"))).toBe(false);
  });
  it("allows Saturday like a weekday", () => {
    // Saturday 2026-07-25
    expect(isWithinSendWindow(new Date("2026-07-25T09:00:00+02:00"))).toBe(true);
    expect(isWithinSendWindow(new Date("2026-07-25T20:30:00+02:00"))).toBe(false);
  });
  it("evaluates Berlin wall time, not the machine timezone (UTC input)", () => {
    // 06:30 UTC on a Thursday = 08:30 Berlin in July → open,
    // even though 06:30 would be closed if UTC were used naively.
    expect(isWithinSendWindow(new Date("2026-07-23T06:30:00Z"))).toBe(true);
    // 18:30 UTC = 20:30 Berlin → closed, though 18:30 naive-UTC would be open.
    expect(isWithinSendWindow(new Date("2026-07-23T18:30:00Z"))).toBe(false);
  });
  it("handles winter time (CET, UTC+1) correctly", () => {
    // Monday 2026-01-19 08:30 Berlin = 07:30 UTC → open.
    expect(isWithinSendWindow(new Date("2026-01-19T07:30:00Z"))).toBe(true);
    // Monday 2026-01-19 07:30 Berlin = 06:30 UTC → closed.
    expect(isWithinSendWindow(new Date("2026-01-19T06:30:00Z"))).toBe(false);
  });
});
