import { describe, expect, it } from "vitest";
import { anhangArt, nachrichtText } from "./anhang";

describe("anhangArt", () => {
  it("keine Anhänge: null", () => {
    expect(anhangArt(0, 0)).toBeNull();
  });
  it("nur Bilder: foto", () => {
    expect(anhangArt(1, 1)).toBe("foto");
    expect(anhangArt(3, 3)).toBe("foto");
  });
  it("mindestens ein anderes Format: datei", () => {
    expect(anhangArt(1, 0)).toBe("datei");
    expect(anhangArt(3, 2)).toBe("datei");
  });
});

describe("nachrichtText", () => {
  it("Text gewinnt, sonst Betreff", () => {
    expect(nachrichtText("Hallo", "Betreff", 2, "foto")).toBe("Hallo");
    expect(nachrichtText("  ", "Ihr Angebot", 0, null)).toBe("Ihr Angebot");
  });
  it("ohne Text mit Bildern: Foto bzw. n Fotos", () => {
    expect(nachrichtText("", null, 1, "foto")).toBe("Foto");
    expect(nachrichtText(" \n", "", 3, "foto")).toBe("3 Fotos");
  });
  it("ohne Text mit anderen Anhängen: Anhang bzw. n Anhänge", () => {
    expect(nachrichtText("", null, 1, "datei")).toBe("Anhang");
    expect(nachrichtText("", null, 2, "datei")).toBe("2 Anhänge");
  });
  it("ganz leer: (ohne Text)", () => {
    expect(nachrichtText("", null, 0, null)).toBe("(ohne Text)");
  });
});
