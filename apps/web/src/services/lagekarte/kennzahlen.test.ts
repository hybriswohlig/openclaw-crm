import { describe, expect, it } from "vitest";
import { beispielAntwort } from "@/lib/lagekarte/beispiel-daten";
import { WERT_PLAUSIBEL_MAX_CENT, type LeadPunkt } from "@/lib/lagekarte/typen";
import { berechneKennzahlen } from "./kennzahlen";

const jetzt = new Date("2026-10-08T07:30:00+02:00");
const basis = beispielAntwort(jetzt).leads[0];
let zaehler = 0;
const lead = (p: Partial<LeadPunkt>): LeadPunkt => ({
  ...basis,
  id: `lead-${zaehler++}`,
  status: "kontakt",
  umzugAm: null,
  wert: null,
  wartet: null,
  statusHinweis: null,
  zahlungOffen: false,
  veraltet: false,
  emailUngelesen: 0,
  ...p,
  kv: { ...basis.kv, ...(p.kv ?? {}) },
});

describe("berechneKennzahlen", () => {
  it("liefert für eine leere Liste lauter Nullen", () => {
    expect(berechneKennzahlen([], jetzt)).toEqual({
      wartet: { gesamt: 0, antwort: 0, neuPruefen: 0, aeltesteSeit: null },
      emailUngelesen: { leads: 0 },
      angeboteOffen: { anzahl: 0, ungesehen: 0 },
      angenommenMonat: { anzahl: 0, cent: 0, monat: "2026-10" },
      umzuegeNaechste7Tage: 0,
      verortet: { mitOrt: 0, gesamt: 0 },
    });
  });

  it("zählt Wartende je Art und nennt den ältesten Zeitpunkt", () => {
    const k = berechneKennzahlen(
      [
        lead({ wartet: { art: "antwort", seit: "2026-10-08T05:00:00+02:00", chatId: "c1" } }),
        lead({ wartet: { art: "antwort", seit: "2026-10-07T09:00:00+02:00", chatId: "c2" } }),
        lead({ wartet: { art: "neu_pruefen", seit: "2026-10-08T06:00:00+02:00", chatId: null } }),
        lead({ wartet: null }),
      ],
      jetzt,
    );
    expect(k.wartet).toEqual({
      gesamt: 3,
      antwort: 2,
      neuPruefen: 1,
      aeltesteSeit: "2026-10-07T09:00:00+02:00",
    });
  });

  it("vergleicht aeltesteSeit nach Zeitpunkt, nicht nach Zeichenkette", () => {
    const k = berechneKennzahlen(
      [
        lead({ wartet: { art: "antwort", seit: "2026-10-08T00:30:00+02:00", chatId: "c1" } }),
        lead({ wartet: { art: "antwort", seit: "2026-10-07T23:00:00Z", chatId: "c2" } }),
      ],
      jetzt,
    );
    // 2026-10-07T23:00Z = 01:00 Berlin am 8., also später als 00:30 Berlin
    expect(k.wartet.aeltesteSeit).toBe("2026-10-08T00:30:00+02:00");
  });

  it("zählt Leads mit ungelesener E-Mail, aber keine verlorenen", () => {
    const k = berechneKennzahlen(
      [
        lead({ emailUngelesen: 2 }),
        lead({ emailUngelesen: 1, status: "angebot" }),
        lead({ emailUngelesen: 3, status: "verloren" }),
        lead({ emailUngelesen: 0 }),
      ],
      jetzt,
    );
    expect(k.emailUngelesen).toEqual({ leads: 2 });
  });

  it("zählt offene Angebote und davon die ungesehenen mit aktivem Link", () => {
    const k = berechneKennzahlen(
      [
        lead({ status: "angebot", kv: { ...basis.kv, linkAktiv: true, linkAngesehenAnzahl: 0 } }),
        lead({ status: "angebot", kv: { ...basis.kv, linkAktiv: true, linkAngesehenAnzahl: 2 } }),
        lead({ status: "angebot", kv: { ...basis.kv, linkAktiv: false, linkAngesehenAnzahl: 0 } }),
        lead({ status: "auftrag", kv: { ...basis.kv, linkAktiv: true, linkAngesehenAnzahl: 0 } }),
      ],
      jetzt,
    );
    expect(k.angeboteOffen).toEqual({ anzahl: 3, ungesehen: 1 });
  });

  it("zählt angenommene KVs nach Berliner Monat und summiert nur bestätigte Werte", () => {
    const k = berechneKennzahlen(
      [
        lead({ status: "auftrag", wert: { cent: 100000, art: "bestaetigt" }, kv: { ...basis.kv, angenommenAm: "2026-10-01T08:00:00+02:00" } }),
        lead({ status: "auftrag", wert: { cent: 50000, art: "bestaetigt" }, kv: { ...basis.kv, angenommenAm: "2026-09-30T23:30:00+02:00" } }),
      ],
      jetzt,
    );
    expect(k.angenommenMonat).toEqual({ anzahl: 1, cent: 100000, monat: "2026-10" });
  });

  it("rechnet die Monatsgrenze in Berliner Zeit: UTC-Vormonat kann Berliner Monat sein", () => {
    const k = berechneKennzahlen(
      [lead({ status: "auftrag", wert: { cent: 70000, art: "bestaetigt" }, kv: { ...basis.kv, angenommenAm: "2026-09-30T22:30:00Z" } })],
      jetzt,
    );
    // 22:30 UTC am 30.09. ist 00:30 Berlin am 01.10.
    expect(k.angenommenMonat).toEqual({ anzahl: 1, cent: 70000, monat: "2026-10" });
  });

  it("zählt eine Annahme ohne bestätigten Wert mit, addiert aber keine Cent", () => {
    const k = berechneKennzahlen(
      [
        lead({ status: "auftrag", wert: { cent: 90000, art: "schaetzung" }, kv: { ...basis.kv, angenommenAm: "2026-10-02T10:00:00+02:00" } }),
        lead({ status: "auftrag", wert: null, kv: { ...basis.kv, angenommenAm: "2026-10-03T10:00:00+02:00" } }),
        lead({ status: "auftrag", wert: { cent: 25000, art: "bestaetigt" }, kv: { ...basis.kv, angenommenAm: "2026-10-04T10:00:00+02:00" } }),
      ],
      jetzt,
    );
    expect(k.angenommenMonat).toEqual({ anzahl: 3, cent: 25000, monat: "2026-10" });
  });

  it("ignoriert Leads ohne Annahme beim Monatswert", () => {
    const k = berechneKennzahlen(
      [lead({ status: "angebot", wert: { cent: 80000, art: "angebot" }, kv: { ...basis.kv, angenommenAm: null } })],
      jetzt,
    );
    expect(k.angenommenMonat).toEqual({ anzahl: 0, cent: 0, monat: "2026-10" });
  });

  it("Umzüge in 7 Tagen nur für Aufträge/Erledigte im Fenster heute..+6", () => {
    const k = berechneKennzahlen(
      [
        lead({ status: "auftrag", umzugAm: "2026-10-08" }),
        lead({ status: "auftrag", umzugAm: "2026-10-14" }),
        lead({ status: "auftrag", umzugAm: "2026-10-15" }),
        lead({ status: "auftrag", umzugAm: "2026-10-07" }),
        lead({ status: "erledigt", umzugAm: "2026-10-10" }),
        lead({ status: "angebot", umzugAm: "2026-10-09" }),
        lead({ status: "auftrag", umzugAm: null }),
      ],
      jetzt,
    );
    expect(k.umzuegeNaechste7Tage).toBe(3);
  });

  it("Umzugsfenster überschreitet den Monatswechsel korrekt", () => {
    const ende = new Date("2026-10-28T12:00:00+01:00");
    const k = berechneKennzahlen(
      [
        lead({ status: "auftrag", umzugAm: "2026-11-03" }),
        lead({ status: "auftrag", umzugAm: "2026-11-04" }),
      ],
      ende,
    );
    expect(k.umzuegeNaechste7Tage).toBe(1);
  });

  it("verloren zählt nicht bei verortet", () => {
    const k = berechneKennzahlen([lead({ status: "verloren", ort: null }), lead({ status: "kontakt", ort: null })], jetzt);
    expect(k.verortet).toEqual({ mitOrt: 0, gesamt: 1 });
  });

  it("zählt verortete Leads", () => {
    const k = berechneKennzahlen(
      [lead({ status: "kontakt" }), lead({ status: "angebot", ort: null }), lead({ status: "verloren" })],
      jetzt,
    );
    expect(basis.ort).not.toBeNull();
    expect(k.verortet).toEqual({ mitOrt: 1, gesamt: 2 });
  });
});

describe("berechneKennzahlen: Plausibilität (Ruling 7)", () => {
  const angenommen = (cent: number) =>
    lead({ status: "auftrag", wert: { cent, art: "bestaetigt" }, kv: { ...basis.kv, angenommenAm: "2026-10-02T10:00:00+02:00" } });

  it("Grenze liegt bei 50.000 €", () => {
    expect(WERT_PLAUSIBEL_MAX_CENT).toBe(5_000_000);
  });

  it("unplausible Werte zählen nicht in die Monatssumme, die Annahme zählt aber mit", () => {
    const k = berechneKennzahlen([angenommen(1_000_000_000), angenommen(250_000)], jetzt);
    expect(k.angenommenMonat).toEqual({ anzahl: 2, cent: 250_000, monat: "2026-10" });
  });

  it("genau 50.000 € sind noch plausibel", () => {
    const k = berechneKennzahlen([angenommen(WERT_PLAUSIBEL_MAX_CENT)], jetzt);
    expect(k.angenommenMonat.cent).toBe(WERT_PLAUSIBEL_MAX_CENT);
  });
});
