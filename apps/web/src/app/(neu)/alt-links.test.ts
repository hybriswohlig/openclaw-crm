import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { umleitZiel } from "@/lib/dunkel-abschaltung";
import { altUmleitung } from "@/lib/handy-links";

/**
 * Plan 14, Task U: jeder Literale Pfad aus der neuen Oberfläche, den die
 * Middleware umleiten würde, geht durch `mitAlt` oder trägt schon `alt=1`.
 * In Vorlagen ersetzt `x1` den ersten Ausdruck (`/objects/deals/${id}`);
 * Text danach (etwa `?tab=`) bleibt Teil des Pfads.
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const AUSGENOMMEN = new Set(["lib/dunkel-abschaltung.ts", "lib/handy-links.ts"]);

function dateien(): string[] {
  const aus: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "__fixtures__" || name === "fixtures") continue;
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (/\.tsx?$/.test(name) && !name.includes(".test.") && !name.includes(".fixture.")) aus.push(abs);
    }
  };
  walk(join(SRC, "components/neu"));
  walk(join(SRC, "app/(neu)"));
  for (const name of readdirSync(join(SRC, "lib"))) {
    const abs = join(SRC, "lib", name);
    // Fixtures sind Testeingaben (z. B. alte iCal-hrefs), keine gerenderten Links.
    if (statSync(abs).isFile() && name.endsWith(".ts") && !name.includes(".test.") && !name.includes(".fixture.")) aus.push(abs);
  }
  return aus;
}

/** Kommentare und Zeichenketten von links nach rechts, damit `//` in Texten nicht schluckt. */
const TOKEN = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;

function literale(src: string): { zeile: number; text: string; zeilentext: string }[] {
  const funde: { zeile: number; text: string; zeilentext: string }[] = [];
  const zeilen = src.split("\n");
  for (const m of src.matchAll(TOKEN)) {
    const roh = m[0];
    if (roh.startsWith("/*") || roh.startsWith("//")) continue;
    const quote = roh[0];
    let text = roh.slice(1, -1);
    if (quote === "`" && text.includes("${")) text = text.replace(/\$\{[^}]*\}/g, "x1");
    if (!text.startsWith("/")) continue;
    const zeile = src.slice(0, m.index ?? 0).split("\n").length;
    funde.push({ zeile, text, zeilentext: zeilen[zeile - 1] ?? "" });
  }
  return funde;
}

describe("Links der neuen Oberfläche in alte Seiten", () => {
  it("trägt alt=1, sobald die Middleware umleiten würde", () => {
    const treffer: string[] = [];
    for (const abs of dateien()) {
      const rel = abs.slice(SRC.length + 1);
      if (AUSGENOMMEN.has(rel)) continue;
      for (const fund of literale(readFileSync(abs, "utf8"))) {
        if (fund.zeilentext.includes("mitAlt(") || fund.text.includes("alt=1")) continue;
        const ohneHash = fund.text.split("#", 1)[0];
        const [pfad, abfrage = ""] = ohneHash.split("?");
        const params = new URLSearchParams(abfrage);
        const umleitung = umleitZiel(pfad, params) ?? altUmleitung(pfad, params, "neu");
        if (umleitung) treffer.push(`${rel}:${fund.zeile} ${JSON.stringify(fund.text)} -> ${umleitung}`);
      }
    }
    expect(treffer, treffer.join("\n")).toEqual([]);
  });
});
