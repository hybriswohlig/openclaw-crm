import { describe, expect, it } from "vitest";
import { fokusIndex, mitTab, schrittOffen, sequenzRechts, WER_LABEL, ZUSTAND_TEXT } from "./ablauf-anzeige";

describe("mitTab", () => {
  it("hängt ?tab= an einen Link ohne Abfrage", () => {
    expect(mitTab("/objects/deals/abc", "quotation")).toBe("/objects/deals/abc?tab=quotation");
  });

  it("hängt mit & an, wenn der Link schon eine Abfrage hat", () => {
    expect(mitTab("/objects/deals/abc?x=1", "quotation")).toBe("/objects/deals/abc?x=1&tab=quotation");
  });

  it("kodiert den Tab", () => {
    expect(mitTab("/a", "b c")).toBe("/a?tab=b%20c");
  });
});

describe("fokusIndex", () => {
  const z = (...zustaende: ("erledigt" | "jetzt" | "offen" | "entfaellt")[]) => zustaende.map((zustand) => ({ zustand }));

  it("nimmt den Schritt jetzt", () => {
    expect(fokusIndex(z("erledigt", "erledigt", "jetzt", "offen"))).toBe(2);
  });

  it("nimmt ohne jetzt den letzten erledigten Schritt (Verloren)", () => {
    expect(fokusIndex(z("erledigt", "erledigt", "entfaellt", "entfaellt"))).toBe(1);
    expect(fokusIndex(z("erledigt", "entfaellt", "erledigt", "entfaellt"))).toBe(2);
  });

  it("nimmt ohne erledigten Schritt den ersten", () => {
    expect(fokusIndex(z("entfaellt", "entfaellt"))).toBe(0);
    expect(fokusIndex([])).toBe(0);
  });
});

describe("sequenzRechts", () => {
  it("schreibt Zeitpunkt und Art", () => {
    expect(sequenzRechts({ wann: "morgen", art: "auto" })).toBe("morgen · auto");
    expect(sequenzRechts({ wann: "Di 11.11.", art: "entwurf" })).toBe("Di 11.11. · Entwurf");
  });

  it("lässt bei gesendeten Nachrichten die Art weg, sie steckt im Zeitpunkt", () => {
    expect(sequenzRechts({ wann: "gesendet Di 04.11.", art: "gesendet" })).toBe("gesendet Di 04.11.");
  });
});

describe("Beschriftungen", () => {
  it("kennt jede Wer-Marke und jeden Zustand ohne Gedankenstrich", () => {
    for (const text of [...Object.values(WER_LABEL), ...Object.values(ZUSTAND_TEXT)]) {
      expect(text).not.toMatch(/[–—]/);
      expect(text).not.toBe("");
    }
    expect(WER_LABEL.kunde).toBe("Kunde");
    expect(ZUSTAND_TEXT.jetzt).toBe("aktueller Schritt");
  });

  it("bietet Aktionen nur bei jetzt und offen an", () => {
    expect(schrittOffen("jetzt")).toBe(true);
    expect(schrittOffen("offen")).toBe(true);
    expect(schrittOffen("erledigt")).toBe(false);
    expect(schrittOffen("entfaellt")).toBe(false);
  });
});
