import { describe, expect, it } from "vitest";
import type { RechnerErgebnis } from "@/services/rechner/client";
import { annahmenKasten, fahrtAnsicht, fahrtUnterzeilen, fehlendeAdressen, positionenOhneKatalog, teamGrund, type AdressInfo } from "./kalkulation-annahmen";
import type { Uebersteuerung } from "./kalkulation-versionen";

const geschaetzt = { km: 20, min: 30, quelle: "angenommen" as const };

/** Lage des Inhabers: 2 Touren, 5 Personen, alles geschätzt (30 + 3 × 25 + 30 min). */
const zweiTouren: RechnerErgebnis = {
  team: { groesse: 5, quelle: "traeger" },
  kosten: { selbstkosten: 900, personalStunden: { arbeitPm: 900, fahrerPm: 0, fahrzeitPm: 675, pufferProzent: 10, personenH: 30 } },
  fahrtAufschluesselung: {
    anfahrt: geschaetzt,
    strecke: { km: 15, min: 25, quelle: "angenommen" },
    rueckfahrt: geschaetzt,
    fahrten: 2,
    wege: 3,
    fahrtMin: 135,
  },
  mietstation: { name: "Sixt", anbieter: "sixt", adresse: "Stationsweg 1, 71229 Leonberg", quelle: "angenommen", anfahrtKm: 20, anfahrtMin: 30, rueckfahrtKm: 20, rueckfahrtMin: 30 },
  positionen: [
    { name: "Eckbank", menge: 1, volumenCbm: 2, ungeprueft: true, groessenklasse: "sperrig", gewichtKg: 120, mindestTraeger: 3 },
    { name: "Bett", menge: 1, volumenCbm: 1.2, ungeprueft: false },
  ],
  hinweise: [{ typ: "traeger", text: "Eckbank: mindestens 3 Träger nötig" }],
};

describe("fahrtAnsicht (Bauteile 9 und 12)", () => {
  it("2 Touren, 5 Personen, alles geschätzt: 30 + 25 + 25 + 25 + 30 min, 12,38 h", () => {
    const f = fahrtAnsicht(zweiTouren, {})!;
    expect(f.strecken.map((s) => [s.key, s.min, s.quelleText])).toEqual([
      ["anfahrt", 30, "geschätzt"],
      ["tour.1", 25, "geschätzt"],
      ["rueckweg.1", 25, "geschätzt"],
      ["tour.2", 25, "geschätzt"],
      ["rueckfahrt", 30, "geschätzt"],
    ]);
    expect(f.strecken.reduce((s, x) => s + x.min, 0)).toBe(135);
    expect(f.rechnung).toBe("2,25 h je Person × 5 Personen + 10 % Puffer = 12,38 h");
    expect(f.hinweis).toBeNull();
    expect(fahrtUnterzeilen(f).at(-1)).toEqual({ key: "fahrt.rechnung", label: "= 2,25 h je Person × 5 Personen + 10 % Puffer = 12,38 h", wert: "" });
  });

  it("Google mit nur PLZ: „ungefähr (nur PLZ)“, mit Straße „Google“", () => {
    const e: RechnerErgebnis = {
      ...zweiTouren,
      fahrtAufschluesselung: { ...zweiTouren.fahrtAufschluesselung!, anfahrt: { km: 9, min: 15, quelle: "google" }, fahrten: 1, wege: 1, fahrtMin: 70 },
    };
    expect(fahrtAnsicht(e, { von_adresse: "70372 Stuttgart" })!.strecken[0].quelleText).toBe("ungefähr (nur PLZ)");
    expect(fahrtAnsicht(e, { von_adresse: "Hauptstr. 5, 70372 Stuttgart" })!.strecken[0].quelleText).toBe("Google");
  });

  it("ohne Aufschlüsselung (alter Rechner) null", () => {
    expect(fahrtAnsicht({ team: { groesse: 2 } }, {})).toBeNull();
  });
});

describe("teamGrund (Bauteil 11)", () => {
  it("Träger wegen eines geschätzten Möbels", () => {
    expect(teamGrund(zweiTouren)).toBe("5 Träger wegen Eckbank, geschätzt sperrig");
  });
  it("Staffel und Arbeitstag", () => {
    expect(teamGrund({ team: { groesse: 3, quelle: "staffel" }, volumen: { nettoCbm: 25, ladeCbm: 30 } })).toBe("3 Personen nach Volumen (30 m³ Ladevolumen)");
    expect(teamGrund({ team: { groesse: 4, quelle: "arbeitstag" } })).toMatch(/einem Arbeitstag/);
  });
});

describe("fehlendeAdressen (Bauteil 5)", () => {
  it("Chat-PLZ zählt als vorhanden; Entrümpelung braucht keine Entladeadresse", () => {
    expect(fehlendeAdressen({})).toEqual({ beladen: true, entladen: false });
    expect(fehlendeAdressen({ auftragsart: "umzug" })).toEqual({ beladen: true, entladen: true });
    expect(fehlendeAdressen({ von_adresse: "70372 Stuttgart", nach_adresse: "71032 Böblingen" })).toEqual({ beladen: false, entladen: false });
    expect(fehlendeAdressen({ von_adresse: "70372 Stuttgart", auftragsart: "entruempelung" })).toEqual({ beladen: false, entladen: false });
  });
});

const keine: AdressInfo = { text: null, quelle: "fehlt", genau: false };
const ue = (art: Uebersteuerung["art"], key: string, wert: Uebersteuerung["wert"], extra: Partial<Uebersteuerung> = {}): Uebersteuerung => ({
  id: key, art, key, wert, grund: "g", rechnerwert: null, autor: { userId: "u1", quelle: "mensch" }, zeit: "2026-11-09T10:00:00.000Z", fotoRef: null, ...extra,
});

describe("annahmenKasten (Bauteil 1)", () => {
  const positionen = positionenOhneKatalog(zweiTouren, [], () => "Dario", (t) => t);

  it("Viktoria ohne Adressen: Adressen fehlen, Fahrzeit geschätzt, Positionen ohne Katalog, Kartons, Team", () => {
    const k = annahmenKasten({
      ergebnis: zweiTouren,
      anfrage: { nach_vorhanden: "on", auftragsart: "umzug" },
      adressen: { beladen: keine, entladen: keine },
      fahrt: fahrtAnsicht(zweiTouren, {}),
      positionen,
      overrides: [],
    })!;
    const g = Object.fromEntries(k.gruppen.map((x) => [x.key, x.zeilen.map((z) => z.text)]));
    expect(g.adressen).toEqual(["Beladeadresse fehlt: Fahrzeiten zur Station geschätzt", "Entladeadresse fehlt: Strecke Beladen → Entladen geschätzt"]);
    expect(g.fahrzeit).toEqual(["Anfahrt Station → Beladen geschätzt: 30 min", "Weg Beladen → Entladen geschätzt: 25 min je Weg", "Rückfahrt zur Station geschätzt: 30 min"]);
    expect(g.volumen).toEqual([
      "1 Position ohne Katalogtreffer: Volumen und Gewicht nach Größenklasse geschätzt",
      "Kartons und Kleinkram nicht erfasst (keine Zimmer, keine Wohnfläche, keine Kartons)",
    ]);
    expect(k.gruppen.find((x) => x.key === "volumen")!.zeilen[0].details).toEqual(["Eckbank: sperrig, 2 m³, 120 kg"]);
    expect(g.team).toEqual(["5 Träger wegen Eckbank, geschätzt sperrig"]);
    expect(k.gruppen.find((x) => x.key === "team")!.zeilen[0].ziel).toBe("team");
  });

  it("Adressen aus dem Chat statt „fehlt“", () => {
    const chat: AdressInfo = { text: "70372 Stuttgart", quelle: "chat", genau: false, chatQuelle: "erkennung" };
    const k = annahmenKasten({
      ergebnis: zweiTouren,
      anfrage: { von_adresse: "70372 Stuttgart", nach_adresse: "71032 Böblingen", umzugskartons: "15" },
      adressen: { beladen: chat, entladen: { ...chat, text: "71032 Böblingen" } },
      fahrt: null,
      positionen: [],
      overrides: [],
    })!;
    expect(k.gruppen.find((x) => x.key === "adressen")!.zeilen.map((z) => z.text)).toEqual(["Adressen aus dem Chat (PLZ), unbestätigt"]);
  });

  it("umgedeutete Kartons: „bitte prüfen“", () => {
    const k = annahmenKasten({
      ergebnis: zweiTouren,
      anfrage: { von_adresse: "Hauptstr. 1, 70372 Stuttgart", nach_adresse: "Am Bach 2, 71032 Böblingen", umzugskartons: "15" },
      adressen: { beladen: { text: "x", quelle: "lead", genau: true }, entladen: { text: "y", quelle: "lead", genau: true } },
      fahrt: null,
      positionen: [],
      overrides: [ue("eingabe", "umzugskartons", 15, { umgedeutet: "kartons" })],
    })!;
    expect(k.gruppen.flatMap((x) => x.zeilen.map((z) => z.text))).toContain("Kartons wurden früher als Einpackservice gerechnet, bitte prüfen");
  });

  it("ohne Annahmen und mit Team nach Staffel: kein Kasten", () => {
    expect(
      annahmenKasten({
        ergebnis: { team: { groesse: 2, quelle: "staffel" }, kartonSchaetzung: { wohnflaecheQm: 60, kartonsProQm: 0.7, kartonzahl: 42 } },
        anfrage: { von_adresse: "Hauptstr. 1, 70372 Stuttgart", nach_adresse: "Am Bach 2, 71032 Böblingen" },
        adressen: { beladen: { text: "x", quelle: "lead", genau: true }, entladen: { text: "y", quelle: "lead", genau: true } },
        fahrt: null,
        positionen: [],
        overrides: [],
      })
    ).toBeNull();
  });
});

describe("Katalogquote unter 80 % (Bauteil 7)", () => {
  it("nennt die pauschale Tragezeit", () => {
    const k = annahmenKasten({
      ergebnis: { ...zweiTouren, zeiten: { methode: "volumen" } },
      anfrage: { von_adresse: "Hauptstr. 1, 70372 Stuttgart", nach_adresse: "Am Bach 2, 71032 Böblingen", umzugskartons: "10" },
      adressen: { beladen: { text: "x", quelle: "lead", genau: true }, entladen: { text: "y", quelle: "lead", genau: true } },
      fahrt: null,
      positionen: [],
      overrides: [],
    })!;
    expect(k.gruppen.flatMap((x) => x.zeilen.map((z) => z.text))).toContain("Tragezeit pauschal nach Volumen, weil 1 von 2 Teilen unbekannt");
  });
});

describe("positionenOhneKatalog (Bauteil 3)", () => {
  it("mit Korrektur der Version", () => {
    const [p] = positionenOhneKatalog(zweiTouren, [ue("position", "eckbank", { groessenklasse: "gross", volumenCbm: 1 }, { grund: "Foto geprüft" })], () => "Dario", (t) => t);
    expect(p).toMatchObject({ key: "eckbank", name: "Eckbank", groessenklasse: "sperrig", korrektur: { groessenklasse: "gross", volumenCbm: 1, grund: "Foto geprüft", von: "Dario" } });
  });
});
