import { describe, expect, it } from "vitest";
import { kalenderTage, plusTage } from "./kalender";

describe("plusTage", () => {
  it("rechnet über Monats- und Jahreswechsel und die Zeitumstellung", () => {
    expect(plusTage("2026-03-28", 1)).toBe("2026-03-29");
    expect(plusTage("2026-03-28", 2)).toBe("2026-03-30");
    expect(plusTage("2026-10-25", 1)).toBe("2026-10-26");
    expect(plusTage("2026-12-31", 1)).toBe("2027-01-01");
    expect(plusTage("2026-10-08", 6)).toBe("2026-10-14");
    expect(plusTage("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("kalenderTage", () => {
  it("zählt Kalendertage, auch rückwärts und über die Zeitumstellung", () => {
    expect(kalenderTage("2026-10-08", "2026-10-08")).toBe(0);
    expect(kalenderTage("2026-10-08", "2026-10-09")).toBe(1);
    expect(kalenderTage("2026-03-28", "2026-03-30")).toBe(2);
    expect(kalenderTage("2026-10-24", "2026-10-26")).toBe(2);
    expect(kalenderTage("2026-10-09", "2026-10-08")).toBe(-1);
  });
});
