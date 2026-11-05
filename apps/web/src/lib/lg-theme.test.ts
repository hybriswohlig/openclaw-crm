import { describe, expect, it } from "vitest";
import { haltLgThemeFest, lgThemeFor } from "./lg-theme";

describe("lgThemeFor", () => {
  it("maps resolved themes onto the Glassy light and dark tokens", () => {
    expect(lgThemeFor("dark")).toBe("dark");
    expect(lgThemeFor("light")).toBe("light");
    expect(lgThemeFor(undefined)).toBe("light");
  });
});

/** Kleiner MutationObserver-Ersatz: ruft zurück, wenn data-lg-theme geschrieben wird. */
function testumgebung() {
  const beobachter: FakeBeobachter[] = [];
  class FakeBeobachter {
    verbunden = false;
    constructor(public rueckruf: () => void) {
      beobachter.push(this);
    }
    observe() {
      this.verbunden = true;
    }
    disconnect() {
      this.verbunden = false;
    }
  }
  const dataset: { lgTheme?: string } = {};
  const wurzel = { dataset } as unknown as HTMLElement;
  /** Schreibt wie GlassProvider und stellt die Mutation zu (wie die Mikrotask im Browser). */
  function schreibe(wert: string | undefined) {
    if (wert === undefined) delete dataset.lgTheme;
    else dataset.lgTheme = wert;
    for (const b of beobachter) if (b.verbunden) b.rueckruf();
  }
  return { wurzel, dataset, beobachter, schreibe, Beobachter: FakeBeobachter as unknown as typeof MutationObserver };
}

describe("haltLgThemeFest", () => {
  it("setzt das Theme sofort und setzt ein späteres dark wieder auf light", () => {
    const t = testumgebung();
    haltLgThemeFest(t.wurzel, "light", t.Beobachter);
    expect(t.dataset.lgTheme).toBe("light");
    t.schreibe("dark"); // GlassProvider nach der Hydration mit gespeicherter Vorliebe
    expect(t.dataset.lgTheme).toBe("light");
  });

  it("lässt ein entferntes Attribut weg (Aufräumen beim Verlassen von /app)", () => {
    const t = testumgebung();
    haltLgThemeFest(t.wurzel, "light", t.Beobachter);
    t.schreibe(undefined);
    expect(t.dataset.lgTheme).toBeUndefined();
  });

  it("trennt den Beobachter beim Aufräumen", () => {
    const t = testumgebung();
    const aufraeumen = haltLgThemeFest(t.wurzel, "light", t.Beobachter);
    aufraeumen();
    expect(t.beobachter[0].verbunden).toBe(false);
    t.schreibe("dark");
    expect(t.dataset.lgTheme).toBe("dark");
  });
});
