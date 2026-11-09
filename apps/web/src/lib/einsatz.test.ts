import { describe, expect, it } from "vitest";
import {
  adresseSchluessel,
  anfahrtText,
  anteilAusRechnerFeld,
  auslastungAus,
  buchungsAnteil,
  buchungsLeisteText,
  buchungsWarnungen,
  cacheGueltig,
  centAusHourlyRate,
  doppelteAmTag,
  einsatzKosten,
  fahrzeugEurAus,
  festeEinsaetzeAus,
  gleicherAnteil,
  hourlyRateAusCent,
  kapazitaetAus,
  kartenGrenzen,
  lageAmEinsatz,
  lohnVergleich,
  minutenAusKm,
  ortSchluessel,
  ortText,
  pinGruppen,
  planMinutenJePerson,
  pruefeAbwesenheit,
  pruefeBuchung,
  pruefeStammdaten,
  pruefeTeam,
  rechnerBuchungFeld,
  restKm,
  teamAenderung,
  teamVorschlag,
  ziehenErgebnis,
  type Abwesenheit,
  type BuchungEingabe,
  type EinsatzKostenZeile,
  type EinsatzPerson,
  type FesterEinsatz,
  type KapazitaetTag,
  type KartenPerson,
  type PersonKurz,
  type TeamWunsch,
  type TransporterBuchung,
} from "./einsatz";

function person(over: Partial<EinsatzPerson> & Pick<EinsatzPerson, "id" | "name">): EinsatzPerson {
  return {
    kuerzel: over.name.slice(0, 2),
    aktiv: true,
    plz: null,
    wohnort: null,
    kannSprinter: false,
    eigenerPkw: false,
    satzFahrtCent: 1500,
    satzArbeitCent: 2000,
    ...over,
  };
}

function abwesenheit(over: Partial<Abwesenheit> & Pick<Abwesenheit, "employeeId" | "von" | "bis">): Abwesenheit {
  return { id: "ab", art: "urlaub", notiz: null, ...over };
}

function wunsch(employeeId: string, role: TeamWunsch["role"] = "helper", minuten: number | null = 0): TeamWunsch {
  return { employeeId, role, plannedDriveMinutes: minuten, plannedWorkMinutes: minuten };
}

function kostenZeile(key: EinsatzKostenZeile["key"], betragCent: number, nurAnzeige = false): EinsatzKostenZeile {
  return { key, text: key, formel: "", betragCent, nurAnzeige };
}

function buchung(over: Partial<TransporterBuchung> = {}): TransporterBuchung {
  return {
    id: "b1",
    firmaId: "firma",
    von: "2026-11-01",
    bis: "2026-11-10",
    stationId: "sixt",
    stationName: "Sixt Feuerbach",
    stationAnbieter: "Sixt",
    klasseId: "sprinter",
    klasseName: "Sprinter L",
    mieteCent: 45000,
    inklusivKm: 800,
    mehrkmSatzCent: 25,
    geplanteAuftraege: 4,
    status: "bestaetigt",
    notiz: null,
    ...over,
  };
}

function buchungsEingabe(over: Partial<BuchungEingabe> = {}): BuchungEingabe {
  return {
    firmaId: "firma",
    von: "2026-11-01",
    bis: "2026-12-01",
    stationId: "s",
    stationName: "Sixt",
    stationAnbieter: null,
    klasseId: "k",
    klasseName: "Sprinter",
    mieteCent: 10000,
    inklusivKm: 800,
    mehrkmSatzCent: 30,
    geplanteAuftraege: 2,
    notiz: null,
    ...over,
  };
}

describe("kapazitaetAus", () => {
  const anna = person({ id: "a", name: "Anna" });
  const ben = person({ id: "b", name: "Ben" });
  const cem = person({ id: "c", name: "Cem" });
  const dora = person({ id: "d", name: "Dora", aktiv: false });
  const tage = ["2026-11-30", "2026-12-01", "2026-12-02"];

  it("zählt 0 rot, 1 gold, 2 grün und schreibt „3 frei“", () => {
    const leer = (namen: EinsatzPerson[]) => kapazitaetAus({ tage: ["2026-12-01"], personen: namen, abwesenheiten: [], einsaetze: [] })[0]!;
    expect(leer([]).ton).toBe("rot");
    expect(leer([anna]).ton).toBe("gold");
    expect(leer([anna, ben]).ton).toBe("gruen");
    const drei = leer([anna, ben, cem]);
    expect(drei.freiZahl).toBe(3);
    expect(drei.text).toBe("3 frei");
    expect(drei.ton).toBe("gruen");
  });

  it("abwesend und belegt zugleich, inaktiv zählt nie, mehrtägig und über den Monatswechsel", () => {
    const kap = kapazitaetAus({
      tage,
      personen: [cem, anna, ben, dora],
      abwesenheiten: [
        abwesenheit({ employeeId: "a", von: "2026-11-30", bis: "2026-12-02" }),
        abwesenheit({ id: "ab-d", employeeId: "d", von: "2026-11-30", bis: "2026-12-02", art: "krank" }),
      ],
      einsaetze: [{ dealId: "d1", titel: "Müller", tag: "2026-11-30", bisTag: "2026-12-02", employeeIds: ["a", "b", "d"] }],
    });
    expect(kap.map((k) => k.tag)).toEqual(tage);
    for (const tag of kap) {
      expect(tag.abwesend.map((a) => a.person.id)).toEqual(["a"]);
      expect(tag.abwesend[0]!.art).toBe("urlaub");
      expect(tag.belegt.map((b) => b.person.id)).toEqual(["a", "b"]);
      expect(tag.belegt.every((b) => b.deals.some((d) => d.dealId === "d1"))).toBe(true);
      expect(tag.frei.map((f) => f.id)).toEqual(["c"]);
      expect(tag.freiZahl).toBe(1);
      expect(tag.ton).toBe("gold");
      const ids = [...tag.frei, ...tag.belegt.map((b) => b.person), ...tag.abwesend.map((a) => a.person)].map((p) => p.id);
      expect(ids).not.toContain("d");
    }
  });
});

describe("festeEinsaetzeAus", () => {
  it("nur Umzug in jade oder gold, einmal je Deal und Zeitraum, mit Team-Ids", () => {
    const team = new Map<string, readonly string[]>([["d1", ["a", "b"]], ["d3", ["c"]]]);
    expect(
      festeEinsaetzeAus(
        [
          { dealId: "d1", art: "umzug", ton: "jade", tag: "2026-12-01", bisTag: "2026-12-01", titel: "Erster" },
          { dealId: "d1", art: "umzug", ton: "gold", tag: "2026-12-01", bisTag: "2026-12-01", titel: "Zweiter" },
          { dealId: "d1", art: "umzug", ton: "violett", tag: "2026-12-02", bisTag: "2026-12-02", titel: "Wunsch" },
          { dealId: "d2", art: "besichtigung", ton: "jade", tag: "2026-12-01", bisTag: "2026-12-01", titel: "Besichtigung" },
          { dealId: "d3", art: "umzug", ton: "gold", tag: "2026-12-03", bisTag: "2026-12-04", titel: "Klein" },
          { dealId: "d4", art: "umzug", ton: "jade", tag: "2026-12-05", bisTag: "2026-12-05", titel: "Ohne Team" },
        ],
        team,
      ),
    ).toEqual([
      { dealId: "d1", titel: "Erster", tag: "2026-12-01", bisTag: "2026-12-01", employeeIds: ["a", "b"] },
      { dealId: "d3", titel: "Klein", tag: "2026-12-03", bisTag: "2026-12-04", employeeIds: ["c"] },
      { dealId: "d4", titel: "Ohne Team", tag: "2026-12-05", bisTag: "2026-12-05", employeeIds: [] },
    ]);
  });
});

describe("teamVorschlag", () => {
  const fahrer = person({ id: "f", name: "Fahrer", kannSprinter: true });
  const bisher = person({ id: "b", name: "Bisher" });
  const neu = person({ id: "n", name: "Neu" });
  const lasten: FesterEinsatz[] = [
    { dealId: "x1", titel: "1", tag: "2026-11-01", bisTag: "2026-11-01", employeeIds: ["f"] },
    { dealId: "x2", titel: "2", tag: "2026-11-02", bisTag: "2026-11-02", employeeIds: ["f"] },
    { dealId: "x3", titel: "3", tag: "2026-11-03", bisTag: "2026-11-03", employeeIds: ["f"] },
    { dealId: "x4", titel: "4", tag: "2026-11-04", bisTag: "2026-11-04", employeeIds: ["b"] },
  ];
  const basis = {
    dealId: "deal",
    tage: ["2026-12-01"],
    groesse: 3,
    brauchtFahrer: false,
    fahrtMinJePerson: 15 as number | null,
    arbeitMinJePerson: 90 as number | null,
    bisher: [] as string[],
    personen: [neu, bisher, fahrer],
    abwesenheiten: [] as Abwesenheit[],
    einsaetze: lasten,
  };

  it("Fahrer zuerst, bisher vor den anderen, Fairness nach weniger festen Einsätzen", () => {
    const mitFahrer = teamVorschlag({ ...basis, brauchtFahrer: true, bisher: ["b"] });
    expect(mitFahrer.team.map((t) => [t.employeeId, t.role])).toEqual([
      ["f", "lead"],
      ["b", "helper"],
      ["n", "helper"],
    ]);
    expect(mitFahrer.team[0]).toMatchObject({ plannedDriveMinutes: 15, plannedWorkMinutes: 90 });
    expect(mitFahrer.hinweise).toEqual([]);

    expect(teamVorschlag({ ...basis, bisher: ["b"] }).team.map((t) => t.employeeId)).toEqual(["b", "n", "f"]);
    expect(teamVorschlag(basis).team.map((t) => t.employeeId)).toEqual(["n", "b", "f"]);
  });

  it("Hinweis, wenn niemand Freies Sprinter fahren darf", () => {
    const ohne = teamVorschlag({
      ...basis,
      groesse: 1,
      brauchtFahrer: true,
      personen: [neu, bisher, person({ ...fahrer, kannSprinter: false })],
    });
    expect(ohne.hinweise).toContain("Niemand Freies darf Sprinter fahren.");
    expect(ohne.team[0]!.employeeId).toBe("n");
  });

  it("ohne Tage keine Verfügbarkeitsprüfung, fehlende Personen als Satz", () => {
    const leer = teamVorschlag({ ...basis, tage: [], groesse: 1, personen: [neu], einsaetze: [] });
    expect(leer.hinweise).toEqual(["Kein Termin: Verfügbarkeit nicht geprüft."]);
    expect(leer.team).toHaveLength(1);

    const weg = [
      abwesenheit({ employeeId: "b", von: "2026-12-01", bis: "2026-12-01", art: "krank" }),
      abwesenheit({ id: "ab-f", employeeId: "f", von: "2026-12-01", bis: "2026-12-01" }),
    ];
    const einer = teamVorschlag({ ...basis, groesse: 2, einsaetze: [], abwesenheiten: weg });
    expect(einer.team.map((t) => t.employeeId)).toEqual(["n"]);
    expect(einer.fehlen).toBe(1);
    expect(einer.hinweise).toEqual(["1 Person fehlt."]);

    const keine = teamVorschlag({ ...basis, groesse: 2, personen: [bisher, fahrer], einsaetze: [], abwesenheiten: weg });
    expect(keine.team).toEqual([]);
    expect(keine.fehlen).toBe(2);
    expect(keine.hinweise).toEqual(["2 Personen fehlen."]);
  });
});

describe("pruefeTeam", () => {
  const anna = person({ id: "a", name: "Anna" });
  const ben = person({ id: "b", name: "Ben", aktiv: false });

  it("jeden Code, inaktiv nur wenn schon zugeteilt, Minuten an den Grenzen", () => {
    expect(pruefeTeam([wunsch("a"), wunsch("a")], [anna], [])).toBe("DOPPELTE_PERSON");
    expect(pruefeTeam([wunsch("a", "lead"), wunsch("b", "lead")], [anna, person({ id: "b", name: "Ben" })], [])).toBe("MEHR_ALS_EIN_LEAD");
    expect(pruefeTeam([wunsch("fehlt")], [anna], [])).toBe("UNBEKANNT");
    expect(pruefeTeam([wunsch("b")], [anna, ben], [])).toBe("INAKTIV");
    expect(pruefeTeam([wunsch("b")], [anna, ben], ["b"])).toBeNull();
    expect(pruefeTeam([wunsch("a", "helper", -1)], [anna], [])).toBe("MINUTEN_UNGUELTIG");
    expect(pruefeTeam([{ ...wunsch("a"), plannedWorkMinutes: 1441 }], [anna], [])).toBe("MINUTEN_UNGUELTIG");
    expect(pruefeTeam([{ ...wunsch("a"), plannedDriveMinutes: 1.5 }], [anna], [])).toBe("MINUTEN_UNGUELTIG");
    expect(pruefeTeam([{ ...wunsch("a"), plannedDriveMinutes: 0, plannedWorkMinutes: 1440 }], [anna], [])).toBeNull();
    expect(pruefeTeam([{ ...wunsch("a"), plannedDriveMinutes: null, plannedWorkMinutes: null }], [anna], [])).toBeNull();
  });
});

describe("doppelteAmTag", () => {
  const einsaetze: FesterEinsatz[] = [
    { dealId: "other", titel: "Schmidt", tag: "2026-12-01", bisTag: "2026-12-02", employeeIds: ["a"] },
    { dealId: "this", titel: "Eigen", tag: "2026-12-01", bisTag: "2026-12-01", employeeIds: ["a", "b"] },
  ];
  const input = { dealId: "this", tage: ["2026-12-01", "2026-12-03"], employeeIds: ["a", "b"], einsaetze };

  it("fremder fester Umzug, nicht der eigene Deal, bestätigte Personen ausgenommen", () => {
    expect(doppelteAmTag(input)).toEqual([
      { employeeId: "a", tag: "2026-12-01", andere: [{ dealId: "other", titel: "Schmidt" }] },
    ]);
    expect(doppelteAmTag({ ...input, bestaetigt: ["a"] })).toEqual([]);
    expect(doppelteAmTag({ ...input, einsaetze: einsaetze.filter((e) => e.dealId === "this") })).toEqual([]);
  });
});

describe("teamAenderung", () => {
  it("legt an, ändert und entfernt", () => {
    const alt = [
      { id: "z1", employeeId: "a", role: "helper", plannedDriveMinutes: 10, plannedWorkMinutes: 20 },
      { id: "z2", employeeId: "c", role: "lead", plannedDriveMinutes: null, plannedWorkMinutes: null },
      { id: "z3", employeeId: "d", role: "helper", plannedDriveMinutes: 5, plannedWorkMinutes: 5 },
    ];
    const neu: TeamWunsch[] = [
      { employeeId: "a", role: "lead", plannedDriveMinutes: 10, plannedWorkMinutes: 20 },
      { employeeId: "b", role: "helper", plannedDriveMinutes: 5, plannedWorkMinutes: 6 },
      { employeeId: "d", role: "helper", plannedDriveMinutes: 5, plannedWorkMinutes: 5 },
    ];
    expect(teamAenderung(alt, neu)).toEqual({
      anlegen: [neu[1]],
      aendern: [{ id: "z1", wunsch: neu[0] }],
      entfernen: [alt[1]],
    });
  });
});

describe("fahrzeugEurAus", () => {
  it("summiert fahrzeug.* und lässt andere Schlüssel weg", () => {
    expect(
      fahrzeugEurAus([
        { key: "fahrzeug.sprinter_l@sixt_feuerbach.miete", betrag: 80 },
        { key: "fahrzeug.sprinter_l@sixt_feuerbach.mehrkm", betrag: 15 },
        { key: "fahrzeug.sprinter_l@sixt_feuerbach.kraftstoff", betrag: 5 },
        { key: "personal.arbeit", betrag: 999 },
        { key: "fahrzeug", betrag: 50 },
      ]),
    ).toBe(100);
    expect(fahrzeugEurAus(undefined)).toBeNull();
    expect(fahrzeugEurAus([])).toBeNull();
    expect(fahrzeugEurAus([{ key: "personal.fahrt", betrag: 10 }])).toBeNull();
  });
});

describe("einsatzKosten", () => {
  const mara = person({ id: "m", name: "Mara Kottke", kuerzel: "MK", eigenerPkw: true });
  const ohneKm = person({ id: "o", name: "Ona Held", kuerzel: "OH", eigenerPkw: true });
  const bus = person({ id: "x", name: "Xaver", kuerzel: "XA" });

  it("rundet Cent, lässt leere Zeilen weg, Anfahrt nur mit Kilometern und nur zur Anzeige", () => {
    const gerundet = einsatzKosten({
      team: [{ person: person({ id: "r", name: "Ria", kuerzel: "RI", satzFahrtCent: 100, satzArbeitCent: 100 }), fahrtMin: 1, arbeitMin: null }],
      fahrzeugEur: null,
      fahrzeugName: null,
      anfahrten: [],
    });
    expect(gerundet).toEqual([
      expect.objectContaining({ key: "fahrt", betragCent: Math.round((1 / 60) * 100), nurAnzeige: false }),
    ]);

    const zeilen = einsatzKosten({
      team: [
        { person: mara, fahrtMin: 60, arbeitMin: 120 },
        { person: ohneKm, fahrtMin: 0, arbeitMin: null },
        { person: bus, fahrtMin: null, arbeitMin: null },
      ],
      fahrzeugEur: 80,
      fahrzeugName: "Sprinter",
      anfahrten: [
        { employeeId: "m", anKm: 10, abKm: null },
        { employeeId: "o", anKm: null, abKm: 4 },
        { employeeId: "x", anKm: 30, abKm: 30 },
      ],
    });
    const anfahrt = zeilen.find((z) => z.key === "anfahrt_team");
    expect(anfahrt).toMatchObject({ betragCent: 20 * 30, nurAnzeige: true, text: "Anfahrt Team" });
    expect(anfahrt!.formel).toContain("MK 20 km");
    expect(anfahrt!.formel).not.toContain("OH");
    expect(anfahrt!.formel).not.toContain("XA");
    expect(zeilen.find((z) => z.key === "fahrt")!.nurAnzeige).toBe(false);
    expect(zeilen.find((z) => z.key === "arbeit")!.nurAnzeige).toBe(false);
    expect(zeilen.find((z) => z.key === "fahrzeug")).toMatchObject({ text: "Sprinter", betragCent: 8000, nurAnzeige: false });
    expect(zeilen.filter((z) => z.betragCent <= 0)).toEqual([]);

    expect(
      einsatzKosten({
        team: [{ person: bus, fahrtMin: 0, arbeitMin: null }],
        fahrzeugEur: 0,
        fahrzeugName: null,
        anfahrten: [],
      }),
    ).toEqual([]);
  });
});

describe("planMinutenJePerson", () => {
  it("trifft bei gleichen Sätzen personal.arbeit und personal.fahrt, größeres Team weniger Arbeit", () => {
    const ps = { arbeitPm: 120, fahrerPm: 60, fahrzeitPm: 30, pufferProzent: 10 };
    const n = 2;
    const fahrtEingang = 30;
    const satzArbeit = 2000;
    const satzFahrt = 1500;
    const minuten = planMinutenJePerson({ teamgroesse: n, fahrtMin: fahrtEingang, personenH: null, personalStunden: ps });
    const puffer = 1 + ps.pufferProzent / 100;
    const arbeitEuro = ((ps.arbeitPm + ps.fahrerPm) * puffer) / 60 * (satzArbeit / 100);
    const fahrtEuro = n * ((fahrtEingang * puffer) / 60) * (satzFahrt / 100);
    const leute = Array.from({ length: n }, (_, i) =>
      person({ id: `p${i}`, name: `Person ${i}`, kuerzel: `P${i}`, satzArbeitCent: satzArbeit, satzFahrtCent: satzFahrt }),
    );
    const zeilen = einsatzKosten({
      team: leute.map((p) => ({ person: p, fahrtMin: minuten.fahrtMin, arbeitMin: minuten.arbeitMin })),
      fahrzeugEur: null,
      fahrzeugName: null,
      anfahrten: [],
    });
    const lohn = zeilen.reduce((s, z) => s + z.betragCent, 0);
    expect(lohn).toBe(Math.round((arbeitEuro + fahrtEuro) * 100));

    const groesser = planMinutenJePerson({ teamgroesse: 4, fahrtMin: fahrtEingang, personenH: null, personalStunden: ps });
    expect(groesser.arbeitMin!).toBeLessThan(minuten.arbeitMin!);
    expect(groesser.fahrtMin).toBe(minuten.fahrtMin);
  });

  it("alter Rechner ohne personalStunden", () => {
    expect(planMinutenJePerson({ teamgroesse: 2, fahrtMin: 40, personenH: 6, personalStunden: null })).toEqual({
      fahrtMin: 40,
      arbeitMin: 140,
    });
    expect(planMinutenJePerson({ teamgroesse: 1, fahrtMin: null, personenH: 2, personalStunden: undefined })).toEqual({
      fahrtMin: null,
      arbeitMin: 120,
    });
    expect(planMinutenJePerson({ teamgroesse: 2, fahrtMin: 15, personenH: null, personalStunden: null })).toEqual({
      fahrtMin: 15,
      arbeitMin: null,
    });
  });
});

describe("lohnVergleich", () => {
  const ueber = lohnVergleich({
    kosten: [kostenZeile("arbeit", 13800)],
    posten: [
      { key: "personal.arbeit", betrag: 80 },
      { key: "personal.fahrt", betrag: 20 },
    ],
    festpreisEur: 1267,
    selbstkostenEur: 798,
  });

  it("darüber gold mit Marge, darunter, gleich, ohne Zeilen, ohne Preis", () => {
    expect(ueber.differenzCent).toBe(3800);
    expect(ueber.ton).toBe("gold");
    expect(ueber.text).toBe("+38 € gegenüber Kalkulation, Marge 34 % statt 37 %");

    const unter = lohnVergleich({
      kosten: [kostenZeile("arbeit", 6200)],
      posten: [{ key: "personal.arbeit", betrag: 100 }],
      festpreisEur: 1267,
      selbstkostenEur: 798,
    });
    expect(unter.ton).toBe("normal");
    expect(unter.text).toBe("38 € unter Kalkulation, Marge 40 % statt 37 %");

    const gleich = lohnVergleich({
      kosten: [kostenZeile("arbeit", 10000)],
      posten: [{ key: "anfahrtsgeld", betrag: 100 }],
      festpreisEur: 1000,
      selbstkostenEur: 630,
    });
    expect(gleich.text).toBe("wie Kalkulation, Marge 37 %");
    expect(gleich.ton).toBe("normal");

    const ohneZeilen = lohnVergleich({
      kosten: [kostenZeile("arbeit", 1000)],
      posten: [{ key: "material", betrag: 50 }],
      festpreisEur: 1000,
      selbstkostenEur: 600,
    });
    expect(ohneZeilen.text).toBeNull();
    expect(ohneZeilen.kalkulationCent).toBeNull();

    const ohnePreis = lohnVergleich({
      kosten: [kostenZeile("arbeit", 13800), kostenZeile("anfahrt_team", 0)],
      posten: [{ key: "personal.arbeit", betrag: 100 }],
      festpreisEur: null,
      selbstkostenEur: 798,
    });
    expect(ohnePreis.text).toBe("+38 € gegenüber Kalkulation");
    expect(ohnePreis.margeNeuProzent).toBeNull();
    expect(ohnePreis.lohnCent).toBe(13800);
    expect(ohnePreis.anfahrtCent).toBe(0);
  });
});

describe("auslastungAus", () => {
  it("Küche, fehlende Schätzung, Deckel bei 1, Gold ab 0,9, Fahrten im Text", () => {
    expect(auslastungAus({ fahrten: 1, auslastung: 0.5 }, "kuechenmontage")).toEqual({
      anteil: null,
      text: "kein Volumen",
      formel: "Ladevolumen ÷ (Laderaum × Fahrten)",
      ton: "leer",
    });
    expect(auslastungAus(null, "umzug").text).toBe("keine Schätzung");
    expect(auslastungAus({ fahrten: 1 }, "umzug").text).toBe("keine Schätzung");
    expect(auslastungAus({ fahrten: 1, auslastung: 1.4 }, "umzug")).toMatchObject({ anteil: 1, text: "100 %", ton: "gold" });
    expect(auslastungAus({ fahrten: 1, auslastung: 0.9 }, "umzug").ton).toBe("gold");
    expect(auslastungAus({ fahrten: 1, auslastung: 0.89 }, "umzug").ton).toBe("normal");
    expect(auslastungAus({ fahrten: 2, auslastung: 0.64 }, "umzug")).toMatchObject({
      anteil: 0.64,
      text: "64 % bei 2 Fahrten",
      ton: "normal",
    });
  });
});

describe("Ort, Adresse, Cache, Minuten, Anfahrt, Lage", () => {
  it("Schlüssel und Anzeige", () => {
    expect(ortSchluessel("70176", "  Bad   Cannstatt ")).toBe("70176 bad cannstatt");
    expect(ortSchluessel("7017", "Stuttgart")).toBeNull();
    expect(ortSchluessel("70176", "  ")).toBeNull();
    expect(ortSchluessel(null, "Stuttgart")).toBeNull();
    expect(ortText({ plz: "70176", wohnort: "Stuttgart" })).toBe("70176 Stuttgart");
    expect(ortText({ plz: null, wohnort: "Stuttgart" })).toBe("Stuttgart");
    expect(ortText({ plz: "70176", wohnort: "  " })).toBeNull();
    expect(adresseSchluessel("  Königstr.  1, Deutschland")).toBe("königstr. 1");
    expect(adresseSchluessel("Main St, Germany")).toBe("main st");
  });

  it("Cache 29 Tage gültig, 30 nicht; Minuten aus Kilometern; Anfahrtstext", () => {
    const tag = 24 * 60 * 60 * 1000;
    const jetzt = new Date("2026-07-01T12:00:00.000Z");
    expect(cacheGueltig(new Date(jetzt.getTime() - 29 * tag), jetzt)).toBe(true);
    expect(cacheGueltig(new Date(jetzt.getTime() - 30 * tag + 1), jetzt)).toBe(true);
    expect(cacheGueltig(new Date(jetzt.getTime() - 30 * tag), jetzt)).toBe(false);
    expect(minutenAusKm(14)).toBe(17);
    expect(minutenAusKm(50)).toBe(60);
    expect(minutenAusKm(0)).toBe(1);
    expect(anfahrtText(14, 22, "verkehr")).toBe("14 km · 22 min");
    expect(anfahrtText(14, 17, "geschaetzt")).toBe("14 km · ca. 17 min");
    expect(anfahrtText(null, 22, "verkehr")).toBe("unbekannt");
    expect(anfahrtText(14, null, "geschaetzt")).toBe("14 km");
  });

  it("abwesend geht vor belegt, sonst frei", () => {
    const kurz = (id: string): PersonKurz => ({ id, name: id, kuerzel: id });
    const tag = (ab: string[], be: string[]): KapazitaetTag => ({
      tag: "2026-12-01",
      frei: [],
      belegt: be.map((id) => ({ person: kurz(id), deals: [] })),
      abwesend: ab.map((id) => ({ person: kurz(id), art: "urlaub" })),
      freiZahl: 0,
      ton: "rot",
      text: "0 frei",
    });
    expect(lageAmEinsatz([tag(["a"], ["a", "b"])], "a")).toBe("abwesend");
    expect(lageAmEinsatz([tag([], ["b"])], "b")).toBe("belegt");
    expect(lageAmEinsatz([tag([], [])], "c")).toBe("frei");
    expect(lageAmEinsatz([], "c")).toBe("frei");
  });
});

describe("Sätze und Stammdaten", () => {
  it("Cent und Stundensatz hin und zurück", () => {
    expect(centAusHourlyRate("20,5")).toBe(2050);
    expect(hourlyRateAusCent(2050)).toBe("20.50");
    expect(centAusHourlyRate(hourlyRateAusCent(2050))).toBe(2050);
    expect(centAusHourlyRate("x")).toBeNull();
    expect(centAusHourlyRate(-1)).toBeNull();
    expect(centAusHourlyRate("-1")).toBeNull();
  });

  it("jeden Stammdaten-Fehler, PLZ mit führender Null", () => {
    expect(pruefeStammdaten({ name: "  " }, true)).toBe("NAME_LEER");
    expect(pruefeStammdaten({ name: "a".repeat(81) }, true)).toBe("NAME_LANG");
    expect(pruefeStammdaten({ name: "Ada", wohnort: "o".repeat(81) }, true)).toBe("WOHNORT_LANG");
    expect(pruefeStammdaten({ name: "Ada", plz: "7017" }, true)).toBe("PLZ_UNGUELTIG");
    expect(pruefeStammdaten({ name: "Ada", plz: "01067" }, true)).toBeNull();
    expect(pruefeStammdaten({ name: "Ada", satzArbeitCent: 99 }, true)).toBe("SATZ_UNGUELTIG");
    expect(pruefeStammdaten({ name: "Ada", satzFahrtCent: 20001 }, true)).toBe("SATZ_UNGUELTIG");
    expect(pruefeStammdaten({ name: "Ada", satzArbeitCent: 15.5 }, true)).toBe("SATZ_UNGUELTIG");
    expect(pruefeStammdaten({ name: "a".repeat(80), plz: "01067", wohnort: "o".repeat(80), satzArbeitCent: 100, satzFahrtCent: 20000 }, true)).toBeNull();
    expect(pruefeStammdaten({}, false)).toBeNull();
    expect(pruefeStammdaten({ name: " " }, false)).toBe("NAME_LEER");
  });
});

describe("pruefeAbwesenheit", () => {
  it("92 Tage, Schaltjahr, ungültiger Februar", () => {
    expect(pruefeAbwesenheit({ von: "2026-01-01", bis: "2026-04-02", art: "urlaub" })).toBeNull();
    expect(pruefeAbwesenheit({ von: "2026-01-01", bis: "2026-04-03", art: "urlaub" })).toBe("ZEITRAUM_UNGUELTIG");
    expect(pruefeAbwesenheit({ von: "2028-02-29", bis: "2028-02-29", art: "krank" })).toBeNull();
    expect(pruefeAbwesenheit({ von: "2027-02-29", bis: "2027-02-29", art: "krank" })).toBe("ZEITRAUM_UNGUELTIG");
    expect(pruefeAbwesenheit({ von: "2026-12-02", bis: "2026-12-01", art: "urlaub" })).toBe("ZEITRAUM_UNGUELTIG");
    expect(pruefeAbwesenheit({ von: "2026-12-01", bis: "2026-12-01", art: "frei" })).toBe("ART_UNGUELTIG");
  });
});

describe("Buchung", () => {
  it("prüft Zeitraum und Angaben", () => {
    expect(pruefeBuchung(buchungsEingabe())).toBeNull();
    expect(pruefeBuchung(buchungsEingabe({ bis: "2026-12-02" }))).toBe("ZEITRAUM_UNGUELTIG");
    expect(pruefeBuchung(buchungsEingabe({ von: "2026-12-02", bis: "2026-12-01" }))).toBe("ZEITRAUM_UNGUELTIG");
    expect(pruefeBuchung(buchungsEingabe({ firmaId: "" }))).toBe("BUCHUNG_UNGUELTIG");
    expect(pruefeBuchung(buchungsEingabe({ stationName: "  " }))).toBe("BUCHUNG_UNGUELTIG");
    expect(pruefeBuchung(buchungsEingabe({ mieteCent: 10.5 }))).toBe("BUCHUNG_UNGUELTIG");
    expect(pruefeBuchung(buchungsEingabe({ geplanteAuftraege: 0 }))).toBe("BUCHUNG_UNGUELTIG");
    expect(pruefeBuchung(buchungsEingabe({ geplanteAuftraege: 21 }))).toBe("BUCHUNG_UNGUELTIG");
    expect(pruefeBuchung(buchungsEingabe({ inklusivKm: null, mehrkmSatzCent: null }))).toBeNull();
  });

  it("Anteil: Cent aufgerundet, Kilometer abgerundet", () => {
    expect(buchungsAnteil({ id: "b", mieteCent: 100, geplanteAuftraege: 3, inklusivKm: 100, mehrkmSatzCent: 25 })).toMatchObject({
      anteilCent: 34,
      inklusivKmAnteil: 33,
      geplanteAuftraege: 3,
      mehrkmSatzCent: 25,
    });
    expect(buchungsAnteil({ id: "b", mieteCent: 100, geplanteAuftraege: 3, inklusivKm: null, mehrkmSatzCent: null }).inklusivKmAnteil).toBeNull();
    expect(buchungsAnteil({ id: "b", mieteCent: 100, geplanteAuftraege: 0, inklusivKm: 10, mehrkmSatzCent: null })).toMatchObject({
      geplanteAuftraege: 1,
      anteilCent: 100,
      inklusivKmAnteil: 10,
    });
  });

  it("Rechner-Feld hin und zurück, Ungültiges ist null", () => {
    const b = buchung({ von: "2026-11-01", bis: "2026-11-03" });
    const anteil = buchungsAnteil({ id: b.id, mieteCent: 100, geplanteAuftraege: 3, inklusivKm: 100, mehrkmSatzCent: 25 });
    const roh = rechnerBuchungFeld(b, anteil);
    const zurueck = anteilAusRechnerFeld(roh);
    expect(zurueck).toMatchObject({
      buchungId: b.id,
      mieteCent: 0,
      geplanteAuftraege: 0,
      anteilCent: anteil.anteilCent,
      inklusivKmAnteil: anteil.inklusivKmAnteil,
      mehrkmSatzCent: 25,
    });
    expect(gleicherAnteil(anteil, zurueck)).toBe(true);
    expect(gleicherAnteil(null, null)).toBe(true);
    expect(gleicherAnteil(anteil, null)).toBe(false);
    expect(gleicherAnteil(anteil, { ...anteil, anteilCent: anteil.anteilCent + 1 })).toBe(false);
    for (const roh of ["", "kein json", "{}", "null", '{"id":"a"}']) expect(anteilAusRechnerFeld(roh)).toBeNull();
    expect(anteilAusRechnerFeld(null)).toBeNull();
  });

  it("Restkilometer", () => {
    expect(restKm({ inklusivKm: 100 }, [
      { dealId: "d", titel: "A", tag: "2026-12-01", geschaetzteKm: 40 },
      { dealId: "e", titel: "B", tag: null, geschaetzteKm: 30 },
    ])).toBe(30);
    expect(restKm({ inklusivKm: null }, [])).toBeNull();
    expect(restKm({ inklusivKm: 100 }, [{ dealId: "d", titel: "A", tag: null, geschaetzteKm: null }])).toBeNull();
  });

  it("Warnungen: storniert, alter Anteil, zu viele Aufträge, Termin, Kilometer", () => {
    const alt = buchungsAnteil(buchung({ mieteCent: 10000, geplanteAuftraege: 2, inklusivKm: 10 }));
    const lebendig = buchung({ mieteCent: 20000, geplanteAuftraege: 2, inklusivKm: 10, status: "bestaetigt" });
    const zuordnungen = [
      { dealId: "d1", titel: "Müller", tag: "2026-11-02", geschaetzteKm: 8 },
      { dealId: "d2", titel: "Schmidt", tag: "2026-12-01", geschaetzteKm: 8 },
      { dealId: "d3", titel: "Klein", tag: "2026-11-03", geschaetzteKm: 8 },
    ];
    expect(
      buchungsWarnungen({
        buchung: lebendig,
        zuordnungen,
        eingefroren: [{ dealId: "d1", titel: "Müller", datum: "2026-11-02", anteil: alt }],
      }),
    ).toEqual([
      "1 gesendete Preise beruhen auf dem alten Stand der Buchung (Müller). Die Preise bleiben.",
      "3 Aufträge zugeordnet, geplant waren 2.",
      "Termin außerhalb der Buchung: Schmidt.",
      "14 km über den inklusiven Kilometern.",
    ]);

    expect(
      buchungsWarnungen({
        buchung: buchung({ status: "storniert", geplanteAuftraege: 1, inklusivKm: 10 }),
        zuordnungen,
        eingefroren: [{ dealId: "d1", titel: "Müller", datum: "2026-11-02", anteil: alt }],
      }),
    ).toEqual(["Storniert, aber 1 gesendete Preise rechnen mit dieser Buchung (Müller). Die Preise bleiben."]);
  });

  it("Leistentext: ein Tag, über den Monat, storniert", () => {
    const basis = { klasseName: "Sprinter L", stationName: "Sixt Feuerbach", mieteCent: 45000, inklusivKm: 800, geplanteAuftraege: 4 };
    expect(buchungsLeisteText(buchung({ ...basis, von: "2026-11-16", bis: "2026-11-16" }), [])).toBe(
      "Sprinter L · Sixt Feuerbach · Mo 16.11. · 450 € · 800 km inkl. · 0 von 4 Aufträgen · Rest 800 km",
    );
    expect(buchungsLeisteText(buchung({ ...basis, von: "2026-11-17", bis: "2026-11-23" }), [])).toContain("Di 17. bis Mo 23.11.");
    expect(buchungsLeisteText(buchung({ ...basis, von: "2026-11-30", bis: "2026-12-02" }), [])).toContain("Mo 30.11. bis Mi 2.12.");
    expect(buchungsLeisteText(buchung({ ...basis, von: "2026-11-16", bis: "2026-11-16", status: "storniert" }), [])).toContain("storniert");
  });
});

describe("Karte", () => {
  const jemand = (over: Partial<KartenPerson> & Pick<KartenPerson, "employeeId" | "name" | "lage">): KartenPerson => ({
    kuerzel: over.name.slice(0, 1),
    ortText: "Stuttgart",
    ortSchluessel: "70176 stuttgart",
    punkt: [9.1, 48.7],
    ...over,
  });

  it("Pins bündeln, Grenzen, Ziehen", () => {
    const { gruppen, ohnePunkt } = pinGruppen([
      jemand({ employeeId: "1", name: "Zoe", lage: "belegt", ortSchluessel: "b-ort" }),
      jemand({ employeeId: "2", name: "Anna", lage: "frei", ortSchluessel: "b-ort" }),
      jemand({ employeeId: "3", name: "Ohne", lage: "frei", punkt: null, ortSchluessel: null, ortText: null }),
      jemand({ employeeId: "4", name: "Bert", lage: "frei", ortSchluessel: "a-ort", punkt: [8, 47], ortText: "Esslingen" }),
      jemand({ employeeId: "5", name: "Cia", lage: "abwesend", ortSchluessel: null, punkt: [9.12341, 48.50001] }),
      jemand({ employeeId: "6", name: "Dan", lage: "frei", ortSchluessel: null, punkt: [9.12344, 48.50004] }),
    ]);
    expect(ohnePunkt.map((p) => p.employeeId)).toEqual(["3"]);
    expect(gruppen.map((g) => g.schluessel)).toEqual(["9.1234,48.5000", "a-ort", "b-ort"]);
    expect(gruppen[2]!.personen.map((p) => p.employeeId)).toEqual(["2", "1"]);
    expect(gruppen[2]!.freiZahl).toBe(1);
    expect(gruppen[0]!.personen.map((p) => p.lage)).toEqual(["frei", "abwesend"]);

    expect(kartenGrenzen({ beladen: null, entladen: null, linie: [] }, [])).toBeNull();
    expect(
      kartenGrenzen(
        { beladen: { punkt: [1, 2], text: "A", quelle: "route" }, entladen: { punkt: [3, 4], text: "B", quelle: "route" }, linie: [[0, 5]] },
        [{ schluessel: "p", punkt: [2, 1], ortText: "", personen: [], freiZahl: 0 }],
      ),
    ).toEqual([[0, 1], [3, 5]]);

    expect(ziehenErgebnis("abwesend", true)).toBe("schon_im_team");
    expect(ziehenErgebnis("abwesend", false)).toBe("rueckfrage_abwesend");
    expect(ziehenErgebnis("belegt", false)).toBe("rueckfrage_belegt");
    expect(ziehenErgebnis("frei", false)).toBe("hinzufuegen");
  });
});
