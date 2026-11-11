import { describe, it, expect } from "vitest";
import type { Quelle } from "./angebot-aenderung";
import { vergleichVersionen, type VergleichZeile, type VersionsSchnitt } from "./angebot-vergleich";
import type { RechnerAnfrage } from "@/services/rechner/eingabe";
import type { RechnerErgebnis } from "@/services/rechner/client";

function version(teil: Partial<VersionsSchnitt> & Pick<VersionsSchnitt, "version">): VersionsSchnitt {
  return {
    priceCents: null,
    margeProzent: null,
    anfrage: null,
    ergebnis: null,
    ...teil,
  };
}

function zeile(anfrage: RechnerAnfrage): RechnerAnfrage {
  return anfrage;
}

const hand = (): Quelle => "hand";

function schluesselVon(zeilen: VergleichZeile[]): string[] {
  return zeilen.map((z) => z.schluessel);
}

describe("vergleichVersionen", () => {
  it("meldet ein neues Teil und eine andere Kartonzahl", () => {
    const alt = version({
      version: 3,
      anfrage: zeile({ umzugskartons: "8", positionen_freitext: [{ name: "Sofa", menge: 1 }] }),
    });
    const neu = version({
      version: 4,
      anfrage: zeile({
        umzugskartons: "15",
        positionen_freitext: [
          { name: "Sofa", menge: 1 },
          { name: "Fahrrad", menge: 1 },
        ],
      }),
    });

    const v = vergleichVersionen(alt, neu, hand);

    expect(v.zeilen.map((z) => z.art)).toEqual(["teil_hinzu", "eingabe"]);
    expect(v.zeilen[0]).toMatchObject({
      art: "teil_hinzu",
      schluessel: "teil:fahrrad",
      text: "Fahrrad",
      alt: null,
      neu: "1 Stück",
      herkunft: "hand",
    });
    expect(v.zeilen[1]).toMatchObject({
      art: "eingabe",
      schluessel: "eingabe:umzugskartons",
      text: "Umzugskartons",
      alt: "8",
      neu: "15",
    });
    expect(v.altVersion).toBe(3);
    expect(v.neuVersion).toBe(4);
  });

  it("meldet ein Teil, das nur in der alten Version steht", () => {
    const alt = version({
      version: 1,
      anfrage: zeile({ positionen_freitext: [{ name: "Kleiderschrank", menge: 1 }] }),
    });
    const neu = version({ version: 2, anfrage: zeile({ positionen_freitext: [] }) });

    const v = vergleichVersionen(alt, neu, hand);

    expect(v.zeilen).toEqual([
      {
        art: "teil_weg",
        schluessel: "teil:kleiderschrank",
        text: "Kleiderschrank",
        alt: "1 Stück",
        neu: null,
        herkunft: "hand",
      },
    ]);
  });

  it("summiert Sammelzeilen gleichen Namens und meldet nur die geänderte Menge", () => {
    const alt = version({
      version: 1,
      anfrage: zeile({
        positionen_freitext: [
          { name: "Stuhl", menge: 2 },
          { name: "stuhl", menge: 3 },
          { name: "Karton", menge: 2 },
          { name: "karton", menge: 2 },
        ],
      }),
    });
    const neu = version({
      version: 2,
      anfrage: zeile({
        positionen_freitext: [
          { name: "Stuhl", menge: 1 },
          { name: "Stuhl", menge: 1 },
          { name: "Karton", menge: 4 },
        ],
      }),
    });

    const v = vergleichVersionen(alt, neu, hand);

    expect(v.zeilen).toEqual([
      {
        art: "teil_menge",
        schluessel: "teil:stuhl",
        text: "Stuhl",
        alt: "5 Stück",
        neu: "2 Stück",
        herkunft: "hand",
      },
    ]);
  });

  it("stellt Abbau und Aufbau aus der Zeile über die Rechner-Regel zerlegt", () => {
    const bett = { name: "Bett", menge: 1, volumenCbm: 0.8 };
    const alt = version({
      version: 1,
      anfrage: zeile({
        positionen_freitext: [{ name: "Bett", menge: 1 }, { name: "Tisch", menge: 1, abbau: "none", aufbau: "none" }],
      }),
      ergebnis: {
        positionen: [{ ...bett, zerlegt: true }, { name: "Tisch", menge: 1, volumenCbm: 0.3, zerlegt: false }],
      },
    });
    const neu = version({
      version: 2,
      anfrage: zeile({
        positionen_freitext: [
          { name: "Bett", menge: 1, abbau: "customer", aufbau: "none" },
          { name: "Tisch", menge: 1 },
        ],
      }),
      ergebnis: {
        positionen: [{ ...bett, zerlegt: true }, { name: "Tisch", menge: 1, volumenCbm: 0.3, zerlegt: true }],
      },
    });

    const v = vergleichVersionen(alt, neu, hand);

    expect(v.zeilen).toEqual([
      {
        art: "montage",
        schluessel: "montage:bett",
        text: "Bett: Abbau",
        alt: "wir",
        neu: "Kunde",
        herkunft: "hand",
      },
      {
        art: "montage",
        schluessel: "montage:bett",
        text: "Bett: Aufbau",
        alt: "wir",
        neu: "nicht nötig",
        herkunft: "hand",
      },
      {
        art: "montage",
        schluessel: "montage:tisch",
        text: "Tisch: Abbau",
        alt: "nicht nötig",
        neu: "wir",
        herkunft: "hand",
      },
      {
        art: "montage",
        schluessel: "montage:tisch",
        text: "Tisch: Aufbau",
        alt: "nicht nötig",
        neu: "wir",
        herkunft: "hand",
      },
    ]);
  });

  it("meldet beim neuen Teil nur Montage-Seiten, die nötig sind", () => {
    const alt = version({ version: 1, anfrage: zeile({ positionen_freitext: [] }) });
    const neu = version({
      version: 2,
      anfrage: zeile({
        positionen_freitext: [
          { name: "Fahrrad", menge: 2, abbau: "company", aufbau: "none" },
          { name: "Spiegel", menge: 1 },
        ],
      }),
      ergebnis: {
        positionen: [{ name: "Spiegel", menge: 1, volumenCbm: 0.1, zerlegt: true }],
      },
    });

    const v = vergleichVersionen(alt, neu, hand);

    expect(v.zeilen).toEqual([
      {
        art: "teil_hinzu",
        schluessel: "teil:fahrrad",
        text: "Fahrrad",
        alt: null,
        neu: "2 Stück",
        herkunft: "hand",
      },
      {
        art: "teil_hinzu",
        schluessel: "teil:spiegel",
        text: "Spiegel",
        alt: null,
        neu: "1 Stück",
        herkunft: "hand",
      },
      {
        art: "montage",
        schluessel: "montage:fahrrad",
        text: "Fahrrad: Abbau",
        alt: null,
        neu: "wir",
        herkunft: "hand",
      },
      {
        art: "montage",
        schluessel: "montage:spiegel",
        text: "Spiegel: Abbau",
        alt: null,
        neu: "wir",
        herkunft: "hand",
      },
      {
        art: "montage",
        schluessel: "montage:spiegel",
        text: "Spiegel: Aufbau",
        alt: null,
        neu: "wir",
        herkunft: "hand",
      },
    ]);
  });

  it("meldet Halteverbot am Einzug, Etage, Aufzug, Trageweg und Einpacken", () => {
    const alt = version({
      version: 1,
      anfrage: zeile({
        von_halteverbot: "on",
        nach_halteverbot: "on",
        von_etage: "0",
        nach_etage: "2",
        von_aufzug: "keiner",
        von_tragestrecke: "5",
        einpack_kartons: "4",
      }),
    });
    const neu = version({
      version: 2,
      anfrage: zeile({
        von_halteverbot: "on",
        von_etage: "3",
        nach_etage: "2",
        von_aufzug: "gross",
        von_tragestrecke: "12",
      }),
    });

    const v = vergleichVersionen(alt, neu, hand);

    expect(v.zeilen).toEqual([
      {
        art: "eingabe",
        schluessel: "eingabe:halteverbot.entladen",
        text: "Halteverbot Einzug",
        alt: "ja",
        neu: "nein",
        herkunft: "hand",
      },
      {
        art: "eingabe",
        schluessel: "eingabe:beladen.etage",
        text: "Etage Auszug",
        alt: "Erdgeschoss",
        neu: "3. Stock",
        herkunft: "hand",
      },
      {
        art: "eingabe",
        schluessel: "eingabe:beladen.aufzug",
        text: "Aufzug Auszug",
        alt: "kein Aufzug",
        neu: "groß",
        herkunft: "hand",
      },
      {
        art: "eingabe",
        schluessel: "eingabe:beladen.tragweg",
        text: "Trageweg Auszug",
        alt: "5 m",
        neu: "12 m",
        herkunft: "hand",
      },
      {
        art: "eingabe",
        schluessel: "eingabe:einpacken",
        text: "Einpackservice",
        alt: "4 Kartons",
        neu: null,
        herkunft: "hand",
      },
    ]);
  });

  it("meldet Hebel, die nur in einer Version aus sind", () => {
    const alt = version({
      version: 1,
      anfrage: zeile({ hebel_aus: JSON.stringify(["kueche"]) }),
    });
    const neu = version({
      version: 2,
      anfrage: zeile({ hebel_aus: JSON.stringify(["montage"]) }),
    });

    const v = vergleichVersionen(alt, neu, hand);

    expect(v.zeilen).toEqual([
      {
        art: "posten_weg",
        schluessel: "hebel:montage",
        text: "Montage",
        alt: "an",
        neu: "aus",
        herkunft: "hand",
      },
      {
        art: "posten_hinzu",
        schluessel: "hebel:kueche",
        text: "Küche",
        alt: "aus",
        neu: "an",
        herkunft: "hand",
      },
    ]);
  });

  it("meldet neue, entfallene und geänderte Zeit- und Materialposten", () => {
    const alt = version({
      version: 1,
      anfrage: zeile({
        zeitposten: [
          { bezeichnung: "Pause", minuten: 15 },
          { bezeichnung: "Wartezeit", minuten: 10 },
        ],
        material_frei: [{ bezeichnung: "Decken", betrag: 25 }],
      }),
    });
    const neu = version({
      version: 2,
      anfrage: zeile({
        zeitposten: [
          { bezeichnung: "Schwertransport", minuten: 45 },
          { bezeichnung: "Wartezeit", minuten: 10 },
          { bezeichnung: "wartezeit", minuten: 5 },
        ],
        material_frei: [{ bezeichnung: "Folie", betrag: 8 }],
      }),
    });

    const v = vergleichVersionen(alt, neu, hand);

    expect(v.zeilen).toEqual([
      {
        art: "posten_hinzu",
        schluessel: "posten:schwertransport",
        text: "Schwertransport",
        alt: null,
        neu: "45 min",
        herkunft: "hand",
      },
      {
        art: "posten_weg",
        schluessel: "posten:pause",
        text: "Pause",
        alt: "15 min",
        neu: null,
        herkunft: "hand",
      },
      {
        art: "posten_hinzu",
        schluessel: "posten:wartezeit",
        text: "Wartezeit",
        alt: "10 min",
        neu: "15 min",
        herkunft: "hand",
      },
      {
        art: "posten_hinzu",
        schluessel: "posten:folie",
        text: "Folie",
        alt: null,
        neu: "8 €",
        herkunft: "hand",
      },
      {
        art: "posten_weg",
        schluessel: "posten:decken",
        text: "Decken",
        alt: "25 €",
        neu: null,
        herkunft: "hand",
      },
    ]);
  });

  it("setzt Kennzahlen immer, die Differenz nur wenn beide Preise da sind", () => {
    const alt = version({
      version: 1,
      priceCents: 80000,
      margeProzent: 15,
      ergebnis: {
        volumen: { nettoCbm: 12 },
        team: { groesse: 3 },
        kosten: {
          selbstkosten: 400,
          personenH: 99,
          personalStunden: { arbeitPm: 1, fahrerPm: 1, fahrzeitPm: 1, pufferProzent: 0, personenH: 7 },
        },
      },
    });
    const neu = version({
      version: 2,
      priceCents: 50000,
      margeProzent: 18,
      ergebnis: {
        volumen: { nettoCbm: 12 },
        team: { groesse: 3 },
        kosten: { selbstkosten: 300, personenH: 4 },
      },
    });

    const gleich = vergleichVersionen(alt, neu, hand);
    expect(gleich.zeilen).toEqual([]);
    expect(gleich.volumenCbm).toEqual({ alt: 12, neu: 12 });
    expect(gleich.team).toEqual({ alt: 3, neu: 3 });
    expect(gleich.personenStunden).toEqual({ alt: 7, neu: 4 });
    expect(gleich.preisCent).toEqual({ alt: 80000, neu: 50000, differenzCent: -30000 });
    expect(gleich.margeProzent).toEqual({ alt: 15, neu: 18 });

    const luecke = vergleichVersionen(alt, version({ version: 3, priceCents: null, margeProzent: null, ergebnis: {} }), hand);
    expect(luecke.preisCent).toEqual({ alt: 80000, neu: null, differenzCent: null });
    expect(luecke.volumenCbm).toEqual({ alt: 12, neu: null });
    expect(luecke.team).toEqual({ alt: 3, neu: null });
    expect(luecke.personenStunden).toEqual({ alt: 7, neu: null });
    expect(luecke.margeProzent).toEqual({ alt: 15, neu: null });
  });

  it("übernimmt die Herkunft je Zeile und ruft sie je Zeile auf", () => {
    const aufrufe: string[] = [];
    const herkunft = (schluessel: string): Quelle => {
      aufrufe.push(schluessel);
      if (schluessel === "teil:fahrrad") return "chat";
      if (schluessel === "eingabe:umzugskartons") return "eingabe";
      if (schluessel === "hebel:montage") return "bot";
      return "hand";
    };
    const alt = version({
      version: 1,
      anfrage: zeile({ umzugskartons: "1", positionen_freitext: [{ name: "Sofa", menge: 1 }] }),
    });
    const neu = version({
      version: 2,
      anfrage: zeile({
        umzugskartons: "2",
        hebel_aus: JSON.stringify(["montage"]),
        positionen_freitext: [
          { name: "Sofa", menge: 1 },
          { name: "Fahrrad", menge: 1 },
        ],
      }),
    });

    const v = vergleichVersionen(alt, neu, herkunft);

    expect(aufrufe).toEqual(schluesselVon(v.zeilen));
    expect(v.zeilen.map((z) => [z.schluessel, z.herkunft])).toEqual([
      ["teil:fahrrad", "chat"],
      ["eingabe:umzugskartons", "eingabe"],
      ["hebel:montage", "bot"],
    ]);
  });

  it("hält die Reihenfolge Teile, Montage, Eingaben, Posten ein", () => {
    const alt = version({
      version: 1,
      anfrage: zeile({
        nach_halteverbot: "on",
        positionen_freitext: [
          { name: "Schrank", menge: 1 },
          { name: "Stuhl", menge: 1 },
          { name: "Bett", menge: 1 },
        ],
        zeitposten: [{ bezeichnung: "Pause", minuten: 10 }],
      }),
      ergebnis: { positionen: [{ name: "Bett", menge: 1, volumenCbm: 0.8, zerlegt: true }] },
    });
    const neu = version({
      version: 2,
      anfrage: zeile({
        hebel_aus: JSON.stringify(["montage"]),
        positionen_freitext: [
          { name: "Fahrrad", menge: 1, abbau: "company", aufbau: "customer" },
          { name: "Stuhl", menge: 3 },
          { name: "Bett", menge: 1, abbau: "customer", aufbau: "none" },
        ],
        zeitposten: [{ bezeichnung: "Schwertransport", minuten: 20 }],
      }),
    });

    const v = vergleichVersionen(alt, neu, hand);

    expect(v.zeilen.map((z) => `${z.art}:${z.text}`)).toEqual([
      "teil_hinzu:Fahrrad",
      "teil_weg:Schrank",
      "teil_menge:Stuhl",
      "montage:Fahrrad: Abbau",
      "montage:Fahrrad: Aufbau",
      "montage:Bett: Abbau",
      "montage:Bett: Aufbau",
      "eingabe:Halteverbot Einzug",
      "posten_weg:Montage",
      "posten_hinzu:Schwertransport",
      "posten_weg:Pause",
    ]);
  });

  it("wirft bei leeren Schnitten nicht und behandelt fehlende Anfrage als ohne Felder", () => {
    const leer = vergleichVersionen(
      version({ version: 1, priceCents: 500, margeProzent: 10 }),
      version({ version: 2 }),
      hand
    );
    expect(leer.zeilen).toEqual([]);
    expect(leer.volumenCbm).toEqual({ alt: null, neu: null });
    expect(leer.team).toEqual({ alt: null, neu: null });
    expect(leer.personenStunden).toEqual({ alt: null, neu: null });
    expect(leer.preisCent).toEqual({ alt: 500, neu: null, differenzCent: null });
    expect(leer.margeProzent).toEqual({ alt: 10, neu: null });

    const nurNeu = vergleichVersionen(
      version({ version: 1 }),
      version({
        version: 2,
        anfrage: zeile({
          hebel_aus: "kein-json",
          von_halteverbot: "on",
          positionen_freitext: [{ name: "Lampe", menge: 1, abbau: "company", aufbau: "none" }],
        }),
        ergebnis: null,
      }),
      hand
    );
    expect(nurNeu.zeilen.map((z) => z.art)).toEqual(["teil_hinzu", "montage", "eingabe"]);
    expect(nurNeu.zeilen[1]).toMatchObject({ text: "Lampe: Abbau", alt: null, neu: "wir" });
    expect(nurNeu.zeilen[2]).toMatchObject({
      schluessel: "eingabe:halteverbot.beladen",
      alt: "nein",
      neu: "ja",
    });
  });
});
