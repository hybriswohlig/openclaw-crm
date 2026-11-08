import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { viewport } from "./layout";

/**
 * Plan 14 (Entscheidung 11, K1 und K2): Das Kundenportal ist immer hell.
 * Kein Selektor mit `.dark`, keine Tailwind-Klasse `dark:` unter app/(public),
 * `color-scheme: light` am Portal und eine helle Themenfarbe für beide Schemata.
 * Die berechnete Farbe mit `.dark` an <html> prüft das Prüfraster im Browser.
 */

const PUBLIC = fileURLToPath(new URL("../../", import.meta.url));
const PORTAL_HELL = "#f6f7f9";

function dateien(ordner: string): string[] {
  return readdirSync(ordner).flatMap((name) => {
    const pfad = join(ordner, name);
    if (statSync(pfad).isDirectory()) return dateien(pfad);
    return /\.(css|tsx?)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [pfad] : [];
  });
}

const alle = dateien(PUBLIC);
const kurz = (pfad: string) => pfad.slice(PUBLIC.length);

/** Zeilen, die eine Regel erfüllen, als „datei:zeile: text“. */
function treffer(muster: RegExp, filter: (pfad: string) => boolean): string[] {
  return alle.filter(filter).flatMap((pfad) =>
    readFileSync(pfad, "utf8")
      .split("\n")
      .flatMap((z, i) => (muster.test(z) ? [`${kurz(pfad)}:${i + 1}: ${z.trim()}`] : []))
  );
}

describe("Portal immer hell", () => {
  it("liest Dateien unter app/(public), CSS und TSX", () => {
    expect(alle.some((p) => p.endsWith("portal.css"))).toBe(true);
    expect(alle.some((p) => p.endsWith("layout.tsx"))).toBe(true);
    expect(alle.filter((p) => p.endsWith(".tsx")).length).toBeGreaterThan(10);
  });

  it("hat keinen Selektor mit .dark", () => {
    expect(treffer(/\.dark\b/, () => true)).toEqual([]);
  });

  it("hat keine Tailwind-Klasse dark:", () => {
    // `dark:` direkt vor einer Klasse, nicht `dark: …` als Objektschlüssel (girocode-qr: Modulfarbe).
    expect(treffer(/(?:^|[\s"'`{(])dark:[\w[!-]/, (p) => /\.tsx?$/.test(p))).toEqual([]);
  });

  it("setzt color-scheme: only light am Portal, an <html> und im Viewport", () => {
    const css = readFileSync(join(PUBLIC, "s/[token]/portal.css"), "utf8");
    expect(css).toMatch(/\.kottke-portal\s*\{\s*color-scheme:\s*only light;\s*\}/);
    expect(css).toMatch(/html:has\(\.kottke-portal\)\s*\{\s*color-scheme:\s*only light !important;\s*\}/);
    expect(viewport.colorScheme).toBe("only light");
    expect(css).toContain(`html:has(.kottke-portal) body { background-color: ${PORTAL_HELL}; }`);
  });

  it("hat keine dunkle Themenfarbe im Viewport", () => {
    const farben = viewport.themeColor;
    expect(Array.isArray(farben)).toBe(true);
    const liste = farben as { media?: string; color: string }[];
    expect(liste.map((f) => f.media)).toEqual(["(prefers-color-scheme: light)", "(prefers-color-scheme: dark)"]);
    for (const f of liste) expect(f.color, f.media).toBe(PORTAL_HELL);
  });

  it("führt im Portal-Layout die helle Grundfarbe", () => {
    const css = readFileSync(join(PUBLIC, "s/[token]/portal.css"), "utf8");
    expect(css).toContain(`--portal-desk: ${PORTAL_HELL}`);
  });
});
