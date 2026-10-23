import { describe, expect, it } from "vitest";
import { postenFuerSpeichern } from "./angebot-posten";

const formularPosten = [
  { type: "helper" as const, description: "Helfer", quantity: 2, unitRate: "35", sortOrder: 4 },
  { type: "transporter" as const, description: "Transporter", quantity: 1, unitRate: "25", sortOrder: 9 },
];

/** Angebot nach „In Angebot übernehmen“: Festpreis mit Kern + Hebel */
const uebernommen = { isVariable: false, fixedPrice: "1720.00" };

function body(teil: ReturnType<typeof postenFuerSpeichern>) {
  return JSON.parse(JSON.stringify({ isVariable: false, fixedPrice: "1720.00", ...teil })) as Record<string, unknown>;
}

describe("postenFuerSpeichern", () => {
  it("lässt die Posten beim unveränderten Festpreis weg, damit Kern + Hebel bleiben", () => {
    const teil = postenFuerSpeichern({ isVariable: false, fixedPrice: "1720.00", lineItems: formularPosten, geladen: uebernommen });
    expect(teil).toEqual({});
    expect(body(teil)).not.toHaveProperty("lineItems");
  });

  it("vergleicht Beträge, nicht Schreibweisen", () => {
    expect(postenFuerSpeichern({ isVariable: false, fixedPrice: "1720", lineItems: [], geladen: uebernommen })).toEqual({});
    expect(
      postenFuerSpeichern({ isVariable: false, fixedPrice: "1720.5", lineItems: [], geladen: { isVariable: false, fixedPrice: "1720.50" } })
    ).toEqual({});
  });

  it("leert die Posten, wenn der Festpreis geändert wurde", () => {
    const teil = postenFuerSpeichern({ isVariable: false, fixedPrice: "1800", lineItems: formularPosten, geladen: uebernommen });
    expect(teil).toEqual({ lineItems: [] });
    expect(body(teil).lineItems).toEqual([]);
  });

  it("leert die Posten, wenn der Festpreis gelöscht wurde", () => {
    expect(postenFuerSpeichern({ isVariable: false, fixedPrice: null, lineItems: [], geladen: uebernommen })).toEqual({ lineItems: [] });
  });

  it("leert die Posten beim Wechsel vom Stundensatz zum Festpreis", () => {
    expect(
      postenFuerSpeichern({ isVariable: false, fixedPrice: "900", lineItems: formularPosten, geladen: { isVariable: true, fixedPrice: null } })
    ).toEqual({ lineItems: [] });
  });

  it("behandelt eine unlesbare Eingabe als geänderten Preis", () => {
    expect(postenFuerSpeichern({ isVariable: false, fixedPrice: "abc", lineItems: [], geladen: uebernommen })).toEqual({ lineItems: [] });
  });

  it("lässt die Posten ohne geladenes Angebot weg", () => {
    expect(postenFuerSpeichern({ isVariable: false, fixedPrice: "900", lineItems: formularPosten, geladen: null })).toEqual({});
  });

  it("schickt beim Stundensatz wie bisher die Posten aus dem Formular, neu durchnummeriert", () => {
    const erwartet = {
      lineItems: [
        { ...formularPosten[0], sortOrder: 0 },
        { ...formularPosten[1], sortOrder: 1 },
      ],
    };
    expect(postenFuerSpeichern({ isVariable: true, fixedPrice: null, lineItems: formularPosten, geladen: uebernommen })).toEqual(erwartet);
    expect(postenFuerSpeichern({ isVariable: true, fixedPrice: null, lineItems: formularPosten, geladen: null })).toEqual(erwartet);
  });
});
