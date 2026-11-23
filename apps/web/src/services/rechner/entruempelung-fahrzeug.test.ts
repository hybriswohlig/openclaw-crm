import { describe, expect, it } from "vitest";
import {
  fahrzeugFuerEntruempelung,
  fahrzeugWahlWeicht,
  naechsteFahrzeugAnfrage,
  type FahrzeugOptionRoh,
} from "./entruempelung-fahrzeug";

const KURZ = "3f7a0b02-ae58-4de2-9931-c2ec26343d74";
const LANG = "c4fc0711-c083-46cd-a90a-871468206673";
const STATION = "f4963f7d-a130-4c6e-9f28-2e9275e25318";

/** Optionen wie bei 11,52 m³ netto / 12,91 m³ Ladevolumen (eine Station). */
function optionenElisabeth(): FahrzeugOptionRoh[] {
  return [
    { id: `${KURZ}@${STATION}`, name: "Sprinter kurz L2H2", fahrten: 2, auslastung: 0.6147, selbstkosten: 883.41 },
    { id: `boxer-l3@${STATION}`, name: "Boxer L3H2", fahrten: 1, auslastung: 0.993, selbstkosten: 888.41 },
    { id: `${LANG}@${STATION}`, name: "Sprinter lang L3H2", fahrten: 1, auslastung: 0.922, selbstkosten: 894.09 },
  ];
}

describe("Fahrzeugwahl Entrümpelung", () => {
  it("11,5 m³ passt nicht in einen Sprinter kurz L2H2, der lange Sprinter fährt einmal", () => {
    const optionen: FahrzeugOptionRoh[] = [
      { id: `${KURZ}@${STATION}`, name: "Sprinter kurz L2H2", fahrten: 1 },
      { id: `${LANG}@${STATION}`, name: "Sprinter lang L3H2", fahrten: 1 },
    ];
    const wahl = fahrzeugFuerEntruempelung({ nettoCbm: 11.5 }, optionen, `${KURZ}@${STATION}`);
    expect(wahl).toMatchObject({ klasseId: LANG, name: "Sprinter lang L3H2", fahrten: 1, wechseln: true });
    expect(wahl!.nutzbarCbm).toBeGreaterThanOrEqual(14);
    expect(wahl!.nutzbarCbm).toBeLessThanOrEqual(20);
  });

  it("bei 12,91 m³ Ladevolumen nicht den kurzen Sprinter und nicht den knappen Boxer", () => {
    const wahl = fahrzeugFuerEntruempelung({ nettoCbm: 11.522, ladeCbm: 12.909 }, optionenElisabeth(), `${KURZ}@${STATION}`);
    expect(wahl).toMatchObject({ klasseId: LANG, name: "Sprinter lang L3H2", fahrten: 1, wechseln: true });
  });

  it("bleibt beim kurzen Sprinter, wenn kein größeres Fahrzeug eine Fahrt schafft, und zählt zwei Fahrten", () => {
    const nurKurz: FahrzeugOptionRoh[] = [{ id: `${KURZ}@${STATION}`, name: "Sprinter kurz L2H2", fahrten: 1 }];
    const wahl = fahrzeugFuerEntruempelung({ nettoCbm: 11.5 }, nurKurz, `${KURZ}@${STATION}`);
    expect(wahl).toMatchObject({ klasseId: KURZ, fahrten: 2, wechseln: false });
  });

  it("3,5-t-Koffer vor dem kurzen Sprinter, langer Sprinter vor dem Koffer, wenn er in einer Fahrt passt", () => {
    const mitKoffer: FahrzeugOptionRoh[] = [
      { id: "kurz@s", name: "Sprinter kurz L2H2", fahrten: 1 },
      { id: "koffer@s", name: "3,5 t Koffer", fahrten: 1 },
    ];
    expect(fahrzeugFuerEntruempelung({ nettoCbm: 11.5 }, mitKoffer, "kurz@s")?.klasseId).toBe("koffer");
    const mitLang: FahrzeugOptionRoh[] = [...mitKoffer, { id: "lang@s", name: "Sprinter lang L3H2", fahrten: 1 }];
    expect(fahrzeugFuerEntruempelung({ nettoCbm: 11.5 }, mitLang, "kurz@s")?.klasseId).toBe("lang");
  });

  it("manuelle Klasse, Buchung und ein gescheiterter Versuch lösen keine zweite Anfrage aus", () => {
    const ergebnis = {
      volumen: { nettoCbm: 11.5 },
      fahrzeugoptionen: optionenElisabeth(),
      empfehlungOptionId: `${KURZ}@${STATION}`,
    };
    expect(naechsteFahrzeugAnfrage({ auftragsart: "entruempelung" }, ergebnis)?.klasseId).toBe(LANG);
    expect(naechsteFahrzeugAnfrage({ auftragsart: "umzug" }, ergebnis)).toBeNull();
    expect(naechsteFahrzeugAnfrage({ auftragsart: "entruempelung", fahrzeugklasse: "manuell" }, ergebnis)).toBeNull();
    expect(naechsteFahrzeugAnfrage({ auftragsart: "entruempelung", buchung: "{}" }, ergebnis)).toBeNull();
    expect(naechsteFahrzeugAnfrage({ auftragsart: "entruempelung", fahrzeugklasse_auto: "0" }, ergebnis)).toBeNull();
    expect(fahrzeugWahlWeicht({ auftragsart: "entruempelung" }, ergebnis)).toBe(true);
    expect(fahrzeugWahlWeicht({ auftragsart: "entruempelung", fahrzeugklasse: LANG, fahrzeugklasse_auto: "1" }, { ...ergebnis, empfehlungOptionId: `${LANG}@${STATION}` })).toBe(false);
  });
});
