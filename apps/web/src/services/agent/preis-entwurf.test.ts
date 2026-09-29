import { describe, expect, it } from "vitest";
import { angebotsHinweis, angebotsPhrase, gewaehlteMarge, leistungenText, ohnePreisPhrase, preisDetailsText, preisEntwurfText, preisPhrase } from "./preis-entwurf";
import { leaksPriceOrCommitment } from "./agent-suppress";

describe("preisPhrase", () => {
  it("Spanne aus der Schnellschätzung", () => {
    expect(preisPhrase({ schaetzung: { festpreisVon: 980, festpreisBis: 1110, annahmen: [] } })).toBe("ca. 980 bis 1.110 €");
  });
  it("Festpreis ohne Spanne", () => {
    expect(preisPhrase({ preis: { festpreis: 1110 }, schaetzung: null })).toBe("ca. 1.110 €");
  });
  it("gleiche Grenzen werden ein Betrag", () => {
    expect(preisPhrase({ schaetzung: { festpreisVon: 500, festpreisBis: 500, annahmen: [] } })).toBe("ca. 500 €");
  });
  it("kein Preis: null (dann kein Preis-Entwurf)", () => {
    expect(preisPhrase({ preis: { festpreis: null }, schaetzung: null })).toBeNull();
    expect(preisPhrase({})).toBeNull();
    expect(preisPhrase({ schaetzung: { festpreisVon: 0, festpreisBis: 0, annahmen: [] } })).toBeNull();
  });
});

describe("leistungenText", () => {
  it("Team, Fahrzeug, Abbau/Aufbau und Halteverbot aus der Kalkulation", () => {
    const t = leistungenText(
      {
        team: { groesse: 3 },
        kosten: { selbstkosten: 1, posten: [{ bezeichnung: "Boxer L3H2: Miete", menge: 1, einheit: "Tag", satz: 55, betrag: 55 }] },
        positionen: [
          { name: "Bett mit Matratze", menge: 1, volumenCbm: 1, zerlegt: true },
          { name: "Esstisch", menge: 1, volumenCbm: 1, zerlegt: true },
          { name: "Sofa", menge: 1, volumenCbm: 1, zerlegt: false },
        ],
      },
      { von_halteverbot: "on" }
    );
    expect(t).toBe("Team mit 3 Personen und Transporter, Anfahrt und alle Kilometer, Abbau und Aufbau von Bett mit Matratze und Esstisch, Halteverbotszone");
  });
  it("ohne Details: nur das Grundsätzliche", () => {
    expect(leistungenText({}, {})).toBe("Transporter mit Team, Anfahrt und alle Kilometer");
  });
});

describe("preisEntwurfText", () => {
  const phrase = "ca. 980 bis 1.110 €";
  it("Sie-Form mit Zusatz und einer Frage", () => {
    const t = preisEntwurfText({ phrase, leistungen: "Team mit 3 Personen", frage: "Welche Möbel stehen im Dachgeschoss?", du: false });
    expect(t).toContain("liegt Ihr Umzug bei ca. 980 bis 1.110 €");
    expect(t).toContain("unverbindliche Orientierung, Festpreis nach Besichtigung oder Fotos");
    expect(t).toContain("Welche Möbel stehen im Dachgeschoss?");
    expect(t).not.toMatch(/[–—]/);
  });
  it("Du-Form", () => {
    expect(preisEntwurfText({ phrase, leistungen: "Team", frage: null, du: true })).toContain("liegt dein Umzug bei");
  });
  it("der Preisfilter lässt genau diesen Satz durch, sonst nichts", () => {
    const t = preisEntwurfText({ phrase, leistungen: "Team", frage: null, du: false });
    expect(leaksPriceOrCommitment(t)).toBe(true);
    expect(leaksPriceOrCommitment(ohnePreisPhrase(t, phrase))).toBe(false);
    expect(leaksPriceOrCommitment(ohnePreisPhrase(`${t} Oder 900 €?`, phrase))).toBe(true);
    expect(ohnePreisPhrase(t, null)).toBe(t);
  });
});

describe("gewaehlteMarge", () => {
  it("liest margeGewaehltProzent aus den Kalkulationsannahmen des Angebots", () => {
    expect(gewaehlteMarge({ margeGewaehltProzent: 33 })).toBe(33);
  });
  it("fehlend, keine Zahl oder außerhalb 30 bis 60: null", () => {
    expect(gewaehlteMarge(null)).toBeNull();
    expect(gewaehlteMarge({})).toBeNull();
    expect(gewaehlteMarge({ margeGewaehltProzent: "33" })).toBeNull();
    expect(gewaehlteMarge({ margeGewaehltProzent: 25 })).toBeNull();
    expect(gewaehlteMarge({ margeGewaehltProzent: 61 })).toBeNull();
  });
});

describe("angebotsPhrase (Entwurf widerspricht keinem Festpreis im Angebot)", () => {
  const preis = { festpreis: 1170, selbstkosten: 700, rundungEur: 10, margeWirksamProzent: 40, nichtKalkulierbarGrund: null };
  const e = { preis, schaetzung: null };
  const schaetzung = { festpreisVon: 800, festpreisBis: 1170, selbstkostenVon: 480, selbstkostenBis: 700, margeProzent: 40, annahmen: [] };
  const mitMarge = (m: number) => ({ anfahrtMinuten: 55, hinweis: "x", selbstkosten: 700, margeVorschlagProzent: 40, margeGewaehltProzent: m });
  const angebot = (fixedPrice: string | number | null, calculationAssumptions: unknown, isVariable = false) => ({ fixedPrice, isVariable, calculationAssumptions });

  it("1. kein Angebot: Vorschlag des Rechners", () => {
    expect(angebotsPhrase(e, null, false)).toBe("ca. 1.170 €");
  });
  it("2. Festpreis aus der Übernahme mit 30 %: dieser Preis", () => {
    expect(angebotsPhrase(e, angebot("1000", mitMarge(30)), false)).toBe("ca. 1.000 €");
  });
  it("3. Spanne: beide Enden mit der Marge, wenn die Obergrenze dem Festpreis entspricht", () => {
    // 480 ÷ 0,7 = 685,71 → 690; 700 ÷ 0,7 = 1.000
    expect(angebotsPhrase({ preis, schaetzung }, angebot("1000", mitMarge(30)), false)).toBe("ca. 690 bis 1.000 €");
  });
  it("4. Preis von Hand geändert: der Festpreis aus dem Angebot", () => {
    expect(angebotsPhrase(e, angebot("950", mitMarge(30)), false)).toBe("ca. 950 €");
  });
  it("5. Assistent hat die Margenfelder entfernt: der Festpreis aus dem Angebot", () => {
    const nurKunde = { anfahrtMinuten: 55, anfahrtQuelle: "berechnet", etageVon: "3", hinweis: "x" };
    expect(angebotsPhrase(e, angebot("1000", nurKunde), false)).toBe("ca. 1.000 €");
  });
  it("6. Selbstkosten seit der Übernahme gestiegen: der Festpreis aus dem Angebot", () => {
    // 710 ÷ 0,7 = 1.014,29 → 1.020, das Angebot sagt 1.000
    expect(angebotsPhrase({ preis: { ...preis, selbstkosten: 710 }, schaetzung: null }, angebot("1000", mitMarge(30)), false)).toBe("ca. 1.000 €");
  });
  it("7. variables Angebot oder kein Festpreis: Vorschlag des Rechners", () => {
    expect(angebotsPhrase(e, angebot("1000", mitMarge(30), true), false)).toBe("ca. 1.170 €");
    expect(angebotsPhrase(e, angebot(null, mitMarge(30)), false)).toBe("ca. 1.170 €");
    expect(angebotsPhrase(e, angebot("0", mitMarge(30)), false)).toBe("ca. 1.170 €");
    expect(angebotsPhrase(e, angebot("abc", mitMarge(30)), false)).toBe("ca. 1.170 €");
  });
  it("8. Paketoptionen vorhanden: Vorschlag des Rechners", () => {
    expect(angebotsPhrase(e, angebot("1000", mitMarge(30)), true)).toBe("ca. 1.170 €");
  });
  it("9. der Satz aus Fall 3 kommt durch den Preisfilter, jede andere Zahl nicht", () => {
    const phrase = angebotsPhrase({ preis, schaetzung }, angebot("1000", mitMarge(30)), false)!;
    const t = preisEntwurfText({ phrase, leistungen: "Team", frage: null, du: false });
    expect(leaksPriceOrCommitment(t)).toBe(true);
    expect(leaksPriceOrCommitment(ohnePreisPhrase(t, phrase))).toBe(false);
    expect(leaksPriceOrCommitment(ohnePreisPhrase(`${t} Oder 900 €?`, phrase))).toBe(true);
  });
  it("Festpreis als Zahl und mit Nachkommastellen aus der Datenbank", () => {
    expect(angebotsPhrase(e, angebot(1000, mitMarge(30)), false)).toBe("ca. 1.000 €");
    expect(angebotsPhrase(e, angebot("1000.00", mitMarge(30)), false)).toBe("ca. 1.000 €");
  });
  it("alte Kalkulation ohne Selbstkosten und Rundung: der Festpreis aus dem Angebot", () => {
    expect(angebotsPhrase({ preis: { festpreis: 1110 }, schaetzung: null }, angebot("1000", mitMarge(30)), false)).toBe("ca. 1.000 €");
  });
  it("nicht kalkulierbar und kein Festpreis im Angebot: null", () => {
    expect(angebotsPhrase({ preis: { festpreis: null, selbstkosten: 0, rundungEur: 10, nichtKalkulierbarGrund: "x" }, schaetzung: null }, null, false)).toBeNull();
  });
});

describe("preisDetailsText", () => {
  const e = {
    preis: {
      festpreis: 1110, festpreisRoh: 1106.21, margeEur: 471.53, margeProzent: 42.48,
      posten: [
        { bezeichnung: "Arbeitsstunden (ohne Küche)", menge: 19.126, einheit: "Std", satz: 35, betrag: 669.41 },
        { bezeichnung: "Fahrzeugpauschale", menge: 1, einheit: "Fahrzeugtag", satz: 150, betrag: 150 },
        { bezeichnung: "Kilometer", menge: 136.8, einheit: "km", satz: 1, betrag: 136.8 },
        { bezeichnung: "Halteverbotszone", menge: 1, einheit: "Stück", satz: 150, betrag: 150 },
      ],
    },
    kosten: {
      selbstkosten: 638.47, personenH: 19.126,
      posten: [
        { bezeichnung: "Personal (Arbeit, Fahrzeugübergabe, Fahrzeit, Puffer)", menge: 19.126, einheit: "Std", satz: 22.5, betrag: 430.33 },
        { bezeichnung: "Boxer L3H2: Kraftstoff (137 km × 10 l/100 km)", menge: 13.68, einheit: "l", satz: 1.75, betrag: 23.94 },
        { bezeichnung: "Boxer L3H2: Miete", menge: 1, einheit: "Tag", satz: 55, betrag: 55 },
        { bezeichnung: "Halteverbotszone", menge: 1, einheit: "Stück", satz: 120, betrag: 120 },
      ],
    },
    volumen: { nettoCbm: 10.25, gewichtKg: 1069 },
    team: { groesse: 3 },
    zeiten: { fahrtMin: 138, uhrzeitMin: 415.5 },
    mietstation: { name: "SIXT Tübingen", anbieter: "Sixt", adresse: "x", quelle: "google", anfahrtKm: 27.4, anfahrtMin: 24, rueckfahrtKm: 52.7, rueckfahrtMin: 56 },
    fahrzeugoptionen: [{ id: "b", name: "Boxer L3H2", fahrten: 1, km: 136.8, fahrtMin: 138, teamgroesse: 3, uhrzeitMin: 415.5 }],
    empfehlungOptionId: "b",
    hinweise: [
      { typ: "demontage", text: "Bett mit Matratze: Demontage empfohlen (Beladeadresse: Wendeltreppe)" },
      { typ: "ungeprueft", text: "Duschtür: ohne Katalogtreffer, Volumen und Zeit geschätzt" },
      { typ: "passt_nicht", text: "Sofa: passt evtl. nicht am Stück (Beladeadresse: Wendeltreppe), Außenaufzug oder Alternative prüfen" },
      { typ: "ungeprueft", text: "Klappbett: ohne Katalogtreffer, Volumen und Zeit geschätzt" },
      { typ: "halteverbot", text: "Halteverbot an der Beladeadresse beantragen" },
    ],
    annahmen: ["Position \"Duschtür\" ohne Katalogtreffer: 0.2 m³ (vorgegeben) und 120 kg (Standard der Größenklasse sperrig) je Stück.", "Das gesamte Team fährt im Fahrzeug mit."],
    schaetzung: null,
  };
  const anfrage = { von_adresse: "Mörikestraße 34/1, 70794 Filderstadt", nach_adresse: "Mönchweg 1, 72525 Münsingen" };

  it("Strecke, Kilometer, Team, Fahrzeug, Station", () => {
    const t = preisDetailsText(e, anfrage);
    expect(t).toContain("Filderstadt → Münsingen ca. 57 km");
    expect(t).toContain("gesamt 137 km, Fahrzeit 2 Std 18 Min");
    expect(t).toContain("Mietstation SIXT Tübingen (hin 27 km, zurück 53 km)");
    expect(t).toContain("3 Personen, Boxer L3H2, 1 Fahrt, Einsatz ca. 6,9 Std");
    expect(t).toContain("10,3 m³, 1.069 kg");
  });
  it("Selbstkosten und Verkaufspreis mit Posten und Marge", () => {
    const t = preisDetailsText(e, anfrage);
    expect(t).toContain("Selbstkosten 638 €");
    expect(t).toContain("• Personal 19,1 Std × 22,50 € = 430 €");
    expect(t).toContain("• Boxer L3H2: Miete 55 €");
    expect(t).toContain("Verkaufspreis 1.110 € (Marge 472 €, 42 %)");
    expect(t).toContain("• Kilometer 136,8 km × 1,00 € = 137 €");
  });
  it("Risiken zuerst, Geschätztes in einer Zeile, ohne Selbstverständliches", () => {
    const t = preisDetailsText(e, anfrage);
    const risiken = t.slice(t.indexOf("Risiken und Annahmen:"));
    expect(risiken.split("\n")[1]).toContain("Sofa: passt evtl. nicht am Stück");
    expect(t).toContain("Ohne Katalogtreffer geschätzt: Duschtür, Klappbett");
    expect(t).not.toContain("Demontage empfohlen");
    expect(t).not.toContain("Das gesamte Team fährt");
    expect(t).not.toContain("Halteverbot an der Beladeadresse beantragen");
  });
  it("Spanne: Hinweis, dass die Aufstellung den ungünstigen Fall zeigt", () => {
    const t = preisDetailsText({ ...e, schaetzung: { festpreisVon: 980, festpreisBis: 1110, annahmen: ["Etage unbekannt: günstig EG, ungünstig 3. OG."] } }, anfrage);
    expect(t).toContain("ungünstigen Fall der Spanne");
    expect(t).toContain("Etage unbekannt");
  });
  it("fehlende Werte: kein Absturz, kein 'undefined'", () => {
    const t = preisDetailsText({ preis: { festpreis: 340 } }, {});
    expect(t).not.toMatch(/undefined|NaN/);
  });
});

describe("preisDetailsText im Margenmodell", () => {
  const e = {
    kosten: { selbstkosten: 700, posten: [{ bezeichnung: "Personal (Arbeit)", menge: 20, einheit: "Std", satz: 22.5, betrag: 450 }] },
    preis: {
      festpreis: 1170, selbstkosten: 700, rundungEur: 10, margeEur: 470, margeProzent: 40.2, margeWirksamProzent: 40, listenpreis: 1080,
      posten: [{ bezeichnung: "Arbeitsstunden (ohne Küche)", menge: 20, einheit: "Std", satz: 35, betrag: 700 }],
      margeVorschlag: { prozent: 40, gruende: [{ text: "Basis Kottke", punkte: 40 }, { text: "Vergleichsportal", punkte: -5 }, { text: "Wochenende oder Feiertag", punkte: 5 }] },
    },
  } as unknown as Parameters<typeof preisDetailsText>[0];

  it("zeigt Formel, Margenvorschlag und Preisliste nur als Vergleich, keine Preislisten-Posten als Verkaufspreis", () => {
    const t = preisDetailsText(e, {});
    expect(t).toContain("Verkaufspreis 1.170 € (Marge 470 €, 40 %):");
    expect(t).toContain("Selbstkosten ÷ (1 \u2212 40 %), aufgerundet");
    expect(t).toContain("Margenvorschlag 40 %: Basis Kottke +40, Vergleichsportal \u22125, Wochenende oder Feiertag +5");
    expect(t).toContain("Nach Preisliste (nur Vergleich) 1.080 €");
    expect(t).not.toContain("Arbeitsstunden");
    expect(t).not.toMatch(/[\u2013\u2014]|undefined|NaN/);
  });
});

describe("angebotsHinweis", () => {
  const e = { preis: { festpreis: 1170, selbstkosten: 700, rundungEur: 10 }, schaetzung: null };
  const angebot = (fixedPrice: string | null, isVariable = false) => ({ fixedPrice, isVariable, calculationAssumptions: null });

  it("Angebot weicht von der Kalkulation ab: Hinweis mit beiden Preisen", () => {
    expect(angebotsHinweis(e, angebot("1000"), false)).toBe("Preis aus dem Angebot (1.000 €), die aktuelle Kalkulation liegt bei 1.170 €.");
  });
  it("Spanne: verglichen wird mit der Obergrenze", () => {
    const s = { ...e, schaetzung: { festpreisVon: 800, festpreisBis: 1000, annahmen: [] } };
    expect(angebotsHinweis(s, angebot("1000"), false)).toBeNull();
  });
  it("gleicher Preis, kein festes Angebot oder Paketoptionen: kein Hinweis", () => {
    expect(angebotsHinweis(e, angebot("1170"), false)).toBeNull();
    expect(angebotsHinweis(e, null, false)).toBeNull();
    expect(angebotsHinweis(e, angebot("1000", true), false)).toBeNull();
    expect(angebotsHinweis(e, angebot("1000"), true)).toBeNull();
  });
});
