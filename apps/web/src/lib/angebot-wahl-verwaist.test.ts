import { describe, expect, it } from "vitest";
import type { Uebersteuerung } from "./kalkulation-versionen";
import { verwaisteZeilenUebersteuerungen } from "./angebot-wahl";

function zeile(id: string, key: string, wert: number | null): Uebersteuerung {
  return {
    id, art: "zeile", key, rechnerwert: null, wert, grund: "g",
    autor: { userId: "usr_1", quelle: "mensch" }, zeit: "2026-11-07T08:00:00.000Z", fotoRef: null,
  };
}

const hier = "fahrzeug.sprinter@sixt-muc-ost.miete";
const dort = "fahrzeug.sprinter@sixt-feuerbach.miete";
const kraftstoff = "fahrzeug.sprinter@sixt-muc-ost.kraftstoff";

describe("verwaisteZeilenUebersteuerungen", () => {
  it("Station: gleiche Klasse und gleicher Teil an einer anderen Station ist Kandidat", () => {
    const aus = verwaisteZeilenUebersteuerungen(
      [zeile("u1", "fahrzeug.sprinter@alte-station.miete", 100)],
      [{ key: hier }, { key: kraftstoff }, { key: dort }]
    );
    expect(aus).toEqual([{ id: "u1", key: "fahrzeug.sprinter@alte-station.miete", kandidaten: [dort, hier] }]);
  });

  it("Klasse: andere Klasse hat keinen Kandidaten", () => {
    const aus = verwaisteZeilenUebersteuerungen(
      [zeile("u1", "fahrzeug.transporter@alte-station.miete", 80)],
      [{ key: hier }]
    );
    expect(aus).toEqual([{ id: "u1", key: "fahrzeug.transporter@alte-station.miete", kandidaten: [] }]);
  });

  it("gelöscht (wert null) wirkt nicht mehr und ist nicht verwaist", () => {
    expect(
      verwaisteZeilenUebersteuerungen(
        [zeile("u1", "fahrzeug.sprinter@alte-station.miete", 100), zeile("u2", "fahrzeug.sprinter@alte-station.miete", null)],
        [{ key: hier }]
      )
    ).toEqual([]);
  });

  it("mehrfach: letzte Nennung je Schlüssel, mehrere verwaiste Zeilen", () => {
    const aus = verwaisteZeilenUebersteuerungen(
      [
        zeile("alt", hier, 90),
        zeile("neu", hier, 100),
        zeile("weg", "halteverbot", 10),
        zeile("sonst", "material.folie", 5),
      ],
      [{ key: hier }]
    );
    expect(aus).toEqual([
      { id: "weg", key: "halteverbot", kandidaten: [] },
      { id: "sonst", key: "material.folie", kandidaten: [] },
    ]);
  });

  it("vorhandene Zeile ist nicht verwaist", () => {
    expect(verwaisteZeilenUebersteuerungen([zeile("u1", hier, 100)], [{ key: hier }])).toEqual([]);
  });
});
