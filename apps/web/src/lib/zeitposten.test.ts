import { describe, expect, it } from "vitest";
import { pruefeZeitposten, ZeitpostenFehler } from "./zeitposten";

const vorlage = (n: number) => ({ id: `p${n}`, bezeichnung: `Posten ${n}`, minuten: 30 });

describe("pruefeZeitposten", () => {
  it("nimmt eine gültige Vorlage an", () => {
    expect(pruefeZeitposten([{ id: "klavier", bezeichnung: "Klavier", minuten: 90 }])).toEqual([
      { id: "klavier", bezeichnung: "Klavier", minuten: 90 },
    ]);
  });

  it("behält einen Hinweis und lässt ihn weg, wenn er leer ist", () => {
    expect(pruefeZeitposten([{ id: "klavier", bezeichnung: "Klavier", minuten: 90, hinweis: " Flügel " }])).toEqual([
      { id: "klavier", bezeichnung: "Klavier", minuten: 90, hinweis: "Flügel" },
    ]);
    expect(pruefeZeitposten([{ id: "klavier", bezeichnung: "Klavier", minuten: 90, hinweis: "  " }])).toEqual([
      { id: "klavier", bezeichnung: "Klavier", minuten: 90 },
    ]);
  });

  it("Minuten 0 wirft", () => {
    expect(() => pruefeZeitposten([{ id: "klavier", bezeichnung: "Klavier", minuten: 0 }])).toThrow(ZeitpostenFehler);
  });

  it("Minuten außerhalb 1–600 oder nicht ganzzahlig werfen", () => {
    expect(() => pruefeZeitposten([{ id: "a", bezeichnung: "A", minuten: 601 }])).toThrow(ZeitpostenFehler);
    expect(() => pruefeZeitposten([{ id: "a", bezeichnung: "A", minuten: 1.5 }])).toThrow(ZeitpostenFehler);
    expect(() => pruefeZeitposten([{ id: "a", bezeichnung: "A", minuten: "90" }])).toThrow(ZeitpostenFehler);
    expect(pruefeZeitposten([{ id: "a", bezeichnung: "A", minuten: 1 }])).toEqual([{ id: "a", bezeichnung: "A", minuten: 1 }]);
    expect(pruefeZeitposten([{ id: "a", bezeichnung: "A", minuten: 600 }])).toEqual([{ id: "a", bezeichnung: "A", minuten: 600 }]);
  });

  it("Bezeichnung muss 1–80 Zeichen haben", () => {
    expect(() => pruefeZeitposten([{ id: "a", bezeichnung: "  ", minuten: 10 }])).toThrow(ZeitpostenFehler);
    expect(() => pruefeZeitposten([{ id: "a", bezeichnung: "x".repeat(81), minuten: 10 }])).toThrow(ZeitpostenFehler);
    expect(pruefeZeitposten([{ id: "a", bezeichnung: "x".repeat(80), minuten: 10 }])[0]?.bezeichnung).toHaveLength(80);
  });

  it("doppelte id wirft", () => {
    expect(() =>
      pruefeZeitposten([
        { id: "klavier", bezeichnung: "Klavier", minuten: 90 },
        { id: "klavier", bezeichnung: "Noch ein Klavier", minuten: 30 },
      ])
    ).toThrow(ZeitpostenFehler);
  });

  it("51 Einträge werfen, 50 bleiben", () => {
    expect(() => pruefeZeitposten(Array.from({ length: 51 }, (_, i) => vorlage(i + 1)))).toThrow(ZeitpostenFehler);
    expect(pruefeZeitposten(Array.from({ length: 50 }, (_, i) => vorlage(i + 1)))).toHaveLength(50);
  });

  it("keine Liste und kaputte Einträge werfen", () => {
    expect(() => pruefeZeitposten(null)).toThrow(ZeitpostenFehler);
    expect(() => pruefeZeitposten({})).toThrow(ZeitpostenFehler);
    expect(() => pruefeZeitposten([{ bezeichnung: "Klavier", minuten: 90 }])).toThrow(ZeitpostenFehler);
  });
});
