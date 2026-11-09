import { describe, expect, it } from "vitest";
import { korrekturPayload, pruefeGroesseVolumen, type InventarStand } from "./inventar-korrektur";

const foto: InventarStand = { name: "Gartensessel", quantity: 2, sizeClass: "mittel", volumeCbmEstimate: "1.2", source: "foto", photoAttachmentId: "att_1" };

describe("korrekturPayload (Bauteil 14, Lernen)", () => {
  it("Foto erkannt: Gartensessel, korrigiert: Gartengrill", () => {
    const p = korrekturPayload("it_1", foto, { ...foto, name: "Gartengrill", source: "operator" });
    expect(p).toMatchObject({ art: "geaendert", ausFoto: true, fotoId: "att_1", text: "Foto erkannt: Gartensessel, korrigiert: Gartengrill" });
    expect(p.vorher).toEqual({ name: "Gartensessel", menge: 2, groesse: "mittel", volumenCbm: 0.6 });
  });
  it("Entfernen und Hinzufügen", () => {
    expect(korrekturPayload("it_1", foto, null)).toMatchObject({ art: "entfernt", ausFoto: true, text: "Foto erkannt: Gartensessel, entfernt (falsch erkannt)" });
    expect(korrekturPayload("it_2", null, { ...foto, name: "Klavier", source: "operator" })).toMatchObject({ art: "hinzugefuegt", ausFoto: false, text: "Hinzugefügt: Klavier" });
  });
});

describe("pruefeGroesseVolumen", () => {
  it("m³ je Stück wird zur Zeile × Menge", () => {
    expect(pruefeGroesseVolumen({ sizeClass: "gross", volumeCbmPerPiece: "0,8" }, 3)).toEqual({ ok: true, patch: { sizeClass: "gross", volumeCbmEstimate: "2.4" } });
    expect(pruefeGroesseVolumen({ sizeClass: "riesig" }, 1)).toMatchObject({ ok: false });
    expect(pruefeGroesseVolumen({ volumeCbmPerPiece: 0 }, 1)).toMatchObject({ ok: false });
    expect(pruefeGroesseVolumen({}, 1)).toEqual({ ok: true, patch: {} });
  });
});
