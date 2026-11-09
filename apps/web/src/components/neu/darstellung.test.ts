import { describe, expect, it } from "vitest";
import { effectivePreferences, type PreferenceSources } from "@/components/glassyui/glass-provider";
import { DARSTELLUNG_SKRIPT, NEU_THEMEFARBE } from "@/lib/dunkel-abschaltung";
import { abgleichNoetig, darstellungAusCookie, themeFarbe, themeFuer, toasterTheme } from "./darstellung-logik";

/**
 * Plan 14b, Task S. Das Repo hat kein jsdom: das Kopf-Skript läuft mit gefälschtem
 * `location`, `document` und `window` über `new Function`.
 */

interface Lauf {
  attribute: Record<string, string>;
  klassen: string[];
  fehler: unknown;
}

function skriptLaufen(a: { pfad: string; cookie: string; systemDunkel: boolean; matchMediaFehlt?: boolean }): Lauf {
  const attribute: Record<string, string> = {};
  const klassen: string[] = [];
  const document = {
    cookie: a.cookie,
    documentElement: {
      setAttribute: (k: string, v: string) => {
        attribute[k] = v;
      },
      classList: { add: (k: string) => klassen.push(k) },
    },
  };
  const window = a.matchMediaFehlt
    ? {}
    : { matchMedia: (q: string) => ({ matches: q === "(prefers-color-scheme: dark)" && a.systemDunkel }) };
  let fehler: unknown = null;
  try {
    new Function("location", "document", "window", DARSTELLUNG_SKRIPT)({ pathname: a.pfad }, document, window);
  } catch (e) {
    fehler = e;
  }
  return { attribute, klassen, fehler };
}

describe("DARSTELLUNG_SKRIPT (Kopf-Skript)", () => {
  it.each([
    ["hell", false, "light"],
    ["hell", true, "light"],
    ["dunkel", false, "dark"],
    ["dunkel", true, "dark"],
    ["system", false, "light"],
    ["system", true, "dark"],
  ] as const)("Cookie %s, Gerät dunkel %s -> %s", (wert, systemDunkel, theme) => {
    const lauf = skriptLaufen({ pfad: "/app/heute", cookie: `a=1; neu_darstellung=${wert}; b=2`, systemDunkel });
    expect(lauf.fehler).toBeNull();
    expect(lauf.attribute).toEqual({ "data-lg-theme": theme });
  });

  it("ohne Cookie folgt es dem Gerät (Standard „system“)", () => {
    expect(skriptLaufen({ pfad: "/app", cookie: "", systemDunkel: true }).attribute).toEqual({ "data-lg-theme": "dark" });
    expect(skriptLaufen({ pfad: "/app", cookie: "crm_ui=neu", systemDunkel: false }).attribute).toEqual({
      "data-lg-theme": "light",
    });
  });

  it("tut außerhalb von /app nichts (Portal, alte Seiten, Login)", () => {
    for (const pfad of ["/s/abc", "/home", "/login", "/", "/apple", "/application", "/objects/deals/1"]) {
      const lauf = skriptLaufen({ pfad, cookie: "neu_darstellung=dunkel", systemDunkel: true });
      expect(lauf.attribute, pfad).toEqual({});
    }
  });

  it("setzt nie die Klasse dark", () => {
    const lauf = skriptLaufen({ pfad: "/app/leads", cookie: "neu_darstellung=dunkel", systemDunkel: true });
    expect(lauf.klassen).toEqual([]);
    expect(DARSTELLUNG_SKRIPT).not.toMatch(/classList|className/);
  });

  it("wirft nie, auch bei kaputtem Cookie oder fehlendem matchMedia", () => {
    const kaputt = skriptLaufen({ pfad: "/app/heute", cookie: "neu_darstellung=%E0%A4", systemDunkel: true });
    expect(kaputt.fehler).toBeNull();
    expect(kaputt.attribute).toEqual({});
    const unbekannt = skriptLaufen({ pfad: "/app/heute", cookie: "neu_darstellung=grau", systemDunkel: false });
    expect(unbekannt.attribute).toEqual({ "data-lg-theme": "light" });
    const ohneMedia = skriptLaufen({ pfad: "/app/heute", cookie: "", systemDunkel: false, matchMediaFehlt: true });
    expect(ohneMedia.fehler).toBeNull();
  });
});

describe("darstellung-logik", () => {
  it("liest den Cookie und verwirft fremde Werte", () => {
    expect(darstellungAusCookie("neu_darstellung=dunkel")).toBe("dunkel");
    expect(darstellungAusCookie("x=1; neu_darstellung=hell")).toBe("hell");
    expect(darstellungAusCookie("neu_darstellung=grau")).toBeNull();
    expect(darstellungAusCookie("")).toBeNull();
    expect(darstellungAusCookie("neu_darstellung=%E0%A4")).toBeNull();
  });

  it("rechnet das Theme wie das Kopf-Skript", () => {
    expect(themeFuer("hell", true)).toBe("light");
    expect(themeFuer("dunkel", false)).toBe("dark");
    expect(themeFuer("system", true)).toBe("dark");
    expect(themeFuer(null, false)).toBe("light");
  });

  it("gleicht nur ab, wenn Cookie und Datenbank auseinanderliegen oder der Cookie fehlt", () => {
    expect(abgleichNoetig("dunkel", "dunkel")).toBeNull();
    expect(abgleichNoetig("hell", "dunkel")).toBe("dunkel");
    expect(abgleichNoetig(null, "system")).toBe("system");
  });

  it("Toasts folgen unter /app der neuen Oberfläche, sonst next-themes", () => {
    expect(toasterTheme("/app/heute", "dark", "light")).toBe("dark");
    expect(toasterTheme("/app/heute", "light", "dark")).toBe("light");
    expect(toasterTheme("/app", null, "dark")).toBe("light");
    expect(toasterTheme("/home", "dark", "light")).toBe("light");
    expect(toasterTheme("/home", null, "dark")).toBe("dark");
    expect(toasterTheme("/s/abc", "dark", undefined)).toBe("light");
    expect(toasterTheme(null, "dark", "dark")).toBe("dark");
  });

  it("Themenfarbe aus dem Vertrag", () => {
    expect(themeFarbe("light")).toBe(NEU_THEMEFARBE.light);
    expect(themeFarbe("dark")).toBe("#1c1c1e");
  });
});

describe("GlassProvider: gesteuertes theme", () => {
  const quellen = (explicitTheme?: "light" | "dark", systemTheme: "light" | "dark" = "light"): PreferenceSources => ({
    explicit: explicitTheme ? { theme: explicitTheme } : {},
    system: { theme: systemTheme, quality: "high", reduceMotion: false, reduceTransparency: false },
  });

  it("theme schlägt gespeicherte Vorlieben (glassy-ui-preferences) und defaultTheme", () => {
    expect(effectivePreferences(quellen("dark"), "light", "light").theme).toBe("light");
    expect(effectivePreferences(quellen("light"), "light", "dark").theme).toBe("dark");
    expect(effectivePreferences(quellen(undefined, "dark"), "light", "dark").theme).toBe("dark");
  });

  it("ohne theme bleibt das alte Verhalten (Vorlieben vor defaultTheme vor System)", () => {
    expect(effectivePreferences(quellen("dark"), "light").theme).toBe("dark");
    expect(effectivePreferences(quellen(undefined, "dark"), "light").theme).toBe("light");
    expect(effectivePreferences(quellen(undefined, "dark")).theme).toBe("dark");
  });

  it("lässt die übrigen Vorlieben stehen", () => {
    const p = effectivePreferences(
      { explicit: { mode: "tinted", reduceMotion: true }, system: quellen().system },
      "light",
      "dark"
    );
    expect(p).toMatchObject({ theme: "dark", mode: "tinted", reduceMotion: true });
  });
});
