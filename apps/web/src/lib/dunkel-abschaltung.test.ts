import { describe, expect, it } from "vitest";
import {
  COOKIE_MAX_ALTER_S,
  DARSTELLUNG_COOKIE,
  FILL_DECKEND,
  KUERZEL_FARBEN,
  TEXT_TOKENS,
  TOKENS,
  cookieWert,
  cookieZeile,
  darstellungLesen,
  farbeLesen,
  harteFarben,
  istNeuPfad,
  kontrast,
  minKontrast,
  themeAus,
  ueber,
} from "./dunkel-abschaltung";

// ─── 1. Darstellung ─────────────────────────────────────────────────────────

describe("1. Darstellung", () => {
  it("liest nur die drei gültigen Werte", () => {
    expect(darstellungLesen("hell")).toBe("hell");
    expect(darstellungLesen("dunkel")).toBe("dunkel");
    expect(darstellungLesen("system")).toBe("system");
    for (const roh of [null, undefined, "", "dark", "Hell", " hell"]) expect(darstellungLesen(roh)).toBeNull();
  });

  it("leitet das Theme ab; ohne Wert folgt es dem Gerät", () => {
    expect(themeAus("hell", true)).toBe("light");
    expect(themeAus("dunkel", false)).toBe("dark");
    expect(themeAus("system", true)).toBe("dark");
    expect(themeAus("system", false)).toBe("light");
    expect(themeAus(null, true)).toBe("dark");
    expect(themeAus(null, false)).toBe("light");
  });

  it("kennt nur /app und Unterpfade als neue Oberfläche", () => {
    expect(istNeuPfad("/app")).toBe(true);
    expect(istNeuPfad("/app/heute")).toBe(true);
    expect(istNeuPfad("/apple")).toBe(false);
    expect(istNeuPfad("/s/abc")).toBe(false);
    expect(istNeuPfad("/home")).toBe(false);
  });

  it("baut die Cookie-Zeile mit Pfad, Alter und SameSite", () => {
    expect(cookieZeile(DARSTELLUNG_COOKIE, "dunkel", false)).toBe(
      `neu_darstellung=dunkel; Path=/; Max-Age=${COOKIE_MAX_ALTER_S}; SameSite=Lax`
    );
    expect(cookieZeile("x", "a b", true)).toMatch(/^x=a%20b; .*; Secure$/);
  });

  it("liest einen Cookie-Wert und verträgt kaputte Kodierung", () => {
    expect(cookieWert("a=1; neu_darstellung=hell; b=2", DARSTELLUNG_COOKIE)).toBe("hell");
    expect(cookieWert("neu_darstellung=a%3Db", DARSTELLUNG_COOKIE)).toBe("a=b");
    expect(cookieWert("x=1", DARSTELLUNG_COOKIE)).toBeNull();
    expect(cookieWert("neu_darstellung=%E0%A4%A", DARSTELLUNG_COOKIE)).toBeNull();
  });
});

// ─── 2. Tokens ──────────────────────────────────────────────────────────────

describe("2. Tokens", () => {
  it("hat für jedes Token einen lesbaren Hell- und Dunkelwert", () => {
    for (const [name, { hell, dunkel }] of Object.entries(TOKENS)) {
      expect(farbeLesen(hell), `${name} hell`).not.toBeNull();
      expect(farbeLesen(dunkel), `${name} dunkel`).not.toBeNull();
    }
  });

  it("deckt alle Text-Tokens ab und nutzt Anthrazit als Seitenende", () => {
    for (const t of TEXT_TOKENS) expect(TOKENS[t], t).toBeDefined();
    expect(TOKENS["--seite-unten"].dunkel).toBe("#1c1c1e");
    expect(FILL_DECKEND).toEqual({ light: "#ffffff", dark: "#2c2c2e" });
  });

  it("beginnt die Kürzel-Farben mit der dunklen Fläche statt mit --ink", () => {
    expect(KUERZEL_FARBEN[0]).toBe("var(--tinte-flaeche)");
    expect(new Set(KUERZEL_FARBEN).size).toBe(KUERZEL_FARBEN.length);
  });
});

// ─── 3. Kontrast ────────────────────────────────────────────────────────────

describe("3. Kontrast", () => {
  it("liest Hex, rgb und rgba", () => {
    expect(farbeLesen("#ff0080")).toEqual({ r: 255, g: 0, b: 128, a: 1 });
    expect(farbeLesen("rgba(44, 44, 46, 0.52)")).toEqual({ r: 44, g: 44, b: 46, a: 0.52 });
    expect(farbeLesen("rgb(0 0 0 / 0.5)")).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(farbeLesen("#fff")).toBeNull();
    expect(farbeLesen("var(--ink)")).toBeNull();
  });

  it("legt Farben übereinander", () => {
    expect(ueber("#000000", "#ffffff")).toBe("#000000");
    expect(ueber("rgba(0, 0, 0, 0)", "#ffffff")).toBe("#ffffff");
    expect(ueber("rgba(0, 0, 0, 0.5)", "#ffffff")).toBe("#808080");
    expect(ueber("rgba(255, 255, 255, 0.52)", "#faf9f7")).toBe("#fdfcfb");
    expect(() => ueber("var(--x)", "#ffffff")).toThrow(/nicht lesbar/);
  });

  it("rechnet den WCAG-Kontrast", () => {
    expect(kontrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(kontrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(kontrast("#777777", "#777777")).toBeCloseTo(1, 5);
    expect(kontrast("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });

  it.each(TEXT_TOKENS.flatMap((t) => (["hell", "dunkel"] as const).map((theme) => [t, theme] as const)))(
    "%s hält im Theme %s auf jeder Fläche 4,5:1",
    (t, theme) => {
      expect(minKontrast(t, theme)).toBeGreaterThanOrEqual(4.5);
    }
  );

  it("liegt in den Spannen der Probe (hell 5,2 bis 14,4, dunkel 6,4 bis 12,8)", () => {
    const hell = TEXT_TOKENS.map((t) => minKontrast(t, "hell"));
    const dunkel = TEXT_TOKENS.map((t) => minKontrast(t, "dunkel"));
    expect(Math.min(...hell)).toBeGreaterThan(5.1);
    expect(Math.max(...hell)).toBeLessThan(14.5);
    expect(Math.min(...dunkel)).toBeGreaterThan(6.3);
    expect(Math.max(...dunkel)).toBeLessThan(12.9);
  });
});

// ─── 4. Wächter gegen harte Farben ──────────────────────────────────────────

describe("4. harteFarben", () => {
  const befunde = (css: string) => harteFarben(css, "neu-x.css").map((b) => `${b.zeile}:${b.text}`);

  it("meldet Hex, rgb und rgba in Deklarationen mit Zeile und Text", () => {
    const css = [".a {", "  background: #ffffff;", "  border: 1px solid rgba(0, 0, 0, 0.1);", "  color: rgb(34 34 36);", "}"].join("\n");
    expect(harteFarben(css, "neu-x.css")).toEqual([
      { datei: "neu-x.css", zeile: 2, text: "background: #ffffff;" },
      { datei: "neu-x.css", zeile: 3, text: "border: 1px solid rgba(0, 0, 0, 0.1);" },
      { datei: "neu-x.css", zeile: 4, text: "color: rgb(34 34 36);" },
    ]);
  });

  it("meldet rgb( auch im Schatten", () => {
    expect(befunde(".a {\n  box-shadow: 0 1px 2px rgb(0 0 0 / 0.06);\n}")).toEqual(["2:box-shadow: 0 1px 2px rgb(0 0 0 / 0.06);"]);
  });

  it("erlaubt Token-Definitionen", () => {
    expect(befunde("[data-neu] {\n  --ink: #222224;\n  --shadow: 0 1px 2px rgb(0 0 0 / 0.06);\n}")).toEqual([]);
  });

  it("erlaubt weiße Schrift, aber keine andere Hex-Schrift", () => {
    expect(befunde(".a {\n  color: #fff;\n  color: #FFFFFF;\n}")).toEqual([]);
    expect(befunde(".a {\n  color: #ffe;\n}")).toEqual(["2:color: #ffe;"]);
  });

  it("erlaubt Zeilen mit /* fest */", () => {
    expect(befunde(".logo {\n  background: #ffffff; /* fest */\n}")).toEqual([]);
    expect(befunde(".logo {\n  background: #ffffff; /* fest */ /* Logo-Kachel */\n}")).toEqual([]);
  });

  it("verbietet Akzentfarben als Textfarbe, nicht als Fläche oder *-ink", () => {
    expect(befunde(".a {\n  color: var(--blue);\n  color: var(--rose) ;\n}")).toEqual(["2:color: var(--blue);", "3:color: var(--rose) ;"]);
    expect(befunde(".a {\n  background: var(--blue);\n  color: var(--blue-ink);\n  outline: 2px solid var(--jade);\n}")).toEqual([]);
  });

  it("überspringt Kommentare, auch über mehrere Zeilen", () => {
    const css = ["/* Farben:", "  background: #000000;", "  ende */ .a {", "  color: #123456;", "}", "/* color: #abcdef; */"].join("\n");
    expect(befunde(css)).toEqual(["4:color: #123456;"]);
  });

  it("meldet Code nach dem Ende eines mehrzeiligen Kommentars", () => {
    const css = ["/* a", "b */ background: #101010;"].join("\n");
    expect(befunde(css)).toEqual(["2:b */ background: #101010;"]);
  });

  it("ignoriert Selektoren und Hex-ähnliche Namen ohne Deklaration", () => {
    expect(befunde("#kopf .a,\n.b {\n  width: 10px;\n}")).toEqual([]);
  });
});
