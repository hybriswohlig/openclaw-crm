import { describe, expect, it } from "vitest";
import type { InventarListeZeile } from "./kalkulation-inventar";
import { alleAuf, geaenderteKeys, leadAenderungen, montageWert, relevant, startWahl, waehlbar } from "./montage-wahl";

const zeile = (name: string, abbau: InventarListeZeile["demontage"]["wer"], aufbau = abbau, extra: Partial<InventarListeZeile> = {}): InventarListeZeile => ({
  id: `it_${name}`,
  key: name.toLowerCase(),
  name,
  menge: 1,
  mitnehmen: true,
  herkunft: "FOTO",
  fotoUrl: null,
  katalog: { treffer: true, key: null },
  groessenklasse: null,
  volumenCbm: 1,
  gewichtKg: null,
  mindestTraeger: null,
  trageMin: null,
  demontage: { min: null, wer: abbau },
  montage: { min: null, wer: aufbau },
  montageGewaehlt: false,
  bestimmtTeam: false,
  positionen: 1,
  korrigiert: null,
  mehraufwandMin: null,
  ...extra,
});

describe("Wahl Demontage/Montage je Möbel (Inhaber 10.11.)", () => {
  const zeilen = [
    zeile("Doppelbett", "wir"),
    zeile("Kleiderschrank", "wir"),
    zeile("Stuhl", "nicht_noetig"),
    zeile("Sofa", "kunde", "kunde", { montageGewaehlt: true }),
    zeile("Lampe", "nicht_noetig", "nicht_noetig", { mitnehmen: false }),
    zeile("Karton", "nicht_noetig", "nicht_noetig", { katalog: null }),
  ];

  it("Vorbelegung aus der Kalkulation, wählbar nur mitgenommene, gerechnete Teile", () => {
    expect(waehlbar(zeilen).map((z) => z.name)).toEqual(["Doppelbett", "Kleiderschrank", "Stuhl", "Sofa"]);
    expect(waehlbar(zeilen).filter(relevant).map((z) => z.name)).toEqual(["Doppelbett", "Kleiderschrank", "Sofa"]);
    expect(startWahl(zeilen).doppelbett).toEqual({ abbau: "wir", aufbau: "wir" });
  });

  it("ohne Änderung keine Übersteuerung", () => {
    const s = startWahl(zeilen);
    expect(montageWert(zeilen, s, s)).toBeNull();
    expect(geaenderteKeys(s, s)).toEqual([]);
  });

  it("„alle Kunde“: geänderte und schon gewählte Möbel in einer Liste, Lead nur für geänderte", () => {
    const s = startWahl(zeilen);
    const w = alleAuf(s, ["doppelbett", "kleiderschrank", "sofa"], "kunde");
    expect(geaenderteKeys(s, w).sort()).toEqual(["doppelbett", "kleiderschrank"]);
    expect(montageWert(zeilen, s, w)).toEqual({
      positionen: {
        doppelbett: { abbau: "customer", aufbau: "customer" },
        kleiderschrank: { abbau: "customer", aufbau: "customer" },
        sofa: { abbau: "customer", aufbau: "customer" },
      },
    });
    expect(leadAenderungen(zeilen, s, w)).toEqual([
      { id: "it_Doppelbett", dismantlingOwner: "customer", assemblyOwner: "customer" },
      { id: "it_Kleiderschrank", dismantlingOwner: "customer", assemblyOwner: "customer" },
    ]);
  });

  it("getrennt für Abbau und Aufbau, „nicht nötig“ wird none", () => {
    const s = startWahl(zeilen);
    const w = { ...s, doppelbett: { abbau: "wir" as const, aufbau: "kunde" as const }, kleiderschrank: { abbau: "nicht_noetig" as const, aufbau: "nicht_noetig" as const } };
    expect(montageWert(zeilen, s, w)?.positionen).toEqual({
      doppelbett: { abbau: "company", aufbau: "customer" },
      kleiderschrank: { abbau: "none", aufbau: "none" },
      sofa: { abbau: "customer", aufbau: "customer" },
    });
  });
});
