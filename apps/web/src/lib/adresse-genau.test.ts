import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { adresseGenau } from "./adresse-genau";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("adresseGenau", () => {
  it.each([
    "Heilbronner Str. 339, 70469 Stuttgart",
    "Hauptstr. 5, Esslingen",
    "Am Kräherwald 12a 70193 Stuttgart",
    "Königstraße 1-3, 70173 Stuttgart",
    "Rue de l'Église 4, Strasbourg",
    "Weg 7 / 2, 72070 Tübingen",
  ])("genau: %s", (a) => {
    const r = adresseGenau(a);
    expect(r.genau).toBe(true);
    expect(r.schluessel).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    "Stuttgart",
    "70469 Stuttgart",
    "Hauptstraße 12",
    "Umzug innerhalb Stuttgart",
    "innerhalb Esslingen 3 Zimmer",
    "Stuttgart 70469",
  ])("ungenau: %s", (a) => {
    const r = adresseGenau(a);
    expect(r.genau).toBe(false);
    expect(r.text).toBe(a);
    expect(r.schluessel).toBeNull();
  });

  it("ohne Adresse: kein Text", () => {
    for (const a of [null, undefined, "", "   ", 42, {}]) {
      expect(adresseGenau(a)).toEqual({ genau: false, text: null, schluessel: null });
    }
  });

  it("Schlüssel: klein, Leerzeichen zusammengezogen, sha256-Hex", () => {
    const a = adresseGenau("  Heilbronner   Str. 339,  70469 STUTTGART ");
    expect(a.text).toBe("Heilbronner Str. 339, 70469 STUTTGART");
    expect(a.schluessel).toBe(sha("heilbronner str. 339, 70469 stuttgart"));
    expect(adresseGenau("heilbronner str. 339, 70469 stuttgart").schluessel).toBe(a.schluessel);
  });
});
