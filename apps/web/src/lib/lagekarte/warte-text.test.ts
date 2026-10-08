import { describe, expect, it } from "vitest";
import { warteText } from "./warte-text";

const jetzt = new Date("2026-10-08T09:00:00+02:00");
const vor = (ms: number) => new Date(jetzt.getTime() - ms).toISOString();
const MIN = 60_000;
const STD = 60 * MIN;
const TAG = 24 * STD;

describe("warteText", () => {
  it("unter einer Minute: gerade eben", () => {
    expect(warteText(vor(0), jetzt)).toBe("gerade eben");
    expect(warteText(vor(59_999), jetzt)).toBe("gerade eben");
  });

  it("Zeitpunkt in der Zukunft (Uhrzeit-Versatz): gerade eben", () => {
    expect(warteText(vor(-5 * MIN), jetzt)).toBe("gerade eben");
  });

  it("Minuten, abgerundet", () => {
    expect(warteText(vor(MIN), jetzt)).toBe("seit 1 Min.");
    expect(warteText(vor(12 * MIN + 59_000), jetzt)).toBe("seit 12 Min.");
    expect(warteText(vor(59 * MIN + 59_000), jetzt)).toBe("seit 59 Min.");
  });

  it("Stunden, abgerundet", () => {
    expect(warteText(vor(STD), jetzt)).toBe("seit 1 Std.");
    expect(warteText(vor(3 * STD + 59 * MIN), jetzt)).toBe("seit 3 Std.");
    expect(warteText(vor(23 * STD + 59 * MIN), jetzt)).toBe("seit 23 Std.");
  });

  it("ab 24 Stunden: seit gestern, ab 48 Stunden Tage", () => {
    expect(warteText(vor(TAG), jetzt)).toBe("seit gestern");
    expect(warteText(vor(2 * TAG - 1), jetzt)).toBe("seit gestern");
    expect(warteText(vor(2 * TAG), jetzt)).toBe("seit 2 Tagen");
    expect(warteText(vor(4 * TAG + 23 * STD), jetzt)).toBe("seit 4 Tagen");
    expect(warteText(vor(134 * TAG), jetzt)).toBe("seit 134 Tagen");
  });

  it("ungültiger Zeitpunkt: leerer Text statt „NaN“", () => {
    expect(warteText("kein-datum", jetzt)).toBe("");
  });
});
