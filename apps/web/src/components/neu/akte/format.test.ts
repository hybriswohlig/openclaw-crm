import { describe, expect, it } from "vitest";
import { dauer, euro, relativTag, tagKurz } from "./format";

/** Do 05.11.2026, 10:00 in Berlin. */
const JETZT = new Date("2026-11-05T09:00:00.000Z");

const MIN = 60_000;
const STD = 60 * MIN;
const TAG = 24 * STD;

describe("euro", () => {
  it("schreibt ganze Beträge ohne Nachkommastellen", () => {
    expect(euro(248000)).toBe("2.480 €");
    expect(euro(0)).toBe("0 €");
  });

  it("zeigt Cent nur, wenn welche da sind", () => {
    expect(euro(199050)).toBe("1.990,50 €");
  });
});

describe("tagKurz", () => {
  it("schreibt Wochentag und Tag.Monat.", () => {
    expect(tagKurz("2026-11-03")).toBe("Di 03.11.");
    expect(tagKurz("2026-11-20")).toBe("Fr 20.11.");
  });

  it("rechnet Zeitstempel nach Berlin um", () => {
    // 23:30 UTC ist in Berlin schon der nächste Tag.
    expect(tagKurz("2026-11-20T23:30:00.000Z")).toBe("Sa 21.11.");
  });
});

describe("dauer", () => {
  it("zählt unter einer Stunde in Minuten", () => {
    expect(dauer(35 * MIN)).toBe("35 Min");
    expect(dauer(59 * MIN + 59_000)).toBe("59 Min");
  });

  it("zählt unter einem Tag in Stunden", () => {
    expect(dauer(5 * STD)).toBe("5 Std");
    expect(dauer(23 * STD + 59 * MIN)).toBe("23 Std");
  });

  it("zählt ab einem Tag in Tagen, Einzahl bei einem", () => {
    expect(dauer(TAG)).toBe("1 Tag");
    expect(dauer(2 * TAG + 3 * STD)).toBe("2 Tage");
  });

  it("wird nie negativ", () => {
    expect(dauer(0)).toBe("0 Min");
    expect(dauer(-5 * MIN)).toBe("0 Min");
  });
});

describe("relativTag", () => {
  it("kennt heute, gestern und morgen", () => {
    expect(relativTag("2026-11-05", JETZT)).toBe("heute");
    expect(relativTag("2026-11-04", JETZT)).toBe("gestern");
    expect(relativTag("2026-11-06", JETZT)).toBe("morgen");
  });

  it("zählt Tage in beide Richtungen", () => {
    expect(relativTag("2026-11-21", JETZT)).toBe("in 16 Tagen");
    expect(relativTag("2026-11-02", JETZT)).toBe("vor 3 Tagen");
  });

  it("vergleicht Berliner Kalendertage, nicht UTC", () => {
    // 23:30 UTC am 5.11. ist in Berlin schon der 6.11.
    expect(relativTag("2026-11-05T22:30:00.000Z", JETZT)).toBe("heute");
    expect(relativTag("2026-11-05T23:30:00.000Z", JETZT)).toBe("morgen");
  });
});
