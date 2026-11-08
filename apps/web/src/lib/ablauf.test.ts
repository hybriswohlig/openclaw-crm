import { describe, expect, it } from "vitest";
import {
  berechneAblauf,
  einsatzAus,
  halteverbotText,
  zugangText,
  type AblaufFakten,
  type AblaufSchritt,
} from "./ablauf";

/** Do 05.11.2026, 10:00 Berlin. */
const JETZT = new Date("2026-11-05T09:00:00.000Z");

/** Stand des Mockups: Schritte 1 bis 3 erledigt, KV v2 gesendet, nicht angenommen. */
function mockup(): AblaufFakten {
  return {
    erstelltAm: "2026-11-03T08:14:00.000Z",
    quelle: "Kleinanzeigen",
    ersteAntwortAm: "2026-11-03T08:21:00.000Z",
    fotos: 14,
    fotoanalyseAm: "2026-11-03T10:00:00.000Z",
    volumenCbm: 38,
    zugang: "2. OG ohne Aufzug",
    halteverbot: "Halteverbot beidseitig",
    besichtigungAm: null,
    leistung: "move",
    kalkulation: {
      version: 2,
      status: "gesperrt",
      selbstkostenCent: 154000,
      margeProzent: 38,
      geprueftVon: "Dario",
      anpassungen: 1,
      ersteAnpassung: { key: "volumen", grund: "Keller dazu" },
      neuerEntwurf: null,
    },
    kv: {
      version: 2,
      betragCent: 248000,
      istStunden: false,
      gesendetAm: "2026-11-04T09:00:00.000Z",
      gueltigBis: "2026-11-18",
      anzahlungCent: 50000,
      geoeffnet: 3,
      zuletztGeoeffnet: "2026-11-05T07:00:00.000Z",
    },
    unterschriftAktiv: true,
    nachfass: {
      modus: "sendet",
      text: "automatisch, sendet",
      regeln: [
        { tag: 2, gesendetAm: null, geplantAm: "2026-11-06T08:00:00.000Z", art: "auto" },
        { tag: 7, gesendetAm: null, geplantAm: "2026-11-11T08:00:00.000Z", art: "auto" },
        { tag: 10, gesendetAm: null, geplantAm: "2026-11-14T08:00:00.000Z", art: "entwurf" },
      ],
    },
    annahme: null,
    abAm: null,
    team: { personen: 0, namen: [] },
    einsatz: { fahrzeug: "Sprinter L", fahrtH: 1.2, arbeitH: 5.5, satzFahrtEur: 15, satzArbeitEur: 20, fahrzeugEur: 150 },
    termin: { datum: "2026-11-21", von: "07:30", bis: "13:00" },
    durchgefuehrtAm: null,
    rechnung: null,
    rest: { restCent: 248000, quelle: "angebot" },
    letzteZahlungAm: null,
    offeneMeldungen: 0,
    bewertung: { status: null, am: null },
    stageCategory: "quoted",
  };
}

/** Alles erledigt bis auf das, was der Test wieder öffnet. */
function fertig(): AblaufFakten {
  return {
    ...mockup(),
    annahme: { am: "2026-11-05T08:00:00.000Z", unterschriftAm: "2026-11-05T08:05:00.000Z" },
    abAm: "2026-11-06T09:00:00.000Z",
    team: { personen: 3, namen: ["Ali", "Ben", "Cem"] },
    durchgefuehrtAm: "2026-11-21T14:00:00.000Z",
    rechnung: { am: "2026-11-22T09:00:00.000Z", faelligAm: "2026-12-06" },
    rest: { restCent: 0, quelle: "annahme" },
    letzteZahlungAm: "2026-11-24",
    bewertung: { status: "sent_whatsapp", am: "2026-11-25T09:00:00.000Z" },
    stageCategory: "paid",
  };
}

/** Jeder Faktenstand, der in einem Test gerechnet wird (für die Prüfung auf leere Zeilen am Ende). */
const GERECHNET: { f: AblaufFakten; jetzt: Date }[] = [];

function ablauf(f: AblaufFakten, jetzt: Date = JETZT) {
  GERECHNET.push({ f: structuredClone(f), jetzt });
  return berechneAblauf(f, jetzt);
}

function schritt(f: AblaufFakten, key: AblaufSchritt["key"], jetzt: Date = JETZT): AblaufSchritt {
  const s = ablauf(f, jetzt).schritte.find((x) => x.key === key);
  if (!s) throw new Error(`Schritt ${key} fehlt`);
  return s;
}

describe("berechneAblauf: Mockup-Stand", () => {
  it("elf Schritte in fester Reihenfolge, 1 bis 3 erledigt, 4 jetzt, Rest offen, position 4", () => {
    const { schritte, position } = ablauf(mockup(), JETZT);
    expect(schritte.map((s) => [s.nr, s.key])).toEqual([
      [1, "anfrage"],
      [2, "fotos"],
      [3, "kalkulation"],
      [4, "kv"],
      [5, "annahme"],
      [6, "ab"],
      [7, "einsatz"],
      [8, "termin"],
      [9, "rechnung"],
      [10, "zahlung"],
      [11, "bewertung"],
    ]);
    expect(schritte.map((s) => s.zustand)).toEqual([
      "erledigt",
      "erledigt",
      "erledigt",
      "jetzt",
      "offen",
      "offen",
      "offen",
      "offen",
      "offen",
      "offen",
      "offen",
    ]);
    expect(position).toBe(4);
  });

  it("Titel und Wer wie im Mockup", () => {
    const { schritte } = ablauf(mockup(), JETZT);
    expect(schritte.map((s) => [s.titel, s.wer])).toEqual([
      ["Anfrage eingegangen", "auto"],
      ["Fotos und Infos", "auto"],
      ["Kalkulation", "intern"],
      ["Kostenvoranschlag", "du"],
      ["Annahme und Unterschrift", "kunde"],
      ["Auftragsbestätigung", "du"],
      ["Einsatz planen", "intern"],
      ["Umzug Sa 21.11.", null],
      ["Rechnung", "du"],
      ["Zahlung", "du"],
      ["Bewertung anfragen", "du"],
    ]);
  });

  it("Schritt 4 jetzt: Hinweis gold mit Öffnungen und nächstem Nachfass, Sequenz aus den Regeln", () => {
    const s = schritt(mockup(), "kv");
    expect(s.zeile).toBe("v2 · 2.480 € · gesendet Mi 04.11. · gültig bis 18.11.");
    expect(s.hinweis).toEqual({
      ton: "gold",
      text: "3× geöffnet, noch nicht angenommen. Nachfass Tag 2 geht morgen 09:00 automatisch raus.",
    });
    expect(s.sequenz).toEqual([
      { tag: 2, text: "Nachfrage", wann: "morgen", art: "auto" },
      { tag: 7, text: "Erinnerung", wann: "Mi 11.11.", art: "auto" },
      { tag: 10, text: "Abschluss", wann: "Sa 14.11.", art: "entwurf" },
    ]);
  });
});

describe("Schritt 1: Anfrage eingegangen", () => {
  it("immer erledigt: Zeitpunkt · Quelle · erste Antwort", () => {
    const s = schritt(mockup(), "anfrage");
    expect(s.zustand).toBe("erledigt");
    expect(s.zeile).toBe("Di 03.11. 09:14 · Kleinanzeigen · erste Antwort nach 7 Min");
  });

  it("ohne Quelle und erste Antwort entfallen die Teile samt Trenner", () => {
    const s = schritt({ ...mockup(), quelle: null, ersteAntwortAm: null }, "anfrage");
    expect(s.zeile).toBe("Di 03.11. 09:14");
  });

  it("erste Antwort in Stunden und Tagen", () => {
    expect(schritt({ ...mockup(), ersteAntwortAm: "2026-11-03T11:20:00.000Z" }, "anfrage").zeile).toBe(
      "Di 03.11. 09:14 · Kleinanzeigen · erste Antwort nach 3 Std"
    );
    expect(schritt({ ...mockup(), ersteAntwortAm: "2026-11-05T08:14:00.000Z" }, "anfrage").zeile).toBe(
      "Di 03.11. 09:14 · Kleinanzeigen · erste Antwort nach 2 Tagen"
    );
  });
});

describe("Schritt 2: Fotos und Infos", () => {
  it("erledigt mit Fotoanalyse: Fotos · Volumen · Zugang · Halteverbot", () => {
    const s = schritt(mockup(), "fotos");
    expect(s.zustand).toBe("erledigt");
    expect(s.zeile).toBe("14 Fotos · 38 m³ · 2. OG ohne Aufzug · Halteverbot beidseitig");
  });

  it("erledigt schon mit Volumen allein, ein Foto in der Einzahl", () => {
    const s = schritt({ ...mockup(), fotoanalyseAm: null, fotos: 1, zugang: null, halteverbot: null }, "fotos");
    expect(s.zustand).toBe("erledigt");
    expect(s.zeile).toBe("1 Foto · 38 m³");
  });

  it("offen: „Fotos und Angaben fehlen noch“", () => {
    const f = { ...mockup(), fotoanalyseAm: null, volumenCbm: null, fotos: 0, kalkulation: null, kv: null };
    const s = schritt(f, "fotos");
    expect(s.zustand).toBe("jetzt");
    expect(s.wer).toBe("auto");
    expect(s.zeile).toBe("Fotos und Angaben fehlen noch");
  });

  it("Entrümpelung mit künftiger Besichtigung: Titel, du, offen mit Termin", () => {
    const f: AblaufFakten = {
      ...mockup(),
      leistung: "clearance",
      fotoanalyseAm: null,
      volumenCbm: null,
      fotos: 0,
      besichtigungAm: "2026-11-10",
    };
    const s = schritt(f, "fotos");
    expect(s.titel).toBe("Besichtigung und Infos");
    expect(s.wer).toBe("du");
    expect(s.zustand).not.toBe("erledigt");
    expect(s.zeile).toBe("Besichtigung Di 10.11.");
  });

  it("Entrümpelung mit vergangener Besichtigung: erledigt, Besichtigung zuerst", () => {
    const f: AblaufFakten = {
      ...mockup(),
      leistung: "clearance",
      fotoanalyseAm: null,
      fotos: 0,
      volumenCbm: 20,
      zugang: null,
      halteverbot: null,
      besichtigungAm: "2026-11-04T14:00:00.000Z",
    };
    const s = schritt(f, "fotos");
    expect(s.zustand).toBe("erledigt");
    expect(s.zeile).toBe("Besichtigung Mi 04.11. · 20 m³");
  });

  it("vergangene Besichtigung zählt bei Umzug nicht als erledigt, Volumen 0 auch nicht", () => {
    const ohneBelege = { ...mockup(), fotoanalyseAm: null, volumenCbm: null, fotos: 0 };
    const s = schritt({ ...ohneBelege, besichtigungAm: "2026-11-04T14:00:00.000Z" }, "fotos");
    expect(s.zustand).toBe("jetzt");
    expect(s.zeile).toBe("Fotos und Angaben fehlen noch");
    expect(schritt({ ...ohneBelege, volumenCbm: 0 }, "fotos").zustand).toBe("jetzt");
  });

  it("Umzug mit Besichtigung behält den Titel „Fotos und Infos“", () => {
    expect(schritt({ ...mockup(), besichtigungAm: "2026-11-10" }, "fotos").titel).toBe("Fotos und Infos");
  });
});

describe("Schritt 3: Kalkulation", () => {
  it("erledigt bei gesperrter Version", () => {
    const s = schritt(mockup(), "kalkulation");
    expect(s.zustand).toBe("erledigt");
    expect(s.zeile).toBe("Selbstkosten 1.540 € · Marge 38 % · geprüft von Dario, 1 Anpassung");
  });

  it("ohne Prüfer und mit mehreren Anpassungen", () => {
    const f = mockup();
    f.kalkulation = { ...f.kalkulation!, geprueftVon: null, anpassungen: 3, margeProzent: 37.5 };
    expect(schritt(f, "kalkulation").zeile).toBe("Selbstkosten 1.540 € · Marge 37,5 % · geprüft, 3 Anpassungen");
    f.kalkulation = { ...f.kalkulation!, geprueftVon: "Dario", anpassungen: 0 };
    expect(schritt(f, "kalkulation").zeile).toBe("Selbstkosten 1.540 € · Marge 37,5 % · geprüft von Dario");
  });

  it("offen mit Entwurf", () => {
    const f = mockup();
    f.kalkulation = { ...f.kalkulation!, version: 3, status: "entwurf" };
    const s = schritt(f, "kalkulation");
    expect(s.zustand).toBe("jetzt");
    expect(s.zeile).toBe("Entwurf v3 · Selbstkosten 1.540 €");
  });

  it("gesperrte v2 gesendet, neuer Entwurf v3: erledigt mit Zusatz, Schritt 4 bleibt jetzt mit Hinweis", () => {
    const f = mockup();
    f.kalkulation = { ...f.kalkulation!, neuerEntwurf: 3 };
    const r = ablauf(f, JETZT);
    const k = r.schritte[2];
    expect(k.zustand).toBe("erledigt");
    expect(k.zeile).toBe(
      "Selbstkosten 1.540 € · Marge 38 % · geprüft von Dario, 1 Anpassung · Entwurf v3 in Arbeit"
    );
    const kv = r.schritte[3];
    expect(kv.zustand).toBe("jetzt");
    expect(kv.zeile).toBe("v2 · 2.480 € · gesendet Mi 04.11. · gültig bis 18.11.");
    expect(kv.hinweis?.text).toBe(
      "3× geöffnet, noch nicht angenommen. Nachfass Tag 2 geht morgen 09:00 automatisch raus."
    );
    expect(r.position).toBe(4);
  });

  it("offen ohne Kalkulation", () => {
    const s = schritt({ ...mockup(), kalkulation: null }, "kalkulation");
    expect(s.zustand).toBe("jetzt");
    expect(s.zeile).toBe("Noch keine Kalkulation");
  });
});

describe("Schritt 4: Kostenvoranschlag", () => {
  it("erledigt bei Annahme", () => {
    const s = schritt({ ...mockup(), annahme: { am: "2026-11-05T08:00:00.000Z", unterschriftAm: null } }, "kv");
    expect(s.zustand).toBe("erledigt");
    expect(s.zeile).toBe("v2 · 2.480 € · angenommen Do 05.11.");
    expect(s.hinweis).toBeUndefined();
    expect(s.sequenz).toBeUndefined();
  });

  it("noch nicht gesendet: kein Hinweis, keine Sequenz", () => {
    const f = mockup();
    f.kv = { ...f.kv!, gesendetAm: null };
    const s = schritt(f, "kv");
    expect(s.zustand).toBe("jetzt");
    expect(s.zeile).toBe("v2 · 2.480 € · noch nicht gesendet");
    expect(s.hinweis).toBeUndefined();
    expect(s.sequenz).toBeUndefined();
  });

  it("noch kein KV", () => {
    expect(schritt({ ...mockup(), kv: null }, "kv").zeile).toBe("Noch kein KV");
  });

  it("Stunden-KV ohne Version und Betrag", () => {
    const f = mockup();
    f.kv = { ...f.kv!, istStunden: true, betragCent: null, gueltigBis: null };
    expect(schritt(f, "kv").zeile).toBe("Stunden-KV · gesendet Mi 04.11.");
    f.kv = { ...f.kv!, gesendetAm: null };
    expect(schritt(f, "kv").zeile).toBe("Stunden-KV · noch nicht gesendet");
  });

  it("ohne Öffnung, Modus Entwurf: „Noch nicht geöffnet.“ und Entwurf zur Freigabe", () => {
    const f = mockup();
    f.kv = { ...f.kv!, geoeffnet: 0, zuletztGeoeffnet: null };
    f.nachfass = { ...f.nachfass, modus: "entwurf" };
    expect(schritt(f, "kv").hinweis).toEqual({
      ton: "gold",
      text: "Noch nicht geöffnet. Nachfass Tag 2 kommt morgen 09:00 als Entwurf zur Freigabe.",
    });
  });

  it("gesendete Regel in der Sequenz, Hinweis nennt die nächste geplante", () => {
    const f = mockup();
    f.nachfass = {
      ...f.nachfass,
      regeln: [
        { tag: 2, gesendetAm: "2026-11-04T08:00:00.000Z", geplantAm: null, art: "auto" },
        { tag: 7, gesendetAm: null, geplantAm: "2026-11-11T08:00:00.000Z", art: "auto" },
        { tag: 10, gesendetAm: null, geplantAm: "2026-11-14T08:00:00.000Z", art: "auto" },
      ],
    };
    const s = schritt(f, "kv");
    expect(s.hinweis?.text).toBe("3× geöffnet, noch nicht angenommen. Nachfass Tag 7 geht Mi 11.11. 09:00 automatisch raus.");
    expect(s.sequenz?.[0]).toEqual({ tag: 2, text: "Nachfrage", wann: "gesendet Mi 04.11.", art: "gesendet" });
  });

  it("Nachfass aus: nur der erste Satz, keine Sequenz ohne Plan", () => {
    const f = mockup();
    f.nachfass = {
      modus: "aus",
      text: "aus",
      regeln: [
        { tag: 2, gesendetAm: null, geplantAm: null, art: "entwurf" },
        { tag: 7, gesendetAm: null, geplantAm: null, art: "entwurf" },
        { tag: 10, gesendetAm: null, geplantAm: null, art: "entwurf" },
      ],
    };
    const s = schritt(f, "kv");
    expect(s.hinweis).toEqual({ ton: "gold", text: "3× geöffnet, noch nicht angenommen." });
    expect(s.sequenz).toBeUndefined();
  });

  it("nicht jetzt (früherer Schritt offen): kein Hinweis", () => {
    const s = schritt({ ...mockup(), kalkulation: null }, "kv");
    expect(s.zustand).toBe("offen");
    expect(s.hinweis).toBeUndefined();
    expect(s.sequenz).toBeUndefined();
  });
});

describe("Schritt 5: Annahme und Unterschrift", () => {
  it("offen: im Status-Link · Anzahlung · Unterschrift", () => {
    const s = schritt(mockup(), "annahme");
    expect(s.zustand).toBe("offen");
    expect(s.wer).toBe("kunde");
    expect(s.zeile).toBe("im Status-Link · Anzahlung 500 € · Unterschrift");
  });

  it("angenommen ohne Unterschrift bei aktiver Unterschrift bleibt offen", () => {
    const s = schritt({ ...mockup(), annahme: { am: "2026-11-05T08:00:00.000Z", unterschriftAm: null } }, "annahme");
    expect(s.zustand).toBe("jetzt");
    expect(s.titel).toBe("Annahme und Unterschrift");
  });

  it("erledigt: angenommen · unterschrieben", () => {
    const s = schritt(fertig(), "annahme");
    expect(s.zustand).toBe("erledigt");
    expect(s.zeile).toBe("angenommen Do 05.11. · unterschrieben Do 05.11.");
  });

  it("ohne Unterschrift: Titel „Annahme“, erledigt mit Annahme allein, offen ohne Unterschrift-Teil", () => {
    const ohne = { ...mockup(), unterschriftAktiv: false };
    const offen = schritt({ ...ohne, kv: { ...ohne.kv!, anzahlungCent: null } }, "annahme");
    expect(offen.titel).toBe("Annahme");
    expect(offen.zeile).toBe("im Status-Link");
    const s = schritt({ ...ohne, annahme: { am: "2026-11-05T08:00:00.000Z", unterschriftAm: null } }, "annahme");
    expect(s.titel).toBe("Annahme");
    expect(s.zustand).toBe("erledigt");
    expect(s.zeile).toBe("angenommen Do 05.11.");
  });
});

describe("Schritt 6: Auftragsbestätigung", () => {
  it("offen und erledigt", () => {
    expect(schritt(mockup(), "ab").zeile).toBe("aus der angenommenen Fassung · ein Klick");
    const s = schritt(fertig(), "ab");
    expect(s.zustand).toBe("erledigt");
    expect(s.zeile).toBe("erstellt Fr 06.11.");
  });
});

describe("Schritt 7: Einsatz planen", () => {
  it("erledigt mit Team: Personen · Fahrt · Arbeit · Fahrzeug", () => {
    const s = schritt(fertig(), "einsatz");
    expect(s.zustand).toBe("erledigt");
    expect(s.zeile).toBe("3 Personen · Fahrt 1,2 h × 15 € · Arbeit 5,5 h × 20 € · Sprinter L 150 €");
  });

  it("offen: dieselbe Zeile aus dem Einsatz ohne Personen", () => {
    const s = schritt(mockup(), "einsatz");
    expect(s.zustand).toBe("offen");
    expect(s.zeile).toBe("Fahrt 1,2 h × 15 € · Arbeit 5,5 h × 20 € · Sprinter L 150 €");
  });

  it("offen ohne Einsatz: „Team und Fahrzeug fehlen“", () => {
    expect(schritt({ ...mockup(), einsatz: null }, "einsatz").zeile).toBe("Team und Fahrzeug fehlen");
  });

  it("eine Person, Teile ohne Satz", () => {
    const f = fertig();
    f.team = { personen: 1, namen: ["Ali"] };
    f.einsatz = { fahrzeug: null, fahrtH: 1, arbeitH: null, satzFahrtEur: null, satzArbeitEur: 20, fahrzeugEur: 150 };
    expect(schritt(f, "einsatz").zeile).toBe("1 Person · Fahrt 1 h · Fahrzeug 150 €");
  });
});

describe("Schritt 8: Termin", () => {
  it("drei Titel je Leistung", () => {
    expect(schritt({ ...mockup(), leistung: "move" }, "termin").titel).toBe("Umzug Sa 21.11.");
    expect(schritt({ ...mockup(), leistung: "clearance_move" }, "termin").titel).toBe("Umzug Sa 21.11.");
    expect(schritt({ ...mockup(), leistung: "clearance" }, "termin").titel).toBe("Termin Sa 21.11.");
    expect(schritt({ ...mockup(), leistung: "kitchen_installation" }, "termin").titel).toBe("Montage Sa 21.11.");
  });

  it("ohne Datum ohne Datumsteil, Zeile „noch kein Termin“", () => {
    const s = schritt({ ...mockup(), termin: null }, "termin");
    expect(s.titel).toBe("Umzug");
    expect(s.wer).toBeNull();
    expect(s.zeile).toBe("noch kein Termin");
  });

  it("offen mit Zeitfenster", () => {
    expect(schritt(mockup(), "termin").zeile).toBe("07:30 Beladen · ca. 13:00 fertig");
    expect(schritt({ ...mockup(), leistung: "clearance_move" }, "termin").zeile).toBe("07:30 Beladen · ca. 13:00 fertig");
  });

  it("Zeitfenster bei Entrümpelung und Montage: Beginn statt Beladen", () => {
    for (const leistung of ["clearance", "kitchen_installation"] as const) {
      expect(schritt({ ...mockup(), leistung }, "termin").zeile).toBe("07:30 Beginn · ca. 13:00 fertig");
    }
  });

  it("offen ohne Zeitfenster: in 16 Tagen", () => {
    expect(schritt({ ...mockup(), termin: { datum: "2026-11-21", von: null, bis: null } }, "termin").zeile).toBe(
      "in 16 Tagen"
    );
  });

  it("erledigt mit durchgefuehrtAm", () => {
    const s = schritt({ ...fertig(), stageCategory: "planned" }, "termin");
    expect(s.zustand).toBe("erledigt");
    expect(s.zeile).toBe("durchgeführt Sa 21.11.");
  });

  it("erledigt über die Stufe done_unpaid oder paid", () => {
    for (const stageCategory of ["done_unpaid", "paid"]) {
      const s = schritt({ ...mockup(), stageCategory }, "termin");
      expect(s.zustand).toBe("erledigt");
      expect(s.zeile).toBe("durchgeführt");
    }
  });
});

describe("Schritt 9: Rechnung", () => {
  it("offen und erledigt", () => {
    expect(schritt(mockup(), "rechnung").zeile).toBe("Restbetrag 2.480 €");
    const s = schritt(fertig(), "rechnung");
    expect(s.zustand).toBe("erledigt");
    expect(s.zeile).toBe("erstellt So 22.11. · fällig 06.12.");
  });

  it("Stunden-KV ohne Restbetrag: „noch keine Rechnung“", () => {
    expect(schritt({ ...mockup(), rest: { restCent: null, quelle: "stunden" } }, "rechnung").zeile).toBe(
      "noch keine Rechnung"
    );
  });

  it("Rechnung ohne Fälligkeit: nur erstellt", () => {
    const f = fertig();
    f.rechnung = { am: "2026-11-22T09:00:00.000Z", faelligAm: null };
    expect(schritt(f, "rechnung").zeile).toBe("erstellt So 22.11.");
  });
});

describe("Schritt 10: Zahlung", () => {
  it("offen mit Zahlungsarten", () => {
    const s = schritt(mockup(), "zahlung");
    expect(s.zustand).toBe("offen");
    expect(s.zeile).toBe("Kunde meldet „bezahlt“ im Link, du bestätigst");
    expect(s.chips).toEqual(["Überweisung", "PayPal", "Bar", "Karte"]);
    expect(s.hinweis).toBeUndefined();
  });

  it("offene Meldung: Hinweis gold, aber nicht mehr, wenn die Zahlung erledigt ist", () => {
    expect(schritt({ ...mockup(), offeneMeldungen: 1 }, "zahlung").hinweis).toEqual({
      ton: "gold",
      text: "Kunde meldet „bezahlt“. Ein Klick bestätigt.",
    });
    expect(schritt({ ...fertig(), offeneMeldungen: 1 }, "zahlung").hinweis).toBeUndefined();
    expect(schritt({ ...fertig(), offeneMeldungen: 2 }, "zahlung").hinweis).toBeUndefined();
  });

  it("mehrere offene Meldungen: Hinweis nennt die Zahl statt des Ein-Klick-Satzes", () => {
    expect(schritt({ ...mockup(), offeneMeldungen: 2 }, "zahlung").hinweis).toEqual({
      ton: "gold",
      text: "Kunde meldet „bezahlt“ (2 Meldungen).",
    });
    expect(schritt({ ...mockup(), offeneMeldungen: 3 }, "zahlung").hinweis?.text).toBe("Kunde meldet „bezahlt“ (3 Meldungen).");
    expect(schritt({ ...mockup(), offeneMeldungen: 0 }, "zahlung").hinweis).toBeUndefined();
  });

  it("erledigt bei Rest 0", () => {
    const s = schritt(fertig(), "zahlung");
    expect(s.zustand).toBe("erledigt");
    expect(s.zeile).toBe("bezahlt Di 24.11.");
    expect(s.chips).toEqual(["Überweisung", "PayPal", "Bar", "Karte"]);
  });

  it("Rest unbekannt (Stunden-KV) vor Bezahlt ist nicht erledigt", () => {
    const f = { ...fertig(), rest: { restCent: null, quelle: "stunden" }, stageCategory: "done_unpaid" };
    expect(schritt(f, "zahlung").zustand).toBe("jetzt");
  });

  it("Stunden-KV bei Stufe Bezahlt: Zahlung erledigt, Bewertung jetzt", () => {
    const f: AblaufFakten = {
      ...fertig(),
      rest: { restCent: null, quelle: "stunden" },
      bewertung: { status: null, am: null },
      stageCategory: "paid",
    };
    const r = ablauf(f, JETZT);
    expect(r.schritte[9].zustand).toBe("erledigt");
    expect(r.schritte[9].zeile).toBe("bezahlt Di 24.11.");
    expect(r.schritte[10].zustand).toBe("jetzt");
    expect(r.position).toBe(11);
    expect(schritt({ ...f, letzteZahlungAm: null }, "zahlung").zeile).toBe("bezahlt");
  });
});

describe("Schritt 11: Bewertung anfragen", () => {
  it("erledigt bei gesendet, geklickt oder abgegeben", () => {
    for (const status of ["sent_whatsapp", "sent_sms", "clicked", "review_left"]) {
      const s = schritt({ ...fertig(), bewertung: { status, am: "2026-11-25T09:00:00.000Z" } }, "bewertung");
      expect(s.zustand).toBe("erledigt");
      expect(s.zeile).toBe("angefragt Mi 25.11.");
    }
  });

  it("offen bei anderem Status", () => {
    const s = schritt({ ...fertig(), bewertung: { status: "scheduled", am: null } }, "bewertung");
    expect(s.zustand).toBe("jetzt");
    expect(s.zeile).toBe("von Hand · Google-Link mit Vorlage");
  });

  it("nach Beschwerde oder Abmeldung entfällt der Schritt mit der Sperre als Zeile; failed bleibt jetzt", () => {
    const s = (status: string) => schritt({ ...fertig(), bewertung: { status, am: null } }, "bewertung");
    expect(s("complaint_routed")).toMatchObject({ zustand: "entfaellt", zeile: "gesperrt · Beschwerde" });
    expect(s("suppressed")).toMatchObject({ zustand: "entfaellt", zeile: "gesperrt · abgemeldet" });
    expect(s("failed")).toMatchObject({ zustand: "jetzt", zeile: "von Hand · Google-Link mit Vorlage" });
  });

  it("gesperrt und sonst alles erledigt: kein jetzt, kein anderer Schritt rückt nach, position 10", () => {
    for (const status of ["complaint_routed", "suppressed"]) {
      const r = ablauf({ ...fertig(), bewertung: { status, am: null } }, JETZT);
      expect(r.schritte.map((x) => x.zustand)).toEqual([...Array(10).fill("erledigt"), "entfaellt"]);
      expect(r.position).toBe(10);
    }
  });

  it("gesperrt mit offener Zahlung: Schritt 10 bleibt jetzt, Schritt 11 entfällt, position 10", () => {
    const f: AblaufFakten = {
      ...fertig(),
      rest: { restCent: 198000, quelle: "annahme" },
      letzteZahlungAm: null,
      stageCategory: "done_unpaid",
      bewertung: { status: "suppressed", am: null },
    };
    const r = ablauf(f, JETZT);
    expect(r.schritte.map((x) => x.zustand)).toEqual([...Array(9).fill("erledigt"), "jetzt", "entfaellt"]);
    expect(r.position).toBe(10);
    expect(r.schritte[10].zeile).toBe("gesperrt · abgemeldet");
  });

  it("gesperrt im Angebot: Schritt 4 bleibt jetzt, dazwischen offen, Schritt 11 entfällt", () => {
    const r = ablauf({ ...mockup(), bewertung: { status: "complaint_routed", am: null } }, JETZT);
    expect(r.schritte.map((x) => x.zustand)).toEqual(["erledigt", "erledigt", "erledigt", "jetzt", ...Array(6).fill("offen"), "entfaellt"]);
    expect(r.position).toBe(4);
  });

  it("alles erledigt: kein jetzt, position 11", () => {
    const r = ablauf(fertig(), JETZT);
    expect(r.schritte.every((s) => s.zustand === "erledigt")).toBe(true);
    expect(r.position).toBe(11);
  });
});

describe("verlorener Deal", () => {
  it("kein jetzt, nicht erledigte entfallen, position = Zahl der erledigten", () => {
    for (const stageCategory of ["lost", "kein_lead"]) {
      const r = ablauf({ ...mockup(), stageCategory }, JETZT);
      expect(r.schritte.some((s) => s.zustand === "jetzt")).toBe(false);
      expect(r.schritte.map((s) => s.zustand)).toEqual([
        "erledigt",
        "erledigt",
        "erledigt",
        ...Array(8).fill("entfaellt"),
      ]);
      expect(r.position).toBe(3);
      expect(r.schritte[3].hinweis).toBeUndefined();
    }
  });
});

describe("Hilfen für die Fakten", () => {
  it("zugangText", () => {
    expect(zugangText(2, "keiner")).toBe("2. OG ohne Aufzug");
    expect(zugangText(3, "klein")).toBe("3. OG mit kleinem Aufzug");
    expect(zugangText(4, "gross")).toBe("4. OG mit großem Aufzug");
    expect(zugangText(0, "keiner")).toBe("EG");
    expect(zugangText(0.5, null)).toBe("Hochparterre");
    expect(zugangText(-1, null)).toBe("UG");
    expect(zugangText(null, "keiner")).toBe("ohne Aufzug");
    expect(zugangText(null, null)).toBeNull();
  });

  it("halteverbotText", () => {
    expect(halteverbotText(true, true)).toBe("Halteverbot beidseitig");
    expect(halteverbotText(true, false)).toBe("Halteverbot Beladen");
    expect(halteverbotText(false, true)).toBe("Halteverbot Entladen");
    expect(halteverbotText(false, false)).toBeNull();
  });

  it("einsatzAus: Empfehlung, Fahrtzeit, Arbeitszeit je Person, Sätze; Fahrzeugzeilen werden summiert", () => {
    expect(
      einsatzAus({
        fahrzeugoptionen: [
          { id: "a", name: "LKW 7,5 t", fahrten: 1, km: 20, fahrtMin: 60, teamgroesse: 3 },
          { id: "b", name: "Sprinter L", fahrten: 2, km: 20, fahrtMin: 70, teamgroesse: 3 },
        ],
        empfehlungOptionId: "b",
        zeiten: { fahrtMin: 72 },
        team: { groesse: 3 },
        kosten: {
          selbstkosten: 1540,
          personenH: 16.5,
          posten: [
            { key: "personal.fahrt", bezeichnung: "Fahrt", menge: 3.6, einheit: "h", satz: 15, betrag: 54 },
            { key: "personal.arbeit", bezeichnung: "Arbeit", menge: 16.5, einheit: "h", satz: 20, betrag: 330 },
            { key: "fahrzeug", bezeichnung: "Fahrzeug", menge: 1, einheit: null, satz: null, betrag: 999 },
            { key: "fahrzeug.sprinter_l@sixt_feuerbach.miete", bezeichnung: "Miete", menge: 1, einheit: null, satz: null, betrag: 120 },
            { key: "fahrzeug.sprinter_l@sixt_feuerbach.kraftstoff", bezeichnung: "Kraftstoff", menge: 1, einheit: null, satz: null, betrag: 30 },
          ],
        },
      })
    ).toEqual({ fahrzeug: "Sprinter L", fahrtH: 1.2, arbeitH: 5.5, satzFahrtEur: 15, satzArbeitEur: 20, fahrzeugEur: 150 });
  });

  it("einsatzAus: ohne Ergebnis oder ohne verwertbare Angaben null", () => {
    expect(einsatzAus(null)).toBeNull();
    expect(einsatzAus({})).toBeNull();
  });
});

describe("keine leeren Zeilen", () => {
  it("in keinem gerechneten Faktenstand hat ein Schritt eine leere Zeile", () => {
    expect(GERECHNET.length).toBeGreaterThan(50);
    for (const { f, jetzt } of GERECHNET) {
      for (const s of berechneAblauf(f, jetzt).schritte) {
        expect(s.zeile.trim(), `${s.key} (${s.zustand})`).not.toBe("");
      }
    }
  });
});
