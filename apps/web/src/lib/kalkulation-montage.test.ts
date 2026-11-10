import { describe, expect, it } from "vitest";
import { anfrageMitUebersteuerungen, pruefeUebersteuerung, UebersteuerungFehler, type Uebersteuerung } from "./kalkulation-versionen";

const u = (wert: Uebersteuerung["wert"], zeit = "2026-11-10T10:00:00Z"): Uebersteuerung => ({
  id: zeit,
  art: "montage",
  key: "moebel",
  rechnerwert: null,
  wert,
  grund: "Demontage/Montage je Möbel gewählt",
  autor: { userId: "u1", quelle: "mensch" },
  zeit,
  fotoRef: null,
});

describe("Übersteuerung montage (KV-Meldung 10.11., Punkt 3)", () => {
  it("prüft Schlüssel, Werte und normalisiert die Namen", () => {
    const r = pruefeUebersteuerung({
      art: "montage",
      key: "moebel",
      grund: "x",
      wert: { positionen: { "Doppelbett  mit Polsterkopfteil": { abbau: "company", aufbau: "customer" } } },
    });
    expect(r.wert).toEqual({ positionen: { "doppelbett mit polsterkopfteil": { abbau: "company", aufbau: "customer" } } });
    expect(() => pruefeUebersteuerung({ art: "montage", key: "anders", grund: "x", wert: { positionen: {} } })).toThrow(UebersteuerungFehler);
    expect(() => pruefeUebersteuerung({ art: "montage", key: "moebel", grund: "x", wert: { positionen: { Bett: { abbau: "wir", aufbau: "none" } } } })).toThrow(/company, customer oder none/);
    expect(() => pruefeUebersteuerung({ art: "montage", key: "moebel", grund: "x", wert: { positionen: {} } })).toThrow(/keine Position/);
    expect(pruefeUebersteuerung({ art: "montage", key: "moebel", grund: "x", wert: null }).wert).toBeNull();
  });

  it("geht als abbau/aufbau je Freitextzeile an den Rechner; „nicht nötig“ als demontage nein", () => {
    const basis = {
      montage_je_position: "1",
      positionen_freitext: [
        { name: "Doppelbett mit Polsterkopfteil", menge: 1 },
        { name: "Esstisch dunkel ausziehbar", menge: 1, abbau: "company", aufbau: "company", zerlegt: true },
        { name: "Schreibtisch weiß", menge: 1 },
        { name: "Sofa", menge: 1 },
      ],
    };
    const a = anfrageMitUebersteuerungen(
      basis,
      [
        u({
          positionen: {
            "doppelbett mit polsterkopfteil": { abbau: "customer", aufbau: "customer" },
            "esstisch dunkel ausziehbar": { abbau: "none", aufbau: "none" },
            "schreibtisch weiß": { abbau: "company", aufbau: "customer" },
          },
        }),
      ],
      { referenceDate: "2026-11-10" }
    );
    expect(a.positionen_freitext).toEqual([
      { name: "Doppelbett mit Polsterkopfteil", menge: 1, abbau: "customer", aufbau: "customer", zerlegt: false },
      { name: "Esstisch dunkel ausziehbar", menge: 1, abbau: "none", aufbau: "none", zerlegt: false, demontage: "nein" },
      { name: "Schreibtisch weiß", menge: 1, abbau: "company", aufbau: "customer", zerlegt: true },
      { name: "Sofa", menge: 1 },
    ]);
    // Die Basis bleibt unverändert.
    expect(basis.positionen_freitext[0]).toEqual({ name: "Doppelbett mit Polsterkopfteil", menge: 1 });
  });

  it("die letzte Wahl gilt, aufgehoben wirkt nichts", () => {
    const basis = { positionen_freitext: [{ name: "Bett", menge: 1 }] };
    const zwei = anfrageMitUebersteuerungen(
      basis,
      [u({ positionen: { bett: { abbau: "customer", aufbau: "customer" } } }), u({ positionen: { bett: { abbau: "company", aufbau: "company" } } }, "2026-11-10T11:00:00Z")],
      { referenceDate: "2026-11-10" }
    );
    expect(zwei.positionen_freitext).toEqual([{ name: "Bett", menge: 1, abbau: "company", aufbau: "company", zerlegt: true }]);
    expect(zwei.montage_je_position).toBe("1");
    const weg = anfrageMitUebersteuerungen(basis, [u({ positionen: { bett: { abbau: "customer", aufbau: "customer" } } }), u(null)], { referenceDate: "2026-11-10" });
    expect(weg.positionen_freitext).toEqual([{ name: "Bett", menge: 1 }]);
  });
});
