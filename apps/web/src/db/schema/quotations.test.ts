import { describe, expect, it } from "vitest";
import { kundenAnnahmen } from "./quotations";

describe("kundenAnnahmen", () => {
  it("entfernt interne Kalkulationsdaten, behält Kundenfelder", () => {
    const r = kundenAnnahmen({
      anfahrtMinuten: 55, anfahrtQuelle: "berechnet", etageVon: "3", etageBis: "0", zugangVon: "a", zugangBis: "b",
      inventarPositionen: 3, inventarVolumenCbm: 18.4, hinweis: "x",
      selbstkosten: 700, margeVorschlagProzent: 40, margeGruende: [{ text: "t", punkte: 1 }], margeGewaehltProzent: 30,
      margeTatsaechlichProzent: 30, uebernommenVon: "mensch", uebernommenAm: "2026-09-28T10:00:00.000Z",
    });
    expect(Object.keys(r!).sort()).toEqual(
      ["anfahrtMinuten", "anfahrtQuelle", "etageBis", "etageVon", "hinweis", "inventarPositionen", "inventarVolumenCbm", "zugangBis", "zugangVon"]
    );
    expect(r).toMatchObject({ anfahrtMinuten: 55, hinweis: "x" });
  });
  it("null und undefined bleiben null", () => {
    expect(kundenAnnahmen(null)).toBeNull();
    expect(kundenAnnahmen(undefined)).toBeNull();
  });
});
