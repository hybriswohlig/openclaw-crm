import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Wächter für die Navigation (Sidebar, mobile Tab-Leiste und Kopfzeile,
// Befehlspalette, Topbar): Jeder Link und jeder API-Aufruf in diesem Ordner
// muss auf eine Seite bzw. Route zeigen, die es im App-Router wirklich gibt.
// Wird eine Seite entfernt (zuletzt der KI-Chat und der Datenbank-Admin),
// bleibt so kein Eintrag stehen, der ins Leere führt. Die Dateien werden als Text gelesen wie in
// lib/mcp/tool-names.test.ts, damit der Test keine Client-Komponenten lädt.

const LAYOUT_DIR = fileURLToPath(new URL("./", import.meta.url));
const APP_DIR = fileURLToPath(new URL("../../app/", import.meta.url));

/** Platzhalter für `${…}` in Template-Pfaden, passt nur auf dynamische Segmente. */
const DYNAMISCH = "${…}";

interface Fund {
  datei: string;
  ziel: string;
}

function alleTreffer(quelle: string, muster: RegExp): string[] {
  return [...quelle.matchAll(muster)].map((m) => m[1]);
}

function ohneTemplateTeile(pfad: string): string {
  return pfad.replace(/\$\{[^}]*\}/g, DYNAMISCH);
}

/**
 * Seitenziele: href/url-Literale, router.push/replace und navigate() mit
 * festem Pfad, Template-hrefs und die Titel-Präfixe der mobilen Kopfzeile
 * (`[/^\/tasks/, "Aufgaben"]`).
 */
function seitenZiele(quelle: string): string[] {
  return [
    ...alleTreffer(quelle, /\b(?:href|url)\s*[:=]\s*"(\/[^"]*)"/g),
    ...alleTreffer(quelle, /\b(?:router\.(?:push|replace)|navigate)\(\s*"(\/[^"]*)"/g),
    ...alleTreffer(quelle, /\bhref=\{`(\/[^`]*)`\}/g).map(ohneTemplateTeile),
    ...alleTreffer(quelle, /\[\/\^((?:\\\/[\w-]+)+)\/\s*,/g).map((t) => t.replace(/\\\//g, "/")),
  ];
}

/** API-Ziele: fetch() auf einen festen oder Template-Pfad unter /api. */
function apiZiele(quelle: string): string[] {
  return alleTreffer(quelle, /\bfetch\(\s*["'`](\/api\/(?:\$\{[^}]*\}|[^"'`?#$])*)/g).map(
    ohneTemplateTeile
  );
}

/**
 * URL-Segmente aller Ordner unter app/, die eine passende Datei enthalten.
 * Routengruppen wie „(dashboard)“ und Slots wie „@modal“ stehen nicht in der URL.
 */
function sammleRouten(dateiname: RegExp, dir = APP_DIR, segmente: string[] = []): string[][] {
  const routen: string[][] = [];
  for (const eintrag of readdirSync(dir, { withFileTypes: true })) {
    if (eintrag.isDirectory()) {
      const name = eintrag.name;
      const unsichtbar = (name.startsWith("(") && name.endsWith(")")) || name.startsWith("@");
      routen.push(
        ...sammleRouten(dateiname, join(dir, name), unsichtbar ? segmente : [...segmente, name])
      );
    } else if (dateiname.test(eintrag.name)) {
      routen.push(segmente);
    }
  }
  return routen;
}

const SEITEN = sammleRouten(/^page\.(tsx|ts|jsx|js|mdx)$/);
const API_ROUTEN = sammleRouten(/^route\.(ts|js)$/);

function passt(route: string[], ziel: string[]): boolean {
  for (let i = 0; i < route.length; i++) {
    const teil = route[i];
    if (teil.startsWith("[[...")) return true;
    if (teil.startsWith("[...")) return ziel.length > i;
    if (i >= ziel.length) return false;
    if (teil.startsWith("[")) continue;
    if (teil !== ziel[i]) return false;
  }
  return route.length === ziel.length;
}

function existiert(routen: string[][], ziel: string): boolean {
  const teile = ziel.split(/[?#]/)[0].split("/").filter(Boolean);
  return routen.some((route) => passt(route, teile));
}

// mobile-nav.ts hält die Ziele der mobilen Leiste (mobile-tab-bar.tsx rendert sie).
const DATEIEN = readdirSync(LAYOUT_DIR)
  .filter((name) => name.endsWith(".tsx") || name === "mobile-nav.ts")
  .sort()
  .map((datei) => ({ datei, quelle: readFileSync(join(LAYOUT_DIR, datei), "utf8") }));

const SEITEN_FUNDE: Fund[] = DATEIEN.flatMap(({ datei, quelle }) =>
  seitenZiele(quelle).map((ziel) => ({ datei, ziel }))
);
const API_FUNDE: Fund[] = DATEIEN.flatMap(({ datei, quelle }) =>
  apiZiele(quelle).map((ziel) => ({ datei, ziel }))
);

describe("Navigation zeigt nur auf vorhandene Seiten und Routen", () => {
  it("findet die Ziele überhaupt, sonst wäre der Wächter wirkungslos", () => {
    for (const datei of ["sidebar.tsx", "mobile-nav.ts", "mobile-top-bar.tsx", "command-palette.tsx"]) {
      expect(SEITEN_FUNDE.some((f) => f.datei === datei), datei).toBe(true);
    }
    expect(SEITEN_FUNDE.map((f) => f.ziel)).toEqual(
      expect.arrayContaining(["/home", "/inbox", "/settings", "/objects/deals", `/lists/${DYNAMISCH}`])
    );
    expect(API_FUNDE.map((f) => f.ziel)).toEqual(
      expect.arrayContaining(["/api/v1/notifications", "/api/v1/search", "/api/v1/inbox/unread-count"])
    );
  });

  it("unterscheidet vorhandene von fehlenden Zielen", () => {
    expect(existiert(SEITEN, "/objects/people")).toBe(true);
    expect(existiert(SEITEN, "/notes?create=1")).toBe(true);
    expect(existiert(SEITEN, `/lists/${DYNAMISCH}`)).toBe(true);
    expect(existiert(SEITEN, "/gibt-es-nicht")).toBe(false);
    // Ein dynamischer Link passt nie auf ein festes Segment.
    expect(existiert(SEITEN, `/${DYNAMISCH}`)).toBe(false);
    expect(existiert(API_ROUTEN, "/api/v1/tasks")).toBe(true);
    expect(existiert(API_ROUTEN, "/api/v1/gibt-es-nicht")).toBe(false);
  });

  it("jeder Link führt auf eine Seite, die es gibt", () => {
    expect(SEITEN_FUNDE.filter((f) => !existiert(SEITEN, f.ziel))).toEqual([]);
  });

  it("jeder API-Aufruf trifft eine Route, die es gibt", () => {
    expect(API_FUNDE.filter((f) => !existiert(API_ROUTEN, f.ziel))).toEqual([]);
  });

  it("kein Eintrag führt mehr zum entfernten KI-Chat", () => {
    expect(existiert(SEITEN, "/chat")).toBe(false);
    expect(existiert(API_ROUTEN, "/api/v1/chat/completions")).toBe(false);
    const zumChat = [...SEITEN_FUNDE, ...API_FUNDE].filter((f) =>
      /^\/(?:api\/v1\/)?chat(?:[/?#]|$)/.test(f.ziel)
    );
    expect(zumChat).toEqual([]);
  });

  it("kein Eintrag führt mehr zum entfernten Datenbank-Admin, die KI-Aufgaben bleiben", () => {
    expect(existiert(SEITEN, "/admin/database")).toBe(false);
    expect(existiert(API_ROUTEN, "/api/admin/db/me")).toBe(false);
    expect(existiert(SEITEN, "/admin/ai-tasks")).toBe(true);
    const zumAdmin = [...SEITEN_FUNDE, ...API_FUNDE].filter((f) =>
      /^\/(?:admin\/database|api\/admin\/db)(?:[/?#]|$)/.test(f.ziel)
    );
    expect(zumAdmin).toEqual([]);
  });
});
