import { describe, expect, it } from "vitest";
import type { RechnerAnfrage } from "@/services/rechner/eingabe";
import {
  ENTRUEMPELUNG_PREISE,
  LANGER_TRAGEWEG_M,
  ZUSCHLAG_REQUEST,
  anfrageOhneZuschlagFelder,
  entruempelungPreisZeilen,
  gutschriftEur,
  preisNachGutschrift,
  pruefeZuschlagWert,
  rohVorGutschrift,
  zuschlagPlan,
} from "./entruempelung-zuschlaege";

const an = (extra: RechnerAnfrage = {}): RechnerAnfrage => ({ auftragsart: "entruempelung", ...extra });
const feld = ZUSCHLAG_REQUEST;

describe("zuschlagPlan", () => {
  it("ist aus, solange kein Hebel an ist", () => {
    expect(zuschlagPlan(an())).toEqual({ linien: [], gutschrift: 0 });
    expect(zuschlagPlan(an({ [feld["hebel.sondermuell"]]: "on" })).linien).toEqual([]);
    expect(zuschlagPlan(an({ [feld["hebel.elektro"]]: "on", [feld["elektro.stueck"]]: "0" })).linien).toEqual([]);
  });

  it("Sondermüll nach Stück und als Pauschale", () => {
    const stueck = zuschlagPlan(an({ [feld["hebel.sondermuell"]]: "on", [feld["sondermuell.stueck"]]: "4" }));
    expect(stueck.linien).toEqual([
      {
        description: "Sondermüll und Problemstoffe (Farben, Lacke, Chemikalien, Reifen, Öl)",
        quantity: 4,
        unitRate: ENTRUEMPELUNG_PREISE.sondermuellStueck,
      },
    ]);
    const pauschale = zuschlagPlan(
      an({
        [feld["hebel.sondermuell"]]: "on",
        [feld["hebel.sondermuell_pauschale"]]: "on",
        [feld["sondermuell.stueck"]]: "4",
      })
    );
    expect(pauschale.linien[0]).toMatchObject({ quantity: 1, unitRate: ENTRUEMPELUNG_PREISE.sondermuellPauschale });
    expect(pauschale.linien[0]!.description).toContain("Pauschale");
  });

  it("Elektrogeräte als Stück mal Preis, mit überschriebenem Satz", () => {
    const plan = zuschlagPlan(
      an({ [feld["hebel.elektro"]]: "on", [feld["elektro.stueck"]]: "3", [feld["preis.elektro"]]: "19.5" })
    );
    expect(plan.linien).toEqual([
      { description: "Elektrogeräte, weiße Ware und Bildschirme", quantity: 3, unitRate: 19.5 },
    ]);
  });

  it("Keller, Dachboden und Garage je Bereich, nur die gewählten", () => {
    const zwei = zuschlagPlan(an({ [feld["hebel.keller"]]: "on", [feld["hebel.garage"]]: "on" }));
    expect(zwei.linien).toEqual([
      { description: "Zuschlag Keller und Garage", quantity: 2, unitRate: ENTRUEMPELUNG_PREISE.bereich },
    ]);
    const alle = zuschlagPlan(
      an({ [feld["hebel.keller"]]: "on", [feld["hebel.dachboden"]]: "on", [feld["hebel.garage"]]: "on" })
    );
    expect(alle.linien[0]!.description).toBe("Zuschlag Keller, Dachboden und Garage");
    expect(alle.linien[0]!.quantity).toBe(3);
  });

  it("Trageweg hängt an Etage ohne Aufzug, sonst an einem langen Weg", () => {
    const etage = zuschlagPlan(an({ [feld["hebel.trageweg"]]: "on", von_etage: "2", von_aufzug: "keiner", von_tragestrecke: "8" }));
    expect(etage.linien[0]).toMatchObject({
      description: "Zuschlag Trageweg, 2 Stockwerke ohne Aufzug, 8 m",
      quantity: 2,
      unitRate: ENTRUEMPELUNG_PREISE.trageweg,
    });
    const mitAufzug = zuschlagPlan(an({ [feld["hebel.trageweg"]]: "on", von_etage: "3", von_aufzug: "gross", von_tragestrecke: "4" }));
    expect(mitAufzug.linien).toEqual([]);
    const lang = zuschlagPlan(
      an({ [feld["hebel.trageweg"]]: "on", von_etage: "0", von_aufzug: "keiner", von_tragestrecke: String(LANGER_TRAGEWEG_M + 5) })
    );
    expect(lang.linien[0]!.description).toBe(`Zuschlag langer Trageweg, ${LANGER_TRAGEWEG_M + 5} m`);
    const kurz = zuschlagPlan(an({ [feld["hebel.trageweg"]]: "on", von_tragestrecke: "5" }));
    expect(kurz.linien).toEqual([]);
    const vorgegeben = zuschlagPlan(an({ [feld["hebel.trageweg"]]: "on", [feld["trageweg.stockwerke"]]: "1", von_aufzug: "gross" }));
    expect(vorgegeben.linien[0]).toMatchObject({ quantity: 1, description: "Zuschlag Trageweg, 1 Stockwerk ohne Aufzug" });
  });

  it("Besenrein als Pauschale oder nach m², Boden nur nach m²", () => {
    const pauschale = zuschlagPlan(an({ [feld["hebel.besenrein"]]: "on" }));
    expect(pauschale.linien[0]).toMatchObject({
      description: "Besenreine Übergabe und Endreinigung, Pauschale",
      quantity: 1,
      unitRate: ENTRUEMPELUNG_PREISE.besenreinPauschale,
    });
    const qm = zuschlagPlan(an({ [feld["hebel.besenrein"]]: "on", [feld["besenrein.qm"]]: "42.5" }));
    expect(qm.linien[0]).toMatchObject({
      description: "Besenreine Übergabe und Endreinigung, 42,5 m²",
      quantity: 42.5,
      unitRate: ENTRUEMPELUNG_PREISE.besenreinQm,
    });
    expect(zuschlagPlan(an({ [feld["hebel.boden"]]: "on" })).linien).toEqual([]);
    const boden = zuschlagPlan(an({ [feld["hebel.boden"]]: "on", [feld["boden.qm"]]: "18", [feld["preis.boden"]]: "6" }));
    expect(boden.linien).toEqual([
      { description: "Entfernen von Bodenbelägen und Tapeten, 18 m²", quantity: 18, unitRate: 6 },
    ]);
  });

  it("Wertanrechnung ist eine Gutschrift, kein positiver Posten", () => {
    const plan = zuschlagPlan(an({ [feld["hebel.wertanrechnung"]]: "on", [feld["wertanrechnung.betrag"]]: "80" }));
    expect(plan.linien).toEqual([]);
    expect(plan.gutschrift).toBe(80);
    expect(gutschriftEur(an({ [feld["hebel.wertanrechnung"]]: "on" }))).toBe(0);
  });

  it("Umzug bleibt leer, auch wenn die Felder gesetzt sind", () => {
    const umzug: RechnerAnfrage = {
      auftragsart: "umzug",
      [feld["hebel.sondermuell"]]: "on",
      [feld["sondermuell.stueck"]]: "5",
      [feld["hebel.elektro"]]: "on",
      [feld["elektro.stueck"]]: "2",
      [feld["hebel.keller"]]: "on",
      [feld["hebel.trageweg"]]: "on",
      von_etage: "3",
      von_aufzug: "keiner",
      [feld["hebel.besenrein"]]: "on",
      [feld["hebel.boden"]]: "on",
      [feld["boden.qm"]]: "20",
      [feld["hebel.wertanrechnung"]]: "on",
      [feld["wertanrechnung.betrag"]]: "50",
    };
    expect(zuschlagPlan(umzug)).toEqual({ linien: [], gutschrift: 0 });
    expect(preisNachGutschrift(1630, umzug)).toBe(1630);
  });

  it("Kundentexte ohne Gedankenstrich", () => {
    const voll = zuschlagPlan(
      an({
        [feld["hebel.sondermuell"]]: "on",
        [feld["sondermuell.stueck"]]: "1",
        [feld["hebel.elektro"]]: "on",
        [feld["elektro.stueck"]]: "1",
        [feld["hebel.keller"]]: "on",
        [feld["hebel.dachboden"]]: "on",
        [feld["hebel.garage"]]: "on",
        [feld["hebel.trageweg"]]: "on",
        von_etage: "1",
        von_aufzug: "keiner",
        [feld["hebel.besenrein"]]: "on",
        [feld["besenrein.qm"]]: "10",
        [feld["hebel.boden"]]: "on",
        [feld["boden.qm"]]: "10",
      })
    );
    for (const linie of voll.linien) expect(linie.description).not.toMatch(/[–—]/);
  });
});

describe("Preis nach Gutschrift", () => {
  const mit = an({ [feld["hebel.wertanrechnung"]]: "on", [feld["wertanrechnung.betrag"]]: "40" });

  it("mindert den Betrag und geht nicht unter 0", () => {
    expect(preisNachGutschrift(1630, mit)).toBe(1590);
    expect(preisNachGutschrift(10, mit)).toBe(0);
    expect(rohVorGutschrift(1590, mit, 0)).toBe(1630);
    expect(rohVorGutschrift(0, mit, 1630)).toBe(1630);
  });
});

describe("Prüfung und Rechner-Anfrage", () => {
  it("lehnt kaputte Werte ab und lässt 0 zu", () => {
    expect(pruefeZuschlagWert("hebel.keller", true)).toBe(true);
    expect(pruefeZuschlagWert("elektro.stueck", "3")).toBe(3);
    expect(pruefeZuschlagWert("boden.qm", "12,5")).toBe(12.5);
    expect(() => pruefeZuschlagWert("elektro.stueck", 1.5)).toThrow(/Ganze Zahl/);
    expect(() => pruefeZuschlagWert("wertanrechnung.betrag", -1)).toThrow(/0 bis 100.000/);
  });

  it("nimmt die Zuschlag-Felder vor dem Rechner herunter und lässt die Anfrage sonst gleich", () => {
    const leer = an({ von_etage: "2" });
    expect(anfrageOhneZuschlagFelder(leer)).toBe(leer);
    const mit = an({ von_etage: "2", [feld["hebel.keller"]]: "on", [feld["boden.qm"]]: "12" });
    const ohne = anfrageOhneZuschlagFelder(mit);
    expect(ohne).not.toBe(mit);
    expect(ohne.von_etage).toBe("2");
    expect(ohne[feld["hebel.keller"]]).toBeUndefined();
    expect(ohne[feld["boden.qm"]]).toBeUndefined();
    expect(mit[feld["hebel.keller"]]).toBe("on");
  });

  it("nennt die Planwerte für die Einstellungen", () => {
    const zeilen = entruempelungPreisZeilen();
    expect(zeilen).toHaveLength(8);
    expect(zeilen[0]?.[1]).toContain("35");
  });
});
