import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FILL_DECKEND, TOKENS, harteFarben, type FarbBefund } from "@/lib/dunkel-abschaltung";
import bestand from "./neu-farben-bestand.json";

/**
 * Plan 14a, Task F: Tokens der neuen Oberfläche und Wächter gegen harte Farben.
 * - neu.css trägt genau die Werte aus TOKENS (hell, dunkel, bewusst hell).
 * - Beide „Transparenz reduzieren“-Zweige haben einen Dunkel-Zweig.
 * - Keine neue harte Farbe in styles/neu*.css; der Bestand steht in
 *   neu-farben-bestand.json und wird in Plan 14b geleert.
 */

const ORDNER = fileURLToPath(new URL(".", import.meta.url));
const lies = (datei: string) => readFileSync(`${ORDNER}${datei}`, "utf8");

interface Regel {
  /** Selektor ohne Kommentare und überflüssige Leerzeichen. */
  selektor: string;
  /** Umgebende @-Regel, z. B. "@media (prefers-reduced-transparency: reduce)", sonst "". */
  at: string;
  /** Eigenschaften der Regel (ohne verschachtelte Regeln). */
  werte: Map<string, string>;
}

/** Kleiner CSS-Leser für neu.css: Regeln mit Selektor, @-Hülle und Deklarationen. */
function regeln(css: string): Regel[] {
  const ohneKommentare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Regel[] = [];
  const stapel: { kopf: string; rumpf: string }[] = [];
  let puffer = "";
  for (const z of ohneKommentare) {
    if (z === "{") {
      stapel.push({ kopf: puffer.trim().replace(/\s+/g, " "), rumpf: "" });
      puffer = "";
    } else if (z === "}") {
      const oben = stapel.pop();
      if (!oben) continue;
      oben.rumpf += puffer;
      puffer = "";
      if (!oben.kopf.startsWith("@")) {
        const werte = new Map<string, string>();
        for (const decl of oben.rumpf.split(";")) {
          const i = decl.indexOf(":");
          if (i < 0) continue;
          werte.set(decl.slice(0, i).trim(), decl.slice(i + 1).trim().replace(/\s+/g, " "));
        }
        const at = stapel.filter((s) => s.kopf.startsWith("@")).map((s) => s.kopf).join(" ");
        out.push({ selektor: oben.kopf, at, werte });
      }
    } else {
      puffer += z;
    }
  }
  return out;
}

const NEU = regeln(lies("neu.css"));
function regel(selektor: string, at = ""): Regel {
  const treffer = NEU.filter((r) => r.selektor === selektor && r.at === at);
  expect(treffer, `${at} ${selektor}`).toHaveLength(1);
  return treffer[0];
}

const HELL = '[data-neu]';
const DUNKEL = '[data-lg-theme="dark"] [data-neu]';
const HELL_FEST = '[data-lg-theme="dark"] [data-neu] .neu-hell-fest';
const MEDIA = "@media (prefers-reduced-transparency: reduce)";

describe("neu.css Tokens", () => {
  it.each(Object.entries(TOKENS))("%s steht hell, dunkel und bewusst hell mit dem Vertragswert", (name, { hell, dunkel }) => {
    expect(regel(HELL).werte.get(name)).toBe(hell);
    expect(regel(DUNKEL).werte.get(name)).toBe(dunkel);
    expect(regel(HELL_FEST).werte.get(name)).toBe(hell);
  });

  it("setzt im bewusst hellen Block die Schriftfarbe neu", () => {
    expect(regel(HELL_FEST).werte.get("color")).toBe("var(--ink)");
  });

  it("definiert keine Tokens aus TOKENS in anderen Dateien (z. B. die *-ink aus neu-akte.css)", () => {
    const namen = Object.keys(TOKENS);
    for (const datei of readdirSync(ORDNER).filter((d) => /^neu-.*\.css$/.test(d))) {
      for (const r of regeln(lies(datei))) {
        for (const n of namen) expect(r.werte.has(n), `${datei} ${r.selektor} ${n}`).toBe(false);
      }
    }
  });

  it("hat für beide Zweige „Transparenz reduzieren“ hell und dunkel deckende Flächen", () => {
    const zweige: [string, string, string][] = [
      [HELL, DUNKEL, MEDIA],
      [':root[data-lg-reduce-transparency="1"] [data-neu]', ':root[data-lg-reduce-transparency="1"][data-lg-theme="dark"] [data-neu]', ""],
    ];
    for (const [hell, dunkel, at] of zweige) {
      for (const f of ["--fill", "--fill-2", "--fill-3"]) {
        expect(regel(hell, at).werte.get(f), `${at} ${hell} ${f}`).toBe(FILL_DECKEND.light);
        expect(regel(dunkel, at).werte.get(f), `${at} ${dunkel} ${f}`).toBe(FILL_DECKEND.dark);
      }
    }
  });

  it("stellt die Dunkel-Zweige hinter die hellen (gleiche Spezifität gewinnt später)", () => {
    const css = lies("neu.css");
    const media = css.indexOf(MEDIA);
    expect(media).toBeGreaterThan(css.indexOf(`${DUNKEL} {`));
    const imMedia = css.slice(media);
    expect(imMedia.indexOf(`${DUNKEL} {`)).toBeGreaterThan(imMedia.indexOf(`${HELL} {`));
  });

  it("färbt den Body wie das Seitenende in beiden Themes", () => {
    expect(regel("body:has([data-neu])").werte.get("background-color")).toBe(TOKENS["--seite-unten"].hell);
    expect(regel('[data-lg-theme="dark"] body:has([data-neu])').werte.get("background-color")).toBe(
      TOKENS["--seite-unten"].dunkel
    );
  });
});

// ─── Wächter ────────────────────────────────────────────────────────────────

type Eintrag = Pick<FarbBefund, "datei" | "text">;
const schluessel = (e: Eintrag) => `${e.datei} | ${e.text}`;

/** Zählt Einträge je Datei und Zeilentext (gleiche Zeilen kommen mehrfach vor). */
function zaehlen(liste: readonly Eintrag[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of liste) m.set(schluessel(e), (m.get(schluessel(e)) ?? 0) + 1);
  return m;
}

/** Neue Stellen (nicht im Bestand) und aufgeräumte (im Bestand, aber nicht mehr da). */
function bestandVergleich(funde: readonly Eintrag[], liste: readonly Eintrag[]): { neu: string[]; aufraeumen: string[] } {
  const ist = zaehlen(funde);
  const soll = zaehlen(liste);
  const neu: string[] = [];
  const aufraeumen: string[] = [];
  for (const [k, n] of ist) for (let i = n - (soll.get(k) ?? 0); i > 0; i--) neu.push(k);
  for (const [k, n] of soll) for (let i = n - (ist.get(k) ?? 0); i > 0; i--) aufraeumen.push(k);
  return { neu, aufraeumen };
}

describe("Wächter gegen harte Farben in styles/neu*.css", () => {
  const dateien = readdirSync(ORDNER)
    .filter((d) => /^neu.*\.css$/.test(d))
    .sort();
  const funde = dateien.flatMap((d) => harteFarben(lies(d), d));

  it("findet alle neu*.css, auch neue Dateien der Pläne 9 bis 13", () => {
    expect(dateien).toContain("neu.css");
    expect(dateien).toContain("neu-akte.css");
  });

  it("hat keine harte Farbe außerhalb des Bestands", () => {
    const { neu } = bestandVergleich(funde, bestand);
    expect(
      neu,
      "Neue harte Farbe: Token aus neu.css nehmen (var(--flaeche), var(--fill-*), var(--hair), var(--*-ink)) oder bewusst feste Farbe mit /* fest */ markieren"
    ).toEqual([]);
  });

  it("führt keine Stelle im Bestand, die es nicht mehr gibt", () => {
    const { aufraeumen } = bestandVergleich(funde, bestand);
    expect(aufraeumen, "Bestand aufräumen: diese Einträge aus neu-farben-bestand.json löschen").toEqual([]);
  });

  it("vergleicht als Mehrfachmenge: eine zusätzliche gleiche Zeile ist neu, eine fehlende aufzuräumen", () => {
    const a = { datei: "neu-x.css", text: "background: #ffffff;" };
    expect(bestandVergleich([a, a], [a])).toEqual({ neu: [schluessel(a)], aufraeumen: [] });
    expect(bestandVergleich([a], [a, a])).toEqual({ neu: [], aufraeumen: [schluessel(a)] });
    expect(bestandVergleich([a], [a])).toEqual({ neu: [], aufraeumen: [] });
  });
});
