import { expect, it } from "vitest";
import { nameAusWert } from "./personen-name";

it("liest Text, vollständigen Namen und Vor- plus Nachname in beiden Schreibweisen", () => {
  expect(nameAusWert("Max Berger", null)).toBe("Max Berger");
  expect(nameAusWert(null, { full_name: "Max Berger", first_name: "Max", last_name: "Berger" })).toBe("Max Berger");
  expect(nameAusWert(null, { fullName: "Erika Muster" })).toBe("Erika Muster");
  expect(nameAusWert(null, { first_name: "Max", last_name: "Berger" })).toBe("Max Berger");
  expect(nameAusWert(null, { firstName: "Erika", lastName: null })).toBe("Erika");
});

it("gibt ohne brauchbaren Namen null zurück", () => {
  expect(nameAusWert(null, null)).toBeNull();
  expect(nameAusWert("  ", { full_name: "  " })).toBeNull();
  expect(nameAusWert(null, "kein Objekt")).toBeNull();
});
