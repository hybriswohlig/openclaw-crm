import { describe, expect, it } from "vitest";
import { postenErgebenFestpreis } from "./festpreis-posten";
import { postenAnNeuenFestpreisAnpassen, postenFuerSpeichern } from "./angebot-posten";

const formularPosten = [
  { type: "helper" as const, description: "Helfer", quantity: 2, unitRate: "35", sortOrder: 4 },
  { type: "transporter" as const, description: "Transporter", quantity: 1, unitRate: "25", sortOrder: 9 },
];

/** Kern (erster Posten) + Hebel, Summe 1950 + 300 + 169,80 = 2419,80 */
const kernUndHebel = [
  { type: "other" as const, description: "Umzugsteam (3 Personen) & Sprinter, inkl. Anfahrt", quantity: 1, unitRate: "1950.00", sortOrder: 0 },
  { type: "other" as const, description: "Halteverbot beidseitig", quantity: 1, unitRate: "300.00", sortOrder: 1 },
  { type: "other" as const, description: "60 Umzugskartons", quantity: 60, unitRate: "2.83", sortOrder: 2 }, // 169,80
];

/** Angebot nach „In Angebot übernehmen“: Festpreis mit Kern + Hebel */
const uebernommen = { isVariable: false, fixedPrice: "1720.00", lineItems: kernUndHebel };

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
      postenFuerSpeichern({ isVariable: false, fixedPrice: "1720.5", lineItems: [], geladen: { isVariable: false, fixedPrice: "1720.50", lineItems: [] } })
    ).toEqual({});
  });

  it("schickt beim geänderten Festpreis die angepassten Posten statt []", () => {
    const teil = postenFuerSpeichern({ isVariable: false, fixedPrice: "2600.00", lineItems: [], geladen: { isVariable: false, fixedPrice: "2480.00", lineItems: kernUndHebel } });
    expect(teil.lineItems?.[0].unitRate).toBe("2130.20");
    expect(body(teil).lineItems).toHaveLength(3);
  });

  it("leert die Posten, wenn der Festpreis gelöscht wurde", () => {
    expect(postenFuerSpeichern({ isVariable: false, fixedPrice: null, lineItems: [], geladen: uebernommen })).toEqual({ lineItems: [] });
  });

  it("leert die Posten bei geändertem Festpreis ohne geladene Aufschlüsselung", () => {
    expect(
      postenFuerSpeichern({ isVariable: false, fixedPrice: "1800", lineItems: [], geladen: { isVariable: false, fixedPrice: "1720.00", lineItems: [] } })
    ).toEqual({ lineItems: [] });
  });

  it("schickt [] beim Wechsel vom Stundensatz zum Festpreis (keine Aufschlüsselung vorhanden)", () => {
    const teil = postenFuerSpeichern({ isVariable: false, fixedPrice: "900.00", lineItems: [], geladen: { isVariable: true, fixedPrice: null, lineItems: [] } });
    expect(teil).toEqual({ lineItems: [] });
  });

  it("leert die Posten beim Wechsel vom Stundensatz zum Festpreis, auch wenn Stundensatz-Posten geladen sind", () => {
    const stundensatz = [{ type: "helper" as const, description: "Helfer", quantity: 2, unitRate: "35.00", sortOrder: 0 }];
    expect(
      postenFuerSpeichern({ isVariable: false, fixedPrice: "900", lineItems: formularPosten, geladen: { isVariable: true, fixedPrice: null, lineItems: stundensatz } })
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

describe("postenAnNeuenFestpreisAnpassen", () => {
  it("passt beim neuen Festpreis nur den Kern an, Hebel bleiben", () => {
    const neu = postenAnNeuenFestpreisAnpassen(kernUndHebel, "2600.00");
    expect(neu[0].unitRate).toBe("2130.20");
    expect(neu.slice(1)).toEqual(kernUndHebel.slice(1));
  });

  it("ergibt als Summe genau den neuen Festpreis", () => {
    const neu = postenAnNeuenFestpreisAnpassen(kernUndHebel, "2600.00");
    expect(postenErgebenFestpreis(neu, "2600.00")).toBe(true);
  });

  it("fällt auf eine Zeile zurück, wenn der Kern unter die Hälfte oder unter 0 rutscht", () => {
    const neu = postenAnNeuenFestpreisAnpassen(kernUndHebel, "500.00");
    expect(neu).toEqual([{ ...kernUndHebel[0], unitRate: "500.00" }]);
  });

  it("behält den Kern bei genau der Hälfte des Festpreises", () => {
    // Hebel 469,80; Festpreis 939,60 -> Kern 469,80 = 50 %
    const neu = postenAnNeuenFestpreisAnpassen(kernUndHebel, "939.60");
    expect(neu).toHaveLength(3);
    expect(neu[0].unitRate).toBe("469.80");
  });

  it("nimmt den ersten Posten nach sortOrder als Kern, auch bei durcheinander geladener Reihenfolge", () => {
    const neu = postenAnNeuenFestpreisAnpassen([kernUndHebel[2], kernUndHebel[0], kernUndHebel[1]], "2600.00");
    expect(neu.map((p) => p.sortOrder)).toEqual([0, 1, 2]);
    expect(neu[0].unitRate).toBe("2130.20");
  });

  it("setzt bei nur einem Posten den neuen Festpreis als Einzelpreis", () => {
    expect(postenAnNeuenFestpreisAnpassen([kernUndHebel[0]], "1800")).toEqual([{ ...kernUndHebel[0], unitRate: "1800.00" }]);
  });

  it("reicht nur die Felder von Posten weiter (keine id, quotationId, createdAt)", () => {
    const aus_db = kernUndHebel.map((p, i) => ({ ...p, id: `id-${i}`, quotationId: "q1", createdAt: "2026-11-01" }));
    const neu = postenAnNeuenFestpreisAnpassen(aus_db, "2600.00");
    expect(Object.keys(neu[1]).sort()).toEqual(["description", "quantity", "sortOrder", "type", "unitRate"]);
  });

  it("gibt ohne Posten eine leere Liste zurück", () => {
    expect(postenAnNeuenFestpreisAnpassen([], "1800")).toEqual([]);
  });
});
