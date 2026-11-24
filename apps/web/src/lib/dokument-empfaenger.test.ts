import { describe, expect, it } from "vitest";
import { parseDokumentEmpfaenger, pruefeDokumentEmpfaenger, vertretenDurchZeile } from "./dokument-empfaenger";

describe("dokument_empfaenger", () => {
  it("baut die Zeile vertreten durch", () => {
    const wert = parseDokumentEmpfaenger({
      anrede: "sie",
      auftraggeber: { anrede: "frau", name: "Angela Hermann", adresse: "Gartenstr. 1, 72218 Wildberg" },
      vertretenDurch: { name: "Elisabeth Bath", rolle: "gesetzliche_betreuerin" },
    });
    expect(vertretenDurchZeile(wert.vertretenDurch)).toBe(
      "vertreten durch Elisabeth Bath (gesetzliche Betreuerin)"
    );
    expect(wert.auftraggeber).toMatchObject({ anrede: "frau", name: "Angela Hermann" });
    expect(wert.anrede).toBe("sie");
  });

  it("lehnt eine unbekannte Rolle ab und verwirft leere Namen", () => {
    expect(pruefeDokumentEmpfaenger({ vertretenDurch: { name: "Eva", rolle: "vormund" } }).ok).toBe(false);
    expect(parseDokumentEmpfaenger({ auftraggeber: { name: "  " }, anrede: "ihr" })).toEqual({
      anrede: null,
      auftraggeber: null,
      vertretenDurch: null,
    });
  });
});
