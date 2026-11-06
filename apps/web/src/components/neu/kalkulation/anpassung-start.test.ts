import { describe, expect, it } from "vitest";
import type { AnpassungAnsicht } from "@/lib/kalkulations-ansicht";
import { startFuer } from "./anpassung-start";

const basis = { id: "u", von: "Dario", am: "04.11. 10:48", grund: "g" };

describe("startFuer: bestehende Anpassung mit Wert vorbelegen (M6)", () => {
  it("Marge, Satz und Kostenzeile tragen ihre Zahl", () => {
    expect(startFuer({ ...basis, art: "marge", key: "marge", text: "Marge: 38 %", wert: 38 })).toEqual({ art: "marge", prozent: 38 });
    expect(startFuer({ ...basis, art: "satz", key: "fahrt", text: "Fahrtsatz: 18 €/h", wert: 18 })).toEqual({ art: "satz", key: "fahrt", satz: 18 });
    expect(startFuer({ ...basis, art: "zeile", key: "halteverbot", text: "Halteverbot: 130 €", wert: 130 })).toEqual({
      art: "zeile", key: "halteverbot", label: "Halteverbot", aktuell: null, betrag: 130,
    });
  });

  it("Zeitposten und Material tragen Bezeichnung und Minuten bzw. Betrag aus dem Posten", () => {
    const z: AnpassungAnsicht = { ...basis, art: "zeitposten", key: "wandschrank", text: "Wandschrank, Demontage + Aufbau: +1,5 h Arbeit", wert: { bezeichnung: "Wandschrank, Demontage + Aufbau", minuten: 90 } };
    expect(startFuer(z)).toEqual({ art: "zeitposten", key: "wandschrank", bezeichnung: "Wandschrank, Demontage + Aufbau", minuten: 90 });
    const m: AnpassungAnsicht = { ...basis, art: "material_frei", key: "folie", text: "Extra Folie: 25 €", wert: { bezeichnung: "Extra Folie", betrag: 25 } };
    expect(startFuer(m)).toEqual({ art: "material_frei", key: "folie", bezeichnung: "Extra Folie", betrag: 25 });
  });

  it("Eingabe trägt den Wert (Zahl, Text, ja/nein); ohne Wert bleibt er offen", () => {
    expect(startFuer({ ...basis, art: "eingabe", key: "halteverbot.beladen", text: "beim Beladen: ja", wert: true })).toEqual({ art: "eingabe", key: "halteverbot.beladen", wert: true });
    expect(startFuer({ ...basis, art: "eingabe", key: "beladen.aufzug", text: "Aufzug beim Beladen: kleiner Aufzug", wert: "klein" })).toEqual({ art: "eingabe", key: "beladen.aufzug", wert: "klein" });
    expect(startFuer({ ...basis, art: "eingabe", key: "team", text: "Team: 4", wert: null })).toEqual({ art: "eingabe", key: "team", wert: undefined });
  });
});
