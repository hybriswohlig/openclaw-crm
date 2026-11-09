import { describe, expect, it } from "vitest";
import { rechnerAnfrageAus, type LeadDaten, type RechnerAnfrage } from "@/services/rechner/eingabe";
import type { RechnerErgebnis } from "@/services/rechner/client";
import {
  anfrageMitUebersteuerungen,
  grundlageAus,
  kostenzeilenAus,
  pruefeUebersteuerung,
  GRUNDLAGE_FELDER,
  rechnerwertFuer,
  UebersteuerungFehler,
  wirksameUebersteuerungen,
  type Uebersteuerung,
} from "./kalkulation-versionen";

let zaehler = 0;
function ue(art: Uebersteuerung["art"], key: string, wert: Uebersteuerung["wert"], extra: Partial<Uebersteuerung> = {}): Uebersteuerung {
  zaehler += 1;
  return {
    id: `u${zaehler}`,
    art,
    key,
    rechnerwert: null,
    wert,
    grund: "Test",
    autor: { userId: "user-1", quelle: "mensch" },
    zeit: `2026-11-05T10:00:${String(zaehler % 60).padStart(2, "0")}.000Z`,
    fotoRef: null,
    ...extra,
  };
}

function lead(teil: Partial<LeadDaten> = {}): LeadDaten {
  return {
    von: "Hauptstr. 1, 71032 Böblingen",
    nach: "Marktplatz 2, 70173 Stuttgart",
    etageVon: 2,
    etageNach: null,
    zugangVon: "Treppe",
    zugangNach: null,
    umzugsdatum: "2026-12-01",
    wohnflaecheQm: 70,
    zimmer: 3,
    tragestreckeVonM: null,
    tragestreckeNachM: null,
    halteverbot: false,
    packService: false,
    kartons: null,
    inventar: [],
    ...teil,
  };
}

const zeile = (name: string, quelle?: "chat" | "foto" | "operator") => ({
  name,
  menge: 1,
  groessenklasse: null,
  volumenCbm: null,
  mitnehmen: true,
  ...(quelle ? { quelle } : {}),
});

describe("pruefeUebersteuerung", () => {
  it("verlangt einen Grund", () => {
    expect(() => pruefeUebersteuerung({ art: "marge", key: "marge", wert: 45, grund: "" })).toThrow("Grund fehlt");
    expect(() => pruefeUebersteuerung({ art: "marge", key: "marge", wert: 45, grund: "   " })).toThrow("Grund fehlt");
    expect(() => pruefeUebersteuerung({ art: "marge", key: "marge", wert: 45, grund: "   " })).toThrow(UebersteuerungFehler);
  });

  it("lehnt eine Marge außerhalb 30–60 % ab", () => {
    expect(() => pruefeUebersteuerung({ art: "marge", key: "marge", wert: 25, grund: "Stammkunde" })).toThrow(
      "Marge zwischen 30 und 60 %"
    );
    expect(() => pruefeUebersteuerung({ art: "marge", key: "marge", wert: 61, grund: "x" })).toThrow("Marge zwischen 30 und 60 %");
    expect(pruefeUebersteuerung({ art: "marge", key: "marge", wert: 45, grund: "x" })).toMatchObject({ art: "marge", key: "marge", wert: 45 });
  });

  it("kennt nur die Grundlage-Felder als Eingabe", () => {
    expect(() => pruefeUebersteuerung({ art: "eingabe", key: "montage", wert: 1, grund: "x" })).toThrow("Unbekanntes Feld: montage");
    expect(pruefeUebersteuerung({ art: "eingabe", key: "beladen.etage", wert: 3, grund: "x" })).toMatchObject({ wert: 3 });
  });

  it("nimmt einen Satz an", () => {
    expect(pruefeUebersteuerung({ art: "satz", key: "arbeit", wert: 20, grund: "Tarif" })).toMatchObject({
      art: "satz",
      key: "arbeit",
      wert: 20,
    });
    expect(() => pruefeUebersteuerung({ art: "satz", key: "nacht", wert: 20, grund: "x" })).toThrow(UebersteuerungFehler);
  });

  it("lehnt einen negativen Zeilenbetrag ab", () => {
    expect(() => pruefeUebersteuerung({ art: "zeile", key: "halteverbot", wert: -1, grund: "x" })).toThrow(UebersteuerungFehler);
    expect(pruefeUebersteuerung({ art: "zeile", key: "halteverbot", wert: 0, grund: "x" })).toMatchObject({ wert: 0 });
  });

  it("nimmt Zeitposten an und null zum Entfernen", () => {
    expect(
      pruefeUebersteuerung({ art: "zeitposten", key: "klavier", wert: { bezeichnung: "Klavier", minuten: 90 }, grund: "Foto" })
    ).toEqual({ art: "zeitposten", key: "klavier", wert: { bezeichnung: "Klavier", minuten: 90 }, grund: "Foto" });
    expect(pruefeUebersteuerung({ art: "zeitposten", key: "klavier", wert: null, grund: "doch nicht" })).toMatchObject({
      art: "zeitposten",
      key: "klavier",
      wert: null,
    });
  });

  it("prüft Team, Volumen und Termin", () => {
    expect(() => pruefeUebersteuerung({ art: "eingabe", key: "team", wert: 21, grund: "x" })).toThrow(UebersteuerungFehler);
    expect(pruefeUebersteuerung({ art: "eingabe", key: "team", wert: 20, grund: "x" })).toMatchObject({ wert: 20 });
    expect(() => pruefeUebersteuerung({ art: "eingabe", key: "team", wert: 2.5, grund: "x" })).toThrow(UebersteuerungFehler);
    expect(() => pruefeUebersteuerung({ art: "eingabe", key: "volumen", wert: 0, grund: "x" })).toThrow(UebersteuerungFehler);
    expect(() => pruefeUebersteuerung({ art: "eingabe", key: "termin", wert: "2026-02-30", grund: "x" })).toThrow(UebersteuerungFehler);
    expect(pruefeUebersteuerung({ art: "eingabe", key: "termin", wert: "2026-12-03", grund: "x" })).toMatchObject({ wert: "2026-12-03" });
    expect(pruefeUebersteuerung({ art: "eingabe", key: "halteverbot.beladen", wert: true, grund: "x" })).toMatchObject({ wert: true });
  });

  it("nimmt Etagen mit höchstens einer Nachkommastelle", () => {
    expect(pruefeUebersteuerung({ art: "eingabe", key: "beladen.etage", wert: 0.5, grund: "Hochparterre" })).toMatchObject({ wert: 0.5 });
    expect(pruefeUebersteuerung({ art: "eingabe", key: "entladen.etage", wert: "-1", grund: "Keller" })).toMatchObject({ wert: -1 });
    expect(() => pruefeUebersteuerung({ art: "eingabe", key: "beladen.etage", wert: 1.25, grund: "x" })).toThrow(UebersteuerungFehler);
    expect(() => pruefeUebersteuerung({ art: "eingabe", key: "beladen.etage", wert: 60.5, grund: "x" })).toThrow(UebersteuerungFehler);
    expect(() => pruefeUebersteuerung({ art: "eingabe", key: "beladen.etage", wert: -5.5, grund: "x" })).toThrow(UebersteuerungFehler);
  });

  it("schreibt groß beim Aufzug als gross", () => {
    expect(pruefeUebersteuerung({ art: "eingabe", key: "beladen.aufzug", wert: "Groß", grund: "x" })).toMatchObject({ wert: "gross" });
  });

  it("lehnt Zeilen ab, die der Rechner nicht übersteuern kann", () => {
    expect(() => pruefeUebersteuerung({ art: "zeile", key: "zeile.0", wert: 10, grund: "x" })).toThrow("Zeile nicht übersteuerbar: zeile.0");
    expect(() => pruefeUebersteuerung({ art: "zeile", key: "verkauf.halteverbot", wert: 10, grund: "x" })).toThrow(UebersteuerungFehler);
  });

  it("lehnt Kostenzeilen des freien Materials ab (Index rückt beim Entfernen nach), auch zum Aufheben", () => {
    const text = "Freies Material bitte über material_frei ändern, nicht über die Kostenzeile.";
    expect(() => pruefeUebersteuerung({ art: "zeile", key: "material_frei.0", wert: 5, grund: "x" })).toThrow(text);
    expect(() => pruefeUebersteuerung({ art: "zeile", key: " material_frei.1 ", wert: null, grund: "x" })).toThrow(UebersteuerungFehler);
    // Der benannte Eintrag selbst bleibt änderbar.
    expect(pruefeUebersteuerung({ art: "material_frei", key: "folie", wert: { bezeichnung: "Folie", betrag: 5 }, grund: "x" })).toMatchObject({
      wert: { bezeichnung: "Folie", betrag: 5 },
    });
  });

  it("lehnt eine unbekannte Art ab", () => {
    expect(() => pruefeUebersteuerung({ art: "rabatt", key: "x", wert: 1, grund: "x" })).toThrow(UebersteuerungFehler);
  });
});

describe("wirksameUebersteuerungen", () => {
  it("je Art und Schlüssel die letzte, aufgehobene fallen weg", () => {
    const liste = [
      ue("marge", "marge", 45),
      ue("material_frei", "decke", { bezeichnung: "Decke", betrag: 20 }),
      ue("zeile", "halteverbot", 0),
      ue("material_frei", "decke", null),
      ue("zeile", "halteverbot", 80),
    ];
    expect(wirksameUebersteuerungen(liste).map((u) => [u.art, u.key, u.wert])).toEqual([
      ["marge", "marge", 45],
      ["zeile", "halteverbot", 80],
    ]);
    expect(wirksameUebersteuerungen([])).toEqual([]);
  });
});

describe("anfrageMitUebersteuerungen", () => {
  const ref = { referenceDate: "2026-11-05" };

  it("nimmt die spätere Eingabe und setzt heute auf das Bezugsdatum", () => {
    const basis: RechnerAnfrage = { von_etage: "2", heute: "2026-11-01" };
    const aus = anfrageMitUebersteuerungen(basis, [ue("eingabe", "beladen.etage", 3), ue("eingabe", "beladen.etage", 4)], ref);
    expect(aus.von_etage).toBe("4");
    expect(aus.heute).toBe("2026-11-05");
  });

  it("setzt und entfernt das Halteverbot", () => {
    expect(anfrageMitUebersteuerungen({ von_halteverbot: "on" }, [ue("eingabe", "halteverbot.beladen", false)], ref)).not.toHaveProperty(
      "von_halteverbot"
    );
    expect(anfrageMitUebersteuerungen({}, [ue("eingabe", "halteverbot.beladen", true)], ref).von_halteverbot).toBe("on");
  });

  it("entfernt einen Zeitposten mit wert null", () => {
    const aus = anfrageMitUebersteuerungen(
      {},
      [
        ue("zeitposten", "klavier", { bezeichnung: "Klavier", minuten: 90 }, { grund: "Foto" }),
        ue("zeitposten", "aquarium", { bezeichnung: "Aquarium", minuten: 30 }, { grund: "Chat" }),
        ue("zeitposten", "klavier", null),
      ],
      ref
    );
    expect(aus.zeitposten).toEqual([{ bezeichnung: "Aquarium", minuten: 30, grund: "Chat" }]);
  });

  it("übersetzt Zeile, Marge und Satz", () => {
    const aus = anfrageMitUebersteuerungen(
      {},
      [ue("zeile", "halteverbot", 0), ue("marge", "marge", 45), ue("satz", "fahrt", 15)],
      ref
    );
    expect(aus.zeilen_uebersteuerung).toEqual([{ key: "halteverbot", betrag: 0 }]);
    expect(aus.marge_prozent).toBe("45");
    expect(aus.satz_fahrt).toBe("15");
  });

  it("übersetzt Volumen, Team, Termin und freies Material", () => {
    const aus = anfrageMitUebersteuerungen(
      { einpack_ohne_anzahl: "on" },
      [
        ue("eingabe", "volumen", 18.5),
        ue("eingabe", "team", 3),
        ue("eingabe", "termin", "2026-12-03"),
        ue("eingabe", "einpacken", 40),
        ue("material_frei", "folie", { bezeichnung: "Stretchfolie", betrag: 12.5 }),
      ],
      ref
    );
    expect(aus.volumen_cbm_vorgabe).toBe("18.5");
    expect(aus.teamgroesse).toBe("3");
    expect(aus.umzugsdatum).toBe("2026-12-03");
    expect(aus.einpack_kartons).toBe("40");
    expect(aus).not.toHaveProperty("einpack_ohne_anzahl");
    expect(aus.material_frei).toEqual([{ bezeichnung: "Stretchfolie", betrag: 12.5 }]);
  });

  it("schickt die Paket-Hebel als JSON-Text", () => {
    const aus = anfrageMitUebersteuerungen({}, [], { ...ref, paketHebel: { komfort: ["montage", "halteverbot"] } });
    expect(aus.paket_hebel).toBe(JSON.stringify({ komfort: ["montage", "halteverbot"] }));
  });

  it("verändert die Basis nicht", () => {
    const basis: RechnerAnfrage = { von_etage: "2", heute: "2026-11-01", von_halteverbot: "on", positionen_freitext: [{ name: "Sofa", menge: 1 }] };
    const kopie = structuredClone(basis);
    anfrageMitUebersteuerungen(basis, [ue("eingabe", "beladen.etage", 4), ue("eingabe", "halteverbot.beladen", false), ue("marge", "marge", 45)], ref);
    expect(basis).toEqual(kopie);
  });
});

describe("grundlageAus", () => {
  const herkunft = (zeilen: ReturnType<typeof grundlageAus>, key: string) => zeilen.find((z) => z.key === key)?.herkunft;

  it("leitet die Herkunft des Volumens aus dem Inventar ab", () => {
    expect(herkunft(grundlageAus(lead({ inventar: [zeile("Sofa", "chat"), zeile("Schrank", "foto")] }), null, []), "volumen")).toBe("FOTO");
    expect(herkunft(grundlageAus(lead({ inventar: [zeile("Sofa", "chat")] }), null, []), "volumen")).toBe("CHAT");
    expect(herkunft(grundlageAus(lead({ inventar: [] }), null, []), "volumen")).toBe("REGEL");
  });

  it("nimmt das Volumen aus dem Ergebnis", () => {
    const ergebnis: RechnerErgebnis = { volumen: { nettoCbm: 21.4 } };
    expect(grundlageAus(lead(), ergebnis, []).find((z) => z.key === "volumen")?.wert).toBe(21.4);
  });

  it("ohne Umzugsdatum gilt der Termin als Standard", () => {
    expect(herkunft(grundlageAus(lead({ umzugsdatum: null }), null, []), "termin")).toBe("STANDARD");
    expect(herkunft(grundlageAus(lead(), null, []), "termin")).toBe("KUNDE");
  });

  it("zeigt eine Eingabe-Übersteuerung als manuell (Altschlüssel kartons gilt als Umzugskartons)", () => {
    const z = grundlageAus(lead({ packService: true, kartons: 20 }), null, [ue("eingabe", "kartons", 35)]).find((r) => r.key === "umzugskartons");
    expect(z).toMatchObject({ key: "umzugskartons", wert: 35, herkunft: "MANUELL", autor: "user-1" });
    const e = grundlageAus(lead({ packService: true, kartons: 20 }), null, []).find((r) => r.key === "einpacken");
    expect(e).toMatchObject({ wert: 20, herkunft: "KUNDE" });
  });

  it("Erdgeschoss ohne Etage ergibt Etage 0 vom Kunden, wie in der Anfrage", () => {
    const l = lead({ etageVon: null, zugangVon: "Erdgeschoss", etageNach: null, zugangNach: "Nicht nötig (Einfamilienhaus)" });
    const zeilen = grundlageAus(l, null, []);
    expect(zeilen.find((z) => z.key === "beladen.etage")).toMatchObject({ wert: 0, herkunft: "KUNDE" });
    expect(zeilen.find((z) => z.key === "beladen.aufzug")).toMatchObject({ wert: "keiner", herkunft: "KUNDE" });
    expect(zeilen.find((z) => z.key === "entladen.etage")).toMatchObject({ wert: 0, herkunft: "KUNDE" });
    const anfrage = rechnerAnfrageAus(l, { heute: "2026-11-05" });
    expect(rechnerwertFuer("eingabe", "beladen.etage", anfrage, null)).toBe(0);
    expect(rechnerwertFuer("eingabe", "beladen.aufzug", anfrage, null)).toBe("keiner");
    expect(rechnerwertFuer("eingabe", "entladen.etage", anfrage, null)).toBe(0);
  });

  it("Aufzug ohne Etage bleibt Standard bei der Etage", () => {
    const zeilen = grundlageAus(lead({ etageVon: null, zugangVon: "Aufzug" }), null, []);
    expect(zeilen.find((z) => z.key === "beladen.etage")).toMatchObject({ wert: null, herkunft: "STANDARD" });
    expect(zeilen.find((z) => z.key === "beladen.aufzug")).toMatchObject({ wert: "klein", herkunft: "KUNDE" });
  });

  it("liefert jede Grundlage-Zeile genau einmal", () => {
    const keys = grundlageAus(lead(), null, []).map((z) => z.key);
    expect(keys).toEqual([
      "volumen",
      "beladen.etage",
      "beladen.aufzug",
      "beladen.tragweg",
      "entladen.etage",
      "entladen.aufzug",
      "entladen.tragweg",
      "halteverbot.beladen",
      "halteverbot.entladen",
      "umzugskartons",
      "einpacken",
      "zimmer",
      "wohnflaeche",
      "fahrt.anfahrt_min",
      "fahrt.anfahrt_km",
      "fahrt.strecke_min",
      "fahrt.strecke_km",
      "fahrt.rueckfahrt_min",
      "fahrt.rueckfahrt_km",
      "hebel.montage",
      "hebel.kueche",
      "team",
      "termin",
      "anfahrt_team",
      "station",
      "fahrzeugklasse",
    ]);
  });

  it("Plan 12a: Anfahrt Team nur als Übersteuerung, 0 bis 1.000 Euro, geht als anfahrtsgeld_team an den Rechner", () => {
    expect(grundlageAus(lead(), null, []).find((z) => z.key === "anfahrt_team")).toMatchObject({ wert: null, herkunft: "STANDARD" });
    expect(pruefeUebersteuerung({ art: "eingabe", key: "anfahrt_team", wert: "38,40", grund: "Einsatz" }).wert).toBe(38.4);
    expect(() => pruefeUebersteuerung({ art: "eingabe", key: "anfahrt_team", wert: 1000.01, grund: "x" })).toThrow(/1.000 Euro/);
    expect(() => pruefeUebersteuerung({ art: "eingabe", key: "anfahrt_team", wert: -1, grund: "x" })).toThrow();
    expect(GRUNDLAGE_FELDER.anfahrt_team).toBe("anfahrtsgeld_team");
  });
});

describe("kostenzeilenAus", () => {
  const ergebnis: RechnerErgebnis = {
    kosten: {
      selbstkosten: 900,
      posten: [
        { bezeichnung: "Personal", menge: 10, einheit: "h", satz: 20, betrag: 200 },
        { bezeichnung: "Halteverbotszone", menge: null, einheit: null, satz: null, betrag: 120, key: "halteverbot", formel: null },
        {
          bezeichnung: "Personal Arbeit (Arbeit, Fahrzeugübergabe, Puffer)",
          menge: 10,
          einheit: "h",
          satz: 20,
          betrag: 200,
          key: "personal.arbeit",
          formel: "10 Personenstunden × 20,00 €/h",
        },
      ],
    },
  };

  it("vergibt Ersatzschlüssel und markiert übersteuerte Zeilen", () => {
    const zeilen = kostenzeilenAus(ergebnis, [ue("zeile", "halteverbot", 0)]);
    expect(zeilen).toEqual([
      { key: "zeile.0", bezeichnung: "Personal", formel: null, betrag: 200, uebersteuert: false },
      { key: "halteverbot", bezeichnung: "Halteverbotszone", formel: null, betrag: 120, uebersteuert: true },
      {
        key: "personal.arbeit",
        bezeichnung: "Personal Arbeit (Arbeit, Fahrzeugübergabe, Puffer)",
        formel: "10 Personenstunden × 20,00 €/h",
        betrag: 200,
        uebersteuert: false,
      },
    ]);
  });

  it("ohne Ergebnis keine Zeilen", () => {
    expect(kostenzeilenAus(null, [])).toEqual([]);
  });
});

describe("rechnerwertFuer", () => {
  const ergebnis: RechnerErgebnis = {
    volumen: { nettoCbm: 21.4 },
    team: { groesse: 3 },
    preis: { festpreis: 1500, margeWirksamProzent: 42 },
    kosten: {
      selbstkosten: 900,
      posten: [
        { bezeichnung: "Halteverbotszone", menge: null, einheit: null, satz: null, betrag: 120, key: "halteverbot" },
        { bezeichnung: "Personal Fahrt (Fahrzeit, Puffer)", menge: 4, einheit: "h", satz: 18, betrag: 72, key: "personal.fahrt" },
      ],
    },
  };

  it("liest Eingaben aus der Anfrage und dem Ergebnis", () => {
    const anfrage: RechnerAnfrage = { von_etage: "2", von_halteverbot: "on", umzugsdatum: "2026-12-01" };
    expect(rechnerwertFuer("eingabe", "beladen.etage", anfrage, ergebnis)).toBe(2);
    expect(rechnerwertFuer("eingabe", "halteverbot.beladen", anfrage, ergebnis)).toBe(true);
    expect(rechnerwertFuer("eingabe", "halteverbot.entladen", anfrage, ergebnis)).toBe(false);
    expect(rechnerwertFuer("eingabe", "termin", anfrage, ergebnis)).toBe("2026-12-01");
    expect(rechnerwertFuer("eingabe", "volumen", anfrage, ergebnis)).toBe(21.4);
    expect(rechnerwertFuer("eingabe", "team", anfrage, ergebnis)).toBe(3);
  });

  it("liest Zeile, Marge und Satz aus dem Ergebnis", () => {
    expect(rechnerwertFuer("zeile", "halteverbot", {}, ergebnis)).toBe(120);
    expect(rechnerwertFuer("zeile", "entsorgung", {}, ergebnis)).toBeNull();
    expect(rechnerwertFuer("marge", "marge", {}, ergebnis)).toBe(42);
    expect(rechnerwertFuer("satz", "fahrt", {}, ergebnis)).toBe(18);
    expect(rechnerwertFuer("satz", "fahrt", { satz_fahrt: "15" }, ergebnis)).toBe(15);
    expect(rechnerwertFuer("zeitposten", "klavier", {}, ergebnis)).toBeNull();
    expect(rechnerwertFuer("zeile", "halteverbot", {}, null)).toBeNull();
  });
});

describe("Plan 15, Bauteil 13: Umzugskartons getrennt vom Einpackservice", () => {
  const ref = { referenceDate: "2026-11-09" };
  it("Inhaber trägt 15 Kartons ein: Umzugskartons an den Rechner, kein Einpackservice", () => {
    const a = anfrageMitUebersteuerungen(rechnerAnfrageAus(lead({ packService: false, kartons: null })), [ue("eingabe", "umzugskartons", 15)], ref);
    expect(a.umzugskartons).toBe("15");
    expect(a).not.toHaveProperty("einpack_kartons");
  });
  it("Altschlüssel kartons gilt als Umzugskartons", () => {
    const a = anfrageMitUebersteuerungen(rechnerAnfrageAus(lead({ packService: false, kartons: null })), [ue("eingabe", "kartons", 15)], ref);
    expect(a.umzugskartons).toBe("15");
    expect(a).not.toHaveProperty("einpack_kartons");
    expect(pruefeUebersteuerung({ art: "eingabe", key: "kartons", wert: 12, grund: "g" })).toMatchObject({ key: "umzugskartons", wert: 12 });
  });
  it("Einpackservice 15: einpack_kartons (Hebel Einpacken), 0 schaltet ihn ab", () => {
    const a = anfrageMitUebersteuerungen(rechnerAnfrageAus(lead({ packService: false, kartons: null })), [ue("eingabe", "einpacken", 15)], ref);
    expect(a.einpack_kartons).toBe("15");
    const aus = anfrageMitUebersteuerungen(rechnerAnfrageAus(lead({ packService: true, kartons: 20 })), [ue("eingabe", "einpacken", 0)], ref);
    expect(aus).not.toHaveProperty("einpack_kartons");
  });
  it("Lead: Kartons ohne Einpackservice sind Umzugskartons, mit Einpackservice bleibt es wie bisher", () => {
    expect(rechnerAnfrageAus(lead({ packService: false, kartons: 30 }))).toMatchObject({ umzugskartons: "30" });
    const mitService = rechnerAnfrageAus(lead({ packService: true, kartons: 30 }));
    expect(mitService).toMatchObject({ einpack_kartons: "30" });
    expect(mitService).not.toHaveProperty("umzugskartons");
  });
  it("Chat „10-15 Kartons“: 15 Umzugskartons, unbestätigt, nie Einpackservice", () => {
    const l = lead({ packService: false, kartons: null, chatKartons: { anzahl: 15, quelle: "erkennung" } });
    const a = rechnerAnfrageAus(l);
    expect(a.umzugskartons).toBe("15");
    expect(a).not.toHaveProperty("einpack_kartons");
    expect(grundlageAus(l, null, []).find((z) => z.key === "umzugskartons")).toMatchObject({ wert: 15, herkunft: "CHAT" });
    expect(rechnerAnfrageAus({ ...l, packService: true })).not.toHaveProperty("umzugskartons");
  });
});
