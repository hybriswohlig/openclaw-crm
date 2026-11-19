import { describe, expect, it } from "vitest";
import type { RechnungsVorschlag, ZahlungZeileAkte } from "@/lib/geld";
import {
  betragText,
  erinnerungText,
  geldFehlerText,
  kachelText,
  anpassungAusEingabe,
  prozentAusText,
  rechnungBetrag,
  rechnungSchritt,
  rechnungZeile,
  zahlungAktionen,
  zahlungDetails,
} from "./kasse-logik";

const vorschlag = (v: Partial<RechnungsVorschlag> = {}): RechnungsVorschlag => ({
  istStunden: false,
  annahmeCent: 90000,
  pdfBetragCent: 90000,
  bruttoCent: 90000,
  abweichung: false,
  stunden: null,
  faelligAm: "2026-11-21",
  aktiveRechnung: null,
  sperrgrund: null,
  ...v,
});

const zahlung = (z: Partial<ZahlungZeileAkte> = {}): ZahlungZeileAkte => ({
  id: "p1",
  date: "2026-11-07",
  cent: 45000,
  art: "cash",
  kaution: false,
  quelle: "mitarbeiter",
  kassiertVon: "Hans",
  belegnummer: "K-E-2026-0007",
  notiz: null,
  storniert: false,
  istStorno: false,
  barOffen: true,
  ...z,
});

describe("kasse-logik", () => {
  it("Kacheln und Beträge", () => {
    expect(kachelText({ anzahl: 0, cent: 0, unbekannt: 0 })).toBe("keine");
    expect(kachelText({ anzahl: 3, cent: 248000, unbekannt: 1 })).toBe("3 · 2.480 € · 1 ohne Betrag");
    expect(betragText(null)).toBe("Betrag offen");
    expect(betragText(45050)).toBe("450,50 €");
  });

  it("Rechnung kurz mit Erinnerung", () => {
    expect(
      rechnungZeile({
        id: "i",
        nummer: "RE-2026-0001",
        status: "gestellt",
        bruttoCent: 248000,
        rechnungstag: "2026-11-07",
        faelligAm: "2026-11-21",
        abweichungGrund: null,
        erinnerung: { stufe: 1, status: "gesendet", am: "2026-11-30T09:00:00Z" },
      })
    ).toBe("RE-2026-0001 · 2.480 € · fällig Sa 21.11. · gestellt · Erinnerung 1 gesendet Mo 30.11.");
    expect(erinnerungText(null)).toBeNull();
  });

  it("Zahlungszeile: Details und erlaubte Aktionen", () => {
    expect(zahlungDetails(zahlung())).toBe("Bar · K-E-2026-0007 · kassiert von Hans · Bar noch beim Team");
    expect(zahlungAktionen(zahlung())).toEqual({ bearbeiten: true, korrigieren: true, stornieren: true });
    expect(zahlungAktionen(zahlung({ storniert: true }))).toEqual({ bearbeiten: true, korrigieren: false, stornieren: false });
    expect(zahlungAktionen(zahlung({ istStorno: true, quelle: "storno" }))).toEqual({ bearbeiten: false, korrigieren: false, stornieren: false });
  });

  it("Rechnungsschritt: Festpreis gleich, Abweichung mit Grund, Stunden mit Betrag, Sperre", () => {
    expect(rechnungSchritt(vorschlag(), { betragCent: null, grund: "" })).toMatchObject({ betragFest: true, weiter: true, grundNoetig: false });
    const ab = vorschlag({ pdfBetragCent: 95000, abweichung: true });
    expect(rechnungSchritt(ab, { betragCent: null, grund: "kurz" })).toMatchObject({ grundNoetig: true, weiter: false });
    expect(rechnungSchritt(ab, { betragCent: null, grund: "Mehr Möbel" })).toMatchObject({ weiter: true });
    expect(rechnungBetrag(ab, null)).toBe(95000);
    const st = vorschlag({ istStunden: true, pdfBetragCent: null });
    expect(rechnungSchritt(st, { betragCent: null, grund: "" }).weiter).toBe(false);
    expect(rechnungSchritt(st, { betragCent: 61250, grund: "" })).toMatchObject({ weiter: true, betragFest: false });
    expect(rechnungBetrag(st, 61250)).toBe(61250);
    expect(rechnungSchritt(vorschlag({ sperrgrund: "AKTIVE_RECHNUNG" }), { betragCent: null, grund: "" })).toMatchObject({ weiter: false });
  });

  it("Rechnung anpassen: Zeile aus Euro oder Prozent, Gesamtbetrag, Grund Pflicht", () => {
    expect(prozentAusText("10")).toBe(10);
    expect(prozentAusText("7,5 %")).toBe(7.5);
    expect(prozentAusText("0")).toBeNull();
    expect(prozentAusText("120")).toBeNull();
    expect(prozentAusText("1,234")).toBeNull();
    expect(anpassungAusEingabe({ art: "nachlass", bezeichnung: "Nachlass", modus: "euro", wert: "90,00" }, 90000)).toEqual({
      art: "nachlass",
      bezeichnung: "Nachlass",
      betragCent: 9000,
    });
    expect(anpassungAusEingabe({ art: "nachlass", bezeichnung: "Nachlass", modus: "prozent", wert: "10" }, 90000)).toEqual({
      art: "nachlass",
      bezeichnung: "Nachlass",
      betragCent: 9000,
      prozent: 10,
    });
    expect(anpassungAusEingabe({ art: "nachlass", bezeichnung: " ", modus: "euro", wert: "90" }, 90000)).toBeNull();
    expect(anpassungAusEingabe({ art: "aufschlag", bezeichnung: "Keller", modus: "euro", wert: "-5" }, 90000)).toBeNull();

    const zeilen = [
      { art: "nachlass" as const, bezeichnung: "Nachlass wie vereinbart", modus: "prozent" as const, wert: "10" },
      { art: "aufschlag" as const, bezeichnung: "Mehraufwand Kellerräumung", modus: "euro" as const, wert: "45,50" },
    ];
    const ohneGrund = rechnungSchritt(vorschlag(), { betragCent: null, grund: "", anpassungen: zeilen });
    expect(ohneGrund).toMatchObject({ grundNoetig: true, weiter: false, basisCent: 90000, gesamtCent: 85550 });
    const mitGrund = rechnungSchritt(vorschlag(), { betragCent: null, grund: "Am Telefon zugesagt", anpassungen: zeilen });
    expect(mitGrund).toMatchObject({ weiter: true, gesamtCent: 85550 });
    expect(mitGrund.anpassungen).toHaveLength(2);

    const halb = rechnungSchritt(vorschlag(), { betragCent: null, grund: "Am Telefon zugesagt", anpassungen: [{ ...zeilen[1], wert: "" }] });
    expect(halb).toMatchObject({ weiter: false, hinweis: expect.stringMatching(/Bezeichnung und Betrag/) });
    const zuViel = rechnungSchritt(vorschlag(), {
      betragCent: null,
      grund: "Am Telefon zugesagt",
      anpassungen: [{ art: "nachlass", bezeichnung: "Alles", modus: "euro", wert: "900" }],
    });
    expect(zuViel.weiter).toBe(false);

    // Stunden-KV: Prozent auf den eingetragenen Betrag
    const st = vorschlag({ istStunden: true, pdfBetragCent: null });
    expect(
      rechnungSchritt(st, { betragCent: 100000, grund: "Kunde wollte mehr", anpassungen: [{ ...zeilen[0], modus: "prozent", wert: "5" }] })
    ).toMatchObject({ weiter: true, basisCent: 100000, gesamtCent: 95000 });
    // ohne Zeilen wie bisher
    expect(rechnungSchritt(vorschlag(), { betragCent: null, grund: "" })).toMatchObject({ weiter: true, gesamtCent: 90000, anpassungen: [] });
    // Review Grok 1: Nachlass unter Anzahlung oder Gezahltes sperrt „Weiter“ mit Betrag im Hinweis
    const angezahlt = rechnungSchritt(vorschlag({ anzahlungCent: 40000, bezahltCent: 50000 }), {
      betragCent: null,
      grund: "Am Telefon zugesagt",
      anpassungen: [{ art: "nachlass", bezeichnung: "Nachlass", modus: "euro", wert: "600" }],
    });
    expect(angezahlt).toMatchObject({ weiter: false, gesamtCent: 30000 });
    expect(angezahlt.hinweis?.replace(/\u00a0/g, " ")).toMatch(/Nachlass zu hoch: Es sind schon 500,00 € angezahlt bzw. bezahlt/);
  });

  it("Geld-Fehlercode wird zum Teamtext", () => {
    expect(geldFehlerText("NUR_STORNO", "x")).toMatch(/storniert, nicht gelöscht/);
    expect(geldFehlerText(null, "Server sagt nein")).toBe("Server sagt nein");
  });
});
