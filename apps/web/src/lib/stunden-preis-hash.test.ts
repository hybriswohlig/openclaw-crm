import { describe, expect, it } from "vitest";
import type { RechnerStunden } from "@/lib/angebot-wahl";
import { preisHashMitStunden, stundenHashTeil } from "./stunden-preis-hash";

const stunden: RechnerStunden = {
  helfer: 3,
  transporter: 1,
  stundenGeschaetzt: 7.5,
  mindestStunden: 3,
  satzHelferEur: 35,
  satzTransporterEur: 25,
  zusatzposten: [],
  summeGeschaetztEur: 975,
  mindestbetragEur: 390,
};

describe("Stunden-Anteil am Preis-Hash (M4)", () => {
  it("ohne Stunden genau der Vertrags-Hash (Festpreis, Pakete, Tage unverändert)", () => {
    expect(preisHashMitStunden("-@-=98500", null)).toBe("-@-=98500");
    expect(preisHashMitStunden("-@-=98500", undefined)).toBe("-@-=98500");
  });

  it("deterministisch und lesbar", () => {
    expect(preisHashMitStunden("-@-=97500", stunden)).toBe(
      "-@-=97500#stunden:helfer=3;transporter=1;satzHelfer=3500;satzTransporter=2500;stunden=7.5;mindestStunden=3;mindestbetrag=39000;zusatz="
    );
    expect(preisHashMitStunden("-@-=97500", { ...stunden })).toBe(preisHashMitStunden("-@-=97500", stunden));
  });

  // Gleiche Schätzung, andere Kundenangaben: früher gleicher Hash, jetzt PREIS_GEAENDERT.
  it.each<[string, Partial<RechnerStunden>]>([
    ["Helferzahl und Satz", { helfer: 4, satzHelferEur: 26.25 }],
    ["Transporter", { transporter: 2, satzTransporterEur: 12.5 }],
    ["Satz Transporter", { satzTransporterEur: 30 }],
    ["Mindeststunden", { mindestStunden: 4 }],
    ["Mindestbetrag", { mindestbetragEur: 400 }],
    ["Zusatzposten", { zusatzposten: [{ key: "halteverbot", bezeichnung: "Halteverbot", betrag: 150 }] }],
  ])("%s geändert: anderer Hash", (_fall, aenderung) => {
    expect(stundenHashTeil({ ...stunden, ...aenderung })).not.toBe(stundenHashTeil(stunden));
  });
});
