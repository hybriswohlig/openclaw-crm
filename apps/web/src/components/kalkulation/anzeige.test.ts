import { describe, expect, it } from "vitest";
import { kartenAnzeige } from "./anzeige";

const basis = { dealRecordId: "d", workspaceId: "w", inputHash: "h", request: {}, error: null, computedAt: "2026-10-01T08:00:00.000Z" };

describe("kartenAnzeige", () => {
  it("Festpreis: Preis, Station, übernehmbar ohne Rückfrage", () => {
    const a = kartenAnzeige("neu", { ...basis, result: {
      preis: { festpreis: 1490, margeProzent: 34.2 }, kosten: { selbstkosten: 980 }, schaetzung: null,
      mietstation: { name: "SIXT Sindelfingen", anbieter: "Sixt", adresse: "x", quelle: "google", anfahrtKm: 19, anfahrtMin: 21, rueckfahrtKm: 4, rueckfahrtMin: 9 },
    } });
    expect(a).toMatchObject({ art: "festpreis", preisText: "1.490 €", kannUebernehmen: true, spanne: false });
    expect(a.station).toBe("SIXT Sindelfingen, Anfahrt 21 Min (Google Maps)");
    expect(a.warnung).toBeNull();
  });

  it("Spanne: 'von bis', übernehmbar nur mit Rückfrage, Annahmen sichtbar", () => {
    const a = kartenAnzeige("neu", { ...basis, result: { preis: { festpreis: 1800 }, schaetzung: { festpreisVon: 900, festpreisBis: 1800, annahmen: ["Etage unbekannt"] } } });
    expect(a).toMatchObject({ art: "spanne", preisText: "900 € bis 1.800 €", kannUebernehmen: true, spanne: true });
    expect(a.annahmen).toContain("Etage unbekannt");
  });

  it("kein Preis kalkulierbar: Grund und Hinweise statt Preis", () => {
    const a = kartenAnzeige("neu", { ...basis, result: {
      preis: { festpreis: null, nichtKalkulierbarGrund: "Keine Arbeit erfasst" },
      hinweise: [{ typ: "ungeprueft", text: "Keine Möbelliste: für eine Schnellschätzung Wohnfläche oder Zimmerzahl angeben" }],
      schaetzung: null,
    } });
    expect(a).toMatchObject({ art: "leer", kannUebernehmen: false });
    expect(a.preisText).toBe("Noch kein Preis");
    expect(a.warnung).toMatch(/Wohnfläche oder Zimmerzahl/);
  });

  it("Rechnerfehler mit altem Ergebnis: Ergebnis bleibt, Warnung zeigt den Fehler", () => {
    const a = kartenAnzeige("fehler", { ...basis, error: "Rechner nicht erreichbar.", result: { preis: { festpreis: 700 }, schaetzung: null } });
    expect(a).toMatchObject({ art: "festpreis", preisText: "700 €" });
    expect(a.warnung).toMatch(/nicht erreichbar/);
  });

  it("Fehler ohne jedes Ergebnis: 'derzeit nicht verfügbar', nichts übernehmbar", () => {
    const a = kartenAnzeige("fehler", null);
    expect(a).toMatchObject({ art: "fehler", preisText: "Kalkulation derzeit nicht verfügbar", kannUebernehmen: false });
  });
  it("gedrosselt: Hinweis, dass die Eingabe geändert wurde (Review Grok)", () => {
    const a = kartenAnzeige("gedrosselt", { ...basis, result: { preis: { festpreis: 700 }, schaetzung: null } });
    expect(a.warnung).toMatch(/geändert/);
  });
  it("Einpackservice ohne Kartonzahl: Warnung (Review Sol)", () => {
    const a = kartenAnzeige("neu", { ...basis, request: { einpack_ohne_anzahl: "on" }, result: { preis: { festpreis: 700 }, schaetzung: null } });
    expect(a.warnung).toMatch(/Einpackservice/);
  });
});
