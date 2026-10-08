import { afterEach, describe, expect, it, vi } from "vitest";
import { istVorschau, ladeBeispielDaten } from "./vorschau";

describe("istVorschau", () => {
  it("Entwicklung mit demo=1: Vorschau mit Beispieldaten", () => {
    expect(istVorschau("?demo=1", "development")).toBe(true);
    expect(istVorschau("?lead=lead-3&demo=1&status=neu", "development")).toBe(true);
    expect(istVorschau("demo=1", "test")).toBe(true);
  });

  it("Produktion: nie, auch nicht mit demo=1", () => {
    expect(istVorschau("?demo=1", "production")).toBe(false);
    expect(istVorschau("?lead=x&demo=1", "production")).toBe(false);
  });

  it("ohne demo=1: nie", () => {
    expect(istVorschau("", "development")).toBe(false);
    expect(istVorschau("?demo=0", "development")).toBe(false);
    expect(istVorschau("?demo=true", "development")).toBe(false);
    expect(istVorschau("?xdemo=1", "development")).toBe(false);
  });
});

describe("ladeBeispielDaten", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("außerhalb von Produktion: liefert das Beispielmodul", async () => {
    const beispiel = await ladeBeispielDaten();
    expect(beispiel).not.toBeNull();
    expect(beispiel?.beispielAntwort().leads.length).toBeGreaterThan(0);
    expect(beispiel?.beispielVerlauf("lead-1").milestones.length).toBeGreaterThan(0);
  });

  it("Produktion: kein Modul", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(await ladeBeispielDaten()).toBeNull();
  });
});
