import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GELOESCHTE_PFADE, geloeschtZiel } from "./dunkel-abschaltung";
import { ALTE_STARTSEITE, normalizeUiVersion } from "./ui-version";

describe("normalizeUiVersion", () => {
  it("akzeptiert die neue Oberfläche", () => {
    expect(normalizeUiVersion("neu")).toBe("neu");
  });

  it("akzeptiert die alte Oberfläche", () => {
    expect(normalizeUiVersion("alt")).toBe("alt");
  });

  it("lehnt unbekannte Werte ab", () => {
    expect(normalizeUiVersion("v3")).toBeNull();
  });

  it("lehnt fehlende Werte ab", () => {
    expect(normalizeUiVersion(undefined)).toBeNull();
  });
});

describe("ALTE_STARTSEITE", () => {
  it("ist eine alte Seite, die es noch gibt, und keine gelöschte", () => {
    const [pfad, abfrage] = ALTE_STARTSEITE.split("?");
    expect(abfrage).toBe("alt=1");
    expect(GELOESCHTE_PFADE).not.toContain(pfad);
    expect(geloeschtZiel(pfad, new URLSearchParams(abfrage))).toBeNull();
    const seite = fileURLToPath(new URL(`../app/(dashboard)${pfad}/page.tsx`, import.meta.url));
    expect(existsSync(seite), seite).toBe(true);
  });
});
