import { describe, expect, it } from "vitest";
import { LEERER_FILTER, type LeadKategorie, type LeadsChipKey, type LeadsFilter } from "./leads-board";
import {
  ankerVerschieben,
  berlinZeitZuIso,
  eintraegeAm,
  eintragTitel,
  eintragZeile,
  heuteKopf,
  imBlickAus,
  istTag,
  leadsChipLink,
  liveText,
  monatsRaster,
  planAbfrageAusParams,
  planAbfrageZuParams,
  planAnsichtAus,
  planAnsichtPruefen,
  planFenster,
  planTitel,
  planZustandAusParams,
  planZustandZuParams,
  streckeText,
  tagPlus,
  tonAus,
  verschiebenPruefen,
  verschiebenText,
  wocheVon,
  wochentag,
  ziehbarAus,
  type PlanAbfrage,
  type PlanArt,
  type PlanEintrag,
  type PlanFehlt,
  type PlanLive,
  type PlanTon,
} from "./plan-heute";

/** Freitag, 6. November 2026. Grenzen als UTC-Zeitpunkte, unabhängig von TZ. */
const HEUTE = "2026-11-06";

function eintrag(teil: Partial<PlanEintrag> & Pick<PlanEintrag, "id" | "tag">): PlanEintrag {
  const basis: PlanEintrag = {
    id: teil.id,
    dealId: teil.id,
    art: "umzug",
    label: "Umzug",
    tag: teil.tag,
    bisTag: teil.tag,
    von: null,
    bis: null,
    zeitText: null,
    ton: "jade",
    fehlt: [],
    titel: "Familie Can",
    zeile: "",
    betragText: null,
    strecke: null,
    team: [],
    teamFehlt: false,
    transporter: null,
    firma: null,
    stufe: { id: "st-geplant", label: "Geplant", kategorie: "booked" },
    datumQuelle: "feld",
    ziehbar: true,
    annahmeAm: null,
    href: `/app/leads/${teil.id}`,
  };
  return { ...basis, ...teil };
}

describe("istTag", () => {
  it("nimmt echte Kalendertage, auch den 29.02. im Schaltjahr", () => {
    expect(istTag("2024-02-29")).toBe(true);
    expect(istTag("2000-02-29")).toBe(true);
    expect(istTag("2026-11-06")).toBe(true);
    expect(istTag("2026-01-01")).toBe(true);
    expect(istTag("2026-12-31")).toBe(true);
  });

  it("lehnt den 31.02., den 29.02. außerhalb des Schaltjahrs und Jahrhundertjahre ohne Schaltregel ab", () => {
    expect(istTag("2026-02-31")).toBe(false);
    expect(istTag("2026-02-29")).toBe(false);
    expect(istTag("2025-02-29")).toBe(false);
    expect(istTag("2024-02-30")).toBe(false);
    expect(istTag("1900-02-29")).toBe(false);
    expect(istTag("2026-04-31")).toBe(false);
    expect(istTag("2026-11-00")).toBe(false);
    expect(istTag("2026-00-10")).toBe(false);
    expect(istTag("2026-13-01")).toBe(false);
  });

  it("lehnt falsche Form und andere Typen ab", () => {
    expect(istTag("2026-11-6")).toBe(false);
    expect(istTag("2026-11-06T00:00:00.000Z")).toBe(false);
    expect(istTag("06.11.2026")).toBe(false);
    expect(istTag("")).toBe(false);
    expect(istTag("2026-11-06 ")).toBe(false);
    expect(istTag(null)).toBe(false);
    expect(istTag(undefined)).toBe(false);
    expect(istTag(20261106)).toBe(false);
  });
});

describe("tagPlus, wochentag und wocheVon", () => {
  it("springt über Jahreswechsel, Monatsende und Schaltjahr, ohne einen Tag zu verlieren", () => {
    expect(tagPlus("2026-12-31", 1)).toBe("2027-01-01");
    expect(tagPlus("2027-01-01", -1)).toBe("2026-12-31");
    expect(tagPlus("2026-01-31", 1)).toBe("2026-02-01");
    expect(tagPlus("2024-02-28", 1)).toBe("2024-02-29");
    expect(tagPlus("2024-02-29", 1)).toBe("2024-03-01");
    expect(tagPlus("2026-02-28", 1)).toBe("2026-03-01");
    expect(tagPlus("2026-01-01", 61)).toBe("2026-03-03");
    expect(tagPlus("2026-01-01", 62)).toBe("2026-03-04");
  });

  it("lässt die Sommerzeit weder einen Tag verschlucken noch doppelt zählen", () => {
    // 2026-03-29 und 2027-03-28: Uhr springt vor. 2026-10-25: Uhr springt zurück.
    expect(tagPlus("2026-03-28", 1)).toBe("2026-03-29");
    expect(tagPlus("2026-03-29", 1)).toBe("2026-03-30");
    expect(tagPlus("2027-03-27", 1)).toBe("2027-03-28");
    expect(tagPlus("2027-03-28", 1)).toBe("2027-03-29");
    expect(tagPlus("2026-10-24", 1)).toBe("2026-10-25");
    expect(tagPlus("2026-10-25", 1)).toBe("2026-10-26");
  });

  it("zählt Montag als 0 und Sonntag als 6, auch am Wochenwechsel der Zeitumstellung", () => {
    expect(wochentag("2026-11-02")).toBe(0);
    expect(wochentag("2026-11-06")).toBe(4);
    expect(wochentag("2026-11-08")).toBe(6);
    expect(wochentag("2026-06-01")).toBe(0);
    expect(wochentag("2026-02-01")).toBe(6);
    expect(wochentag("2026-03-01")).toBe(6);
    expect(wochentag("2026-03-29")).toBe(6);
    expect(wochentag("2026-10-25")).toBe(6);
    expect(wochentag("2027-03-28")).toBe(6);
    expect(wochentag("2026-12-31")).toBe(3);
    expect(wochentag("2027-01-01")).toBe(4);
    expect(wochentag("2027-02-01")).toBe(0);
  });

  it("findet den Montag, auch wenn die Woche über den Jahreswechsel oder die Sommerzeit reicht", () => {
    expect(wocheVon("2026-11-02")).toBe("2026-11-02");
    expect(wocheVon("2026-11-06")).toBe("2026-11-02");
    expect(wocheVon("2026-11-08")).toBe("2026-11-02");
    expect(wocheVon("2027-01-01")).toBe("2026-12-28");
    expect(wocheVon("2027-01-03")).toBe("2026-12-28");
    expect(wocheVon("2026-03-29")).toBe("2026-03-23");
    expect(wocheVon("2026-10-25")).toBe("2026-10-19");
  });
});

describe("monatsRaster", () => {
  function raender(anker: string) {
    const wochen = monatsRaster(anker);
    return {
      zeilen: wochen.length,
      von: wochen[0]?.[0],
      bis: wochen.at(-1)?.[6],
      wochen,
    };
  }

  it("beginnt am Montag, wenn der Monatserste ein Montag ist, und nimmt die Nachbartage mit", () => {
    const juni = raender("2026-06-18");
    expect(juni.zeilen).toBe(5);
    expect(juni.von).toBe("2026-06-01");
    expect(juni.bis).toBe("2026-07-05");
    expect(juni.wochen[0]).toEqual([
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
      "2026-06-04",
      "2026-06-05",
      "2026-06-06",
      "2026-06-07",
    ]);
    expect(juni.wochen[4]?.[0]).toBe("2026-06-29");
    expect(juni.wochen[4]?.[1]).toBe("2026-06-30");
  });

  it("beginnt in der Vorwoche, wenn der Monatserste ein Sonntag ist", () => {
    const februar = raender("2026-02-14");
    expect(februar.zeilen).toBe(5);
    expect(februar.von).toBe("2026-01-26");
    expect(februar.bis).toBe("2026-03-01");
    expect(februar.wochen[0]?.[6]).toBe("2026-02-01");
    expect(februar.wochen[4]).toEqual([
      "2026-02-23",
      "2026-02-24",
      "2026-02-25",
      "2026-02-26",
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
    ]);
  });

  it("zeichnet den Februar ohne Schaltjahr, der an einem Montag beginnt, in vier Zeilen", () => {
    const wochen = monatsRaster("2027-02-10");
    expect(wochen).toHaveLength(4);
    expect(wochen[0]?.[0]).toBe("2027-02-01");
    expect(wochen[3]).toEqual([
      "2027-02-22",
      "2027-02-23",
      "2027-02-24",
      "2027-02-25",
      "2027-02-26",
      "2027-02-27",
      "2027-02-28",
    ]);
    expect(wochen.every((woche) => woche.length === 7 && wochentag(woche[0]!) === 0 && wochentag(woche[6]!) === 6)).toBe(
      true,
    );
  });

  it("zeichnet einen 31-Tage-Monat, der an einem Sonntag beginnt, in sechs Zeilen", () => {
    const maerz = raender("2026-03-15");
    expect(maerz.zeilen).toBe(6);
    expect(maerz.von).toBe("2026-02-23");
    expect(maerz.bis).toBe("2026-04-05");
    expect(maerz.wochen[0]?.[6]).toBe("2026-03-01");
    expect(maerz.wochen[5]?.[0]).toBe("2026-03-30");
    expect(maerz.wochen.every((woche) => woche.length === 7)).toBe(true);
  });
});

describe("planFenster", () => {
  it("gibt je Modus das inklusive Fenster", () => {
    expect(planFenster("tag", "2026-11-06")).toEqual({ von: "2026-11-06", bis: "2026-11-06" });
    expect(planFenster("woche", "2026-11-06")).toEqual({ von: "2026-11-02", bis: "2026-11-08" });
    expect(planFenster("woche", "2027-01-01")).toEqual({ von: "2026-12-28", bis: "2027-01-03" });
    expect(planFenster("woche", "2026-03-29")).toEqual({ von: "2026-03-23", bis: "2026-03-29" });
    expect(planFenster("monat", "2026-03-15")).toEqual({ von: "2026-02-23", bis: "2026-04-05" });
    expect(planFenster("monat", "2027-02-10")).toEqual({ von: "2027-02-01", bis: "2027-02-28" });
    expect(planFenster("monat", "2026-06-18")).toEqual({ von: "2026-06-01", bis: "2026-07-05" });
  });
});

describe("ankerVerschieben", () => {
  it("setzt den Monat auf den Ersten, auch vom 31.01. auf den 01.02.", () => {
    expect(ankerVerschieben("monat", "2026-01-31", 1)).toBe("2026-02-01");
    expect(ankerVerschieben("monat", "2026-01-31", -1)).toBe("2025-12-01");
    expect(ankerVerschieben("monat", "2026-03-31", 1)).toBe("2026-04-01");
    expect(ankerVerschieben("monat", "2026-05-18", 1)).toBe("2026-06-01");
  });

  it("schiebt die Woche um sieben Tage und den Tag um einen, über Sommerzeit und Jahreswechsel", () => {
    expect(ankerVerschieben("woche", "2026-11-06", 1)).toBe("2026-11-13");
    expect(ankerVerschieben("woche", "2026-11-06", -1)).toBe("2026-10-30");
    expect(ankerVerschieben("woche", "2026-03-29", 1)).toBe("2026-04-05");
    expect(ankerVerschieben("woche", "2026-10-25", 1)).toBe("2026-11-01");
    expect(ankerVerschieben("tag", "2026-03-28", 1)).toBe("2026-03-29");
    expect(ankerVerschieben("tag", "2026-10-24", 1)).toBe("2026-10-25");
    expect(ankerVerschieben("tag", "2026-12-31", 1)).toBe("2027-01-01");
    expect(ankerVerschieben("tag", "2027-01-01", -1)).toBe("2026-12-31");
  });
});

describe("planTitel", () => {
  it("nennt die Woche im selben Monat vom Montag bis zum Sonntag", () => {
    expect(planTitel("woche", "2026-11-18")).toBe("16. bis 22. November 2026");
  });

  it("nennt beide Monate, wenn die Woche über die Monatsgrenze reicht", () => {
    expect(planTitel("woche", "2026-12-02")).toBe("30. November bis 6. Dezember 2026");
  });

  it("nennt beide Jahre, wenn die Woche über den Jahreswechsel reicht", () => {
    expect(planTitel("woche", "2027-01-01")).toBe("28. Dezember 2026 bis 3. Januar 2027");
  });

  it("nennt Monat und Tag mit Wochentag", () => {
    expect(planTitel("monat", "2026-11-06")).toBe("November 2026");
    expect(planTitel("monat", "2026-03-15")).toBe("März 2026");
    expect(planTitel("tag", "2026-11-06")).toBe("Freitag, 6. November 2026");
  });
});

describe("berlinZeitZuIso", () => {
  it("rechnet Sommerzeit (UTC+2) und Winterzeit (UTC+1) nach UTC", () => {
    expect(berlinZeitZuIso("2026-07-15", "14:30")).toBe("2026-07-15T12:30:00.000Z");
    expect(berlinZeitZuIso("2026-03-29", "03:30")).toBe("2026-03-29T01:30:00.000Z");
    expect(berlinZeitZuIso("2026-01-15", "08:00")).toBe("2026-01-15T07:00:00.000Z");
    expect(berlinZeitZuIso("2026-11-06", "00:30")).toBe("2026-11-05T23:30:00.000Z");
    expect(berlinZeitZuIso("2026-10-25", "01:30")).toBe("2026-10-24T23:30:00.000Z");
    expect(berlinZeitZuIso("2026-10-25", "03:30")).toBe("2026-10-25T02:30:00.000Z");
  });

  it("trifft am 2027-03-28 die Stunde vor und nach der Umstellung", () => {
    expect(berlinZeitZuIso("2027-03-28", "00:30")).toBe("2027-03-27T23:30:00.000Z");
    expect(berlinZeitZuIso("2027-03-28", "01:30")).toBe("2027-03-28T00:30:00.000Z");
    expect(berlinZeitZuIso("2027-03-28", "03:00")).toBe("2027-03-28T01:00:00.000Z");
    expect(berlinZeitZuIso("2027-03-28", "03:30")).toBe("2027-03-28T01:30:00.000Z");
  });

  it("gibt für die übersprungene Stunde im Frühjahr null zurück, nicht still eine Stunde später", () => {
    expect(berlinZeitZuIso("2027-03-28", "02:00")).toBeNull();
    expect(berlinZeitZuIso("2027-03-28", "02:30")).toBeNull();
    expect(berlinZeitZuIso("2027-03-28", "02:59")).toBeNull();
    expect(berlinZeitZuIso("2026-03-29", "02:30")).toBeNull();
    expect(berlinZeitZuIso("2027-03-28", "01:59")).toBe("2027-03-28T00:59:00.000Z");
  });

  it("nimmt bei der doppelten Stunde im Herbst den späteren Zeitpunkt (MEZ)", () => {
    expect(berlinZeitZuIso("2026-10-25", "02:00")).toBe("2026-10-25T01:00:00.000Z");
    expect(berlinZeitZuIso("2026-10-25", "02:30")).toBe("2026-10-25T01:30:00.000Z");
    expect(berlinZeitZuIso("2026-10-25", "02:59")).toBe("2026-10-25T01:59:00.000Z");
  });

  it("gibt bei ungültigem Tag oder ungültiger Uhrzeit null zurück", () => {
    expect(berlinZeitZuIso("2026-02-31", "10:00")).toBeNull();
    expect(berlinZeitZuIso("2026-02-29", "10:00")).toBeNull();
    expect(berlinZeitZuIso("2026-11-6", "10:00")).toBeNull();
    expect(berlinZeitZuIso("2026-11-06", "24:00")).toBeNull();
    expect(berlinZeitZuIso("2026-11-06", "9:30")).toBeNull();
    expect(berlinZeitZuIso("2026-11-06", "12:60")).toBeNull();
    expect(berlinZeitZuIso("2026-11-06", "12:30:00")).toBeNull();
    expect(berlinZeitZuIso("2026-11-06", "")).toBeNull();
  });
});

describe("planAnsichtPruefen und planAnsichtAus", () => {
  it("nimmt Monat, Woche und Tag und wirft fremde Felder weg", () => {
    expect(planAnsichtPruefen({ modus: "monat" })).toEqual({ modus: "monat" });
    expect(planAnsichtPruefen({ modus: "woche", merkzettel: true })).toEqual({ modus: "woche" });
    expect(planAnsichtPruefen({ modus: "tag" })).toEqual({ modus: "tag" });
  });

  it("lehnt ungültige Werte ab", () => {
    expect(planAnsichtPruefen(null)).toBeNull();
    expect(planAnsichtPruefen("monat")).toBeNull();
    expect(planAnsichtPruefen(["monat"])).toBeNull();
    expect(planAnsichtPruefen({})).toBeNull();
    expect(planAnsichtPruefen({ modus: "jahr" })).toBeNull();
    expect(planAnsichtPruefen({ modus: "Monat" })).toBeNull();
    expect(planAnsichtPruefen({ modus: 1 })).toBeNull();
  });

  it("fällt beim Lesen auf Monat zurück und lässt den Standard unangetastet", () => {
    expect(planAnsichtAus(null)).toEqual({ modus: "monat" });
    expect(planAnsichtAus({ modus: "raster" })).toEqual({ modus: "monat" });
    expect(planAnsichtAus({ modus: "tag" })).toEqual({ modus: "tag" });
    const gelesen = planAnsichtAus({ modus: "nein" });
    gelesen.modus = "tag";
    expect(planAnsichtAus(null)).toEqual({ modus: "monat" });
  });
});

describe("planZustandAusParams und planZustandZuParams", () => {
  const gespeichert = { modus: "woche" as const };

  it("läuft rund und lässt leere Firma und Mitarbeiter weg", () => {
    const zustand = {
      modus: "tag" as const,
      anker: "2026-12-01",
      firmaId: "f-kottke",
      mitarbeiterId: "ma-1",
    };
    const params = planZustandZuParams(zustand);
    expect([...params.keys()]).toEqual(["ansicht", "tag", "firma", "ma"]);
    expect(planZustandAusParams(params, HEUTE, { modus: "monat" })).toEqual(zustand);

    const ohne = planZustandZuParams({ modus: "monat", anker: HEUTE, firmaId: null, mitarbeiterId: null });
    expect([...ohne.keys()]).toEqual(["ansicht", "tag"]);
    expect(planZustandAusParams(ohne, "2026-01-01", gespeichert)).toEqual({
      modus: "monat",
      anker: HEUTE,
      firmaId: null,
      mitarbeiterId: null,
    });
  });

  it("nimmt die URL vor der gespeicherten Ansicht", () => {
    expect(planZustandAusParams(new URLSearchParams("ansicht=tag&tag=2026-12-01"), HEUTE, gespeichert)).toEqual({
      modus: "tag",
      anker: "2026-12-01",
      firmaId: null,
      mitarbeiterId: null,
    });
    expect(planZustandAusParams(new URLSearchParams("tag=2026-12-01"), HEUTE, gespeichert).modus).toBe("woche");
    expect(planZustandAusParams(new URLSearchParams("ansicht=jahr&tag=2026-12-01"), HEUTE, gespeichert).modus).toBe(
      "woche",
    );
  });

  it("setzt einen ungültigen Tag auf heute", () => {
    expect(planZustandAusParams(new URLSearchParams("ansicht=tag&tag=2026-02-31&firma=f-1&ma=ma-1"), HEUTE, gespeichert)).toEqual({
      modus: "tag",
      anker: HEUTE,
      firmaId: "f-1",
      mitarbeiterId: "ma-1",
    });
    expect(planZustandAusParams(new URLSearchParams("tag=2026-11-6"), HEUTE, gespeichert).anker).toBe(HEUTE);
    expect(planZustandAusParams(new URLSearchParams(), HEUTE, gespeichert)).toEqual({
      modus: "woche",
      anker: HEUTE,
      firmaId: null,
      mitarbeiterId: null,
    });
    expect(planZustandAusParams(new URLSearchParams("firma=&ma="), HEUTE, gespeichert)).toMatchObject({
      firmaId: null,
      mitarbeiterId: null,
    });
  });
});

describe("planAbfrageAusParams und planAbfrageZuParams", () => {
  it("verlangt von und bis als Tage und lehnt die verkehrte Reihenfolge ab", () => {
    expect(planAbfrageAusParams(new URLSearchParams())).toEqual({
      fehler: "von und bis müssen Tage im Format JJJJ-MM-TT sein.",
    });
    expect(planAbfrageAusParams(new URLSearchParams("von=2026-11-01"))).toEqual({
      fehler: "von und bis müssen Tage im Format JJJJ-MM-TT sein.",
    });
    expect(planAbfrageAusParams(new URLSearchParams("bis=2026-11-01"))).toEqual({
      fehler: "von und bis müssen Tage im Format JJJJ-MM-TT sein.",
    });
    expect(planAbfrageAusParams(new URLSearchParams("von=2026-02-31&bis=2026-03-01"))).toEqual({
      fehler: "von und bis müssen Tage im Format JJJJ-MM-TT sein.",
    });
    expect(planAbfrageAusParams(new URLSearchParams("von=2026-11-08&bis=2026-11-02"))).toEqual({
      fehler: "von liegt nach bis.",
    });
    expect(planAbfrageAusParams(new URLSearchParams("von=2026-11-06&bis=2026-11-06"))).toMatchObject({
      von: "2026-11-06",
      bis: "2026-11-06",
      leads: null,
    });
  });

  it("erlaubt 62 Tage inklusive und lehnt den 63. ab", () => {
    const genau = planAbfrageAusParams(new URLSearchParams("von=2026-01-01&bis=2026-03-03"));
    expect(genau).toMatchObject({ von: "2026-01-01", bis: "2026-03-03" });
    expect("fehler" in genau).toBe(false);

    const sommerzeit = planAbfrageAusParams(new URLSearchParams("von=2026-03-20&bis=2026-05-20"));
    expect(sommerzeit).toMatchObject({ von: "2026-03-20", bis: "2026-05-20" });

    expect(planAbfrageAusParams(new URLSearchParams("von=2026-01-01&bis=2026-03-04"))).toEqual({
      fehler: "Höchstens 62 Tage je Abfrage.",
    });
  });

  it("hängt im Leads-Kalender den Monat ab und lässt die übrigen Filter stehen", () => {
    const params = new URLSearchParams(
      "leads=1&monat=2026-11&chip=warten&firma=f-1&quelle=q-1&q=Nord&nur=uns&alle=1&von=2026-11-02&bis=2026-11-08&ma=ma-1",
    );
    expect(planAbfrageAusParams(params)).toEqual({
      von: "2026-11-02",
      bis: "2026-11-08",
      firmaId: "f-1",
      mitarbeiterId: "ma-1",
      leads: {
        chip: "warten",
        firmaId: "f-1",
        quelleId: "q-1",
        monat: null,
        suche: "Nord",
        nurWartet: true,
        endstufen: true,
      },
    });
    const nurLeads = planAbfrageAusParams(new URLSearchParams("leads=1&monat=2026-11&von=2026-11-02&bis=2026-11-08"));
    expect("leads" in nurLeads && nurLeads.leads).toEqual(LEERER_FILTER);
    const ohne = planAbfrageAusParams(
      new URLSearchParams("monat=2026-11&chip=warten&von=2026-11-02&bis=2026-11-08&firma=f-1"),
    );
    expect(ohne).toMatchObject({ leads: null, firmaId: "f-1" });
  });

  it("läuft rund und schreibt die Firma im Leads-Kalender aus dem Filter", () => {
    const plan: PlanAbfrage = {
      von: "2026-11-02",
      bis: "2026-11-08",
      firmaId: "f-1",
      mitarbeiterId: "ma-1",
      leads: null,
    };
    const planParams = planAbfrageZuParams(plan);
    expect([...planParams.keys()]).toEqual(["firma", "von", "bis", "ma"]);
    expect(planAbfrageAusParams(planParams)).toEqual(plan);

    const leads: LeadsFilter = {
      chip: "warten",
      firmaId: "f-1",
      quelleId: "q-1",
      monat: "2026-11",
      suche: "Nord",
      nurWartet: true,
      endstufen: true,
    };
    const kalender: PlanAbfrage = { ...plan, leads };
    const kalenderParams = planAbfrageZuParams(kalender);
    expect([...kalenderParams.keys()]).toEqual(["chip", "firma", "quelle", "q", "nur", "alle", "leads", "von", "bis", "ma"]);
    expect(kalenderParams.has("monat")).toBe(false);
    expect(planAbfrageAusParams(kalenderParams)).toEqual({ ...kalender, leads: { ...leads, monat: null } });

    const andereFirma = planAbfrageZuParams({ ...kalender, firmaId: "andere", leads: { ...leads, monat: null } });
    expect(andereFirma.get("firma")).toBe("f-1");
  });
});

describe("tonAus", () => {
  function ton(teil: {
    art?: PlanArt;
    kategorie?: LeadKategorie | null;
    geschaetzt?: boolean;
    teamFehlt?: boolean;
    bisTag?: string;
  }): { ton: PlanTon; fehlt: PlanFehlt[] } {
    return tonAus(
      {
        art: teil.art ?? "umzug",
        kategorie: teil.kategorie === undefined ? "booked" : teil.kategorie,
        geschaetzt: teil.geschaetzt ?? false,
        teamFehlt: teil.teamFehlt ?? false,
        bisTag: teil.bisTag ?? HEUTE,
      },
      HEUTE,
    );
  }

  it.each<{
    name: string;
    art?: PlanArt;
    kategorie?: LeadKategorie | null;
    geschaetzt?: boolean;
    teamFehlt?: boolean;
    bisTag?: string;
    ton: PlanTon;
    fehlt: PlanFehlt[];
  }>([
    { name: "Durchgeführt ist grau", kategorie: "done_unpaid", teamFehlt: true, bisTag: "2026-11-01", ton: "grau", fehlt: [] },
    {
      name: "Bezahlt ist grau, auch als künftige Besichtigung",
      art: "besichtigung",
      kategorie: "paid",
      bisTag: "2026-11-20",
      ton: "grau",
      fehlt: [],
    },
    { name: "Besichtigung heute ist violett", art: "besichtigung", ton: "violett", fehlt: [] },
    { name: "Besichtigung künftig ist violett", art: "besichtigung", bisTag: "2026-11-20", ton: "violett", fehlt: [] },
    { name: "Besichtigung vergangen ist grau", art: "besichtigung", bisTag: "2026-11-05", ton: "grau", fehlt: [] },
    {
      name: "geschätzte Besichtigung bleibt violett",
      art: "besichtigung",
      geschaetzt: true,
      bisTag: "2026-11-20",
      ton: "violett",
      fehlt: [],
    },
    { name: "geschätzt ist gestrichelt", geschaetzt: true, ton: "gestrichelt", fehlt: [] },
    {
      name: "geschätzt und vergangen bleibt gestrichelt, nicht gold",
      geschaetzt: true,
      teamFehlt: true,
      bisTag: "2026-11-01",
      ton: "gestrichelt",
      fehlt: [],
    },
    { name: "Angebot ist nicht fest", kategorie: "quoted", ton: "gestrichelt", fehlt: [] },
    { name: "Neue Anfrage ist nicht fest", kategorie: "open_new", ton: "gestrichelt", fehlt: [] },
    { name: "In Kontakt ist nicht fest", kategorie: "open_engaged", ton: "gestrichelt", fehlt: [] },
    { name: "ohne Kategorie ist nicht fest", kategorie: null, ton: "gestrichelt", fehlt: [] },
    { name: "Verloren ist nicht fest", kategorie: "lost", ton: "gestrichelt", fehlt: [] },
    { name: "Kein Lead ist nicht fest", kategorie: "kein_lead", ton: "gestrichelt", fehlt: [] },
    { name: "Geplant ohne Team ist gold", teamFehlt: true, bisTag: "2026-11-20", ton: "gold", fehlt: ["team"] },
    { name: "Geplant heute ohne Team ist gold, noch nicht zu bestätigen", teamFehlt: true, ton: "gold", fehlt: ["team"] },
    { name: "Geplant nach dem Tag ist zu bestätigen", bisTag: "2026-11-05", ton: "gold", fehlt: ["bestaetigen"] },
    {
      name: "Geplant nach dem Tag und ohne Team nennt beide Gründe",
      teamFehlt: true,
      bisTag: "2026-11-05",
      ton: "gold",
      fehlt: ["bestaetigen", "team"],
    },
    { name: "Geplant heute mit Team ist jade", ton: "jade", fehlt: [] },
    { name: "Geplant künftig mit Team ist jade", bisTag: "2026-11-20", ton: "jade", fehlt: [] },
    { name: "mehrtägig bis heute ist noch jade", bisTag: HEUTE, ton: "jade", fehlt: [] },
  ])("$name", (fall) => {
    expect(
      ton({
        art: fall.art,
        kategorie: fall.kategorie,
        geschaetzt: fall.geschaetzt,
        teamFehlt: fall.teamFehlt,
        bisTag: fall.bisTag,
      }),
    ).toEqual({ ton: fall.ton, fehlt: fall.fehlt });
  });
});

describe("ziehbarAus", () => {
  const fest = {
    art: "umzug" as const,
    ton: "jade" as const,
    datumQuelle: "feld" as const,
    tag: HEUTE,
    bisTag: HEUTE,
  };

  it("lässt einen festen eintägigen Umzug ab heute zu, jade oder gold", () => {
    expect(ziehbarAus(fest, HEUTE)).toBe(true);
    expect(ziehbarAus({ ...fest, ton: "gold", tag: "2026-11-20", bisTag: "2026-11-20" }, HEUTE)).toBe(true);
    expect(ziehbarAus({ ...fest, tag: "2026-11-20", bisTag: "2026-11-20" }, HEUTE)).toBe(true);
  });

  it("sperrt Besichtigung, andere Quellen, andere Töne, mehrtägig und Vergangenheit", () => {
    expect(ziehbarAus({ ...fest, art: "besichtigung" }, HEUTE)).toBe(false);
    expect(ziehbarAus({ ...fest, datumQuelle: "auswahl" }, HEUTE)).toBe(false);
    expect(ziehbarAus({ ...fest, datumQuelle: "fenster" }, HEUTE)).toBe(false);
    expect(ziehbarAus({ ...fest, datumQuelle: "angebot" }, HEUTE)).toBe(false);
    expect(ziehbarAus({ ...fest, datumQuelle: "termin" }, HEUTE)).toBe(false);
    expect(ziehbarAus({ ...fest, ton: "gestrichelt" }, HEUTE)).toBe(false);
    expect(ziehbarAus({ ...fest, ton: "grau" }, HEUTE)).toBe(false);
    expect(ziehbarAus({ ...fest, ton: "violett" }, HEUTE)).toBe(false);
    expect(ziehbarAus({ ...fest, bisTag: "2026-11-07" }, HEUTE)).toBe(false);
    expect(ziehbarAus({ ...fest, tag: "2026-11-05", bisTag: "2026-11-05" }, HEUTE)).toBe(false);
  });
});

describe("eintragTitel", () => {
  it("setzt bei der Besichtigung das Label davor und beim gestrichelten Umzug ein Fragezeichen", () => {
    expect(eintragTitel("Nowak", "besichtigung", "Besichtigung", "violett")).toBe("Besichtigung Nowak");
    expect(eintragTitel("Nowak", "besichtigung", "Termin", "gestrichelt")).toBe("Termin Nowak");
    expect(eintragTitel("Schulz", "umzug", "Umzug", "gestrichelt")).toBe("Schulz?");
    expect(eintragTitel("Schulz", "umzug", "Umzug", "jade")).toBe("Schulz");
    expect(eintragTitel("Schulz", "umzug", "Umzug", "gold")).toBe("Schulz");
    expect(eintragTitel("Schulz", "umzug", "Umzug", "grau")).toBe("Schulz");
  });
});

describe("streckeText", () => {
  it("verbindet zwei Orte, einen Ort lässt es stehen", () => {
    expect(streckeText("Stuttgart-Süd", "Esslingen")).toBe("Stuttgart-Süd → Esslingen");
    expect(streckeText("Stuttgart", "Stuttgart")).toBe("Stuttgart");
    expect(streckeText("Stuttgart", null)).toBe("Stuttgart");
    expect(streckeText(null, "Esslingen")).toBe("Esslingen");
    expect(streckeText(null, null)).toBeNull();
  });
});

describe("eintragZeile", () => {
  const basis = {
    art: "umzug" as const,
    label: "Umzug",
    ton: "jade" as const,
    fehlt: [] as PlanFehlt[],
    stufeLabel: "Geplant",
    betragText: "2.950 €",
    strecke: "Stuttgart-Süd → Esslingen",
    tag: "2026-11-19",
    von: null as string | null,
  };

  it("schreibt fest, mit Lücke, nicht fest und Besichtigung", () => {
    expect(eintragZeile(basis)).toBe("Umzug · 2.950 € · Stuttgart-Süd → Esslingen");
    expect(
      eintragZeile({
        ...basis,
        label: "Entrümpelung",
        ton: "gold",
        fehlt: ["team"],
        betragText: "1.200 €",
      }),
    ).toBe("Entrümpelung · 1.200 € · Team fehlt");
    expect(eintragZeile({ ...basis, ton: "gold", fehlt: ["bestaetigen"], betragText: null, strecke: null })).toBe(
      "Umzug · Durchführung bestätigen",
    );
    expect(
      eintragZeile({ ...basis, ton: "gold", fehlt: ["bestaetigen", "team"], betragText: "1.200 €" }),
    ).toBe("Umzug · 1.200 € · Durchführung bestätigen, Team fehlt");
    expect(
      eintragZeile({
        ...basis,
        ton: "gestrichelt",
        stufeLabel: "Angebot",
        betragText: "2.480 €",
        strecke: "Stuttgart → Heilbronn",
      }),
    ).toBe("Angebot · 2.480 € · Stuttgart → Heilbronn");
    expect(eintragZeile({ ...basis, ton: "grau", betragText: null, strecke: null })).toBe("Umzug");
    expect(
      eintragZeile({
        ...basis,
        art: "besichtigung",
        label: "Besichtigung",
        ton: "violett",
        von: "16:00",
        strecke: "Waiblingen",
        betragText: null,
      }),
    ).toBe("Do 16:00 · Waiblingen");
    expect(
      eintragZeile({
        ...basis,
        art: "besichtigung",
        ton: "violett",
        von: null,
        strecke: null,
        betragText: null,
      }),
    ).toBe("Do");
  });
});

describe("verschiebenPruefen", () => {
  const e = { tag: "2026-11-16", ziehbar: true };

  it("unterscheidet gleichen Tag, gesperrt, Vergangenheit und erlaubt", () => {
    expect(verschiebenPruefen(e, "2026-11-16", HEUTE)).toBe("gleich");
    expect(verschiebenPruefen({ ...e, ziehbar: false }, "2026-11-16", HEUTE)).toBe("gleich");
    expect(verschiebenPruefen({ ...e, ziehbar: false }, "2026-11-20", HEUTE)).toBe("gesperrt");
    expect(verschiebenPruefen({ tag: "2026-11-05", ziehbar: false }, "2026-11-01", HEUTE)).toBe("gesperrt");
    expect(verschiebenPruefen(e, "2026-11-05", HEUTE)).toBe("vergangenheit");
    expect(verschiebenPruefen(e, HEUTE, HEUTE)).toBe("ok");
    expect(verschiebenPruefen(e, "2026-11-20", HEUTE)).toBe("ok");
  });
});

describe("verschiebenText", () => {
  const ziel = "2026-11-20";

  it("fragt ohne Uhrzeit und ohne Annahme nur nach dem Tag", () => {
    expect(verschiebenText({ titel: "Familie Can", tag: "2026-11-16", von: null, annahmeAm: null }, ziel)).toEqual({
      titel: "Familie Can auf Fr 20.11. verschieben?",
      text: "Bisher Mo 16.11. Kunde und Team sehen den neuen Tag sofort im Portal. Eine Nachricht an den Kunden geht erst raus, wenn du sie im nächsten Schritt schickst.",
      knopf: "Verschieben",
      pflicht: null,
    });
  });

  it("warnt vor der Uhrzeit und verlangt nach Annahme den Haken", () => {
    expect(
      verschiebenText({ titel: "Familie Can", tag: "2026-11-16", von: "07:30", annahmeAm: null }, ziel).text,
    ).toBe(
      "Bisher Mo 16.11. Kunde und Team sehen den neuen Tag sofort im Portal. Eine Nachricht an den Kunden geht erst raus, wenn du sie im nächsten Schritt schickst. Die Uhrzeit 07:30 gilt danach nicht mehr; bitte im Auftrag neu setzen.",
    );
    // 22:30 UTC am 02.10. ist in Berlin schon der 03.10.
    const mitAnnahme = verschiebenText(
      { titel: "Familie Can", tag: "2026-11-16", von: "07:30", annahmeAm: "2026-10-02T22:30:00.000Z" },
      ziel,
    );
    expect(mitAnnahme.text).toBe(
      "Bisher Mo 16.11. Kunde und Team sehen den neuen Tag sofort im Portal. Eine Nachricht an den Kunden geht erst raus, wenn du sie im nächsten Schritt schickst. Die Uhrzeit 07:30 gilt danach nicht mehr; bitte im Auftrag neu setzen. Der Kunde hat den Auftrag am 03.10. angenommen.",
    );
    expect(mitAnnahme.pflicht).toBe("Der Kunde ist mit dem neuen Tag einverstanden.");
    expect(mitAnnahme.knopf).toBe("Verschieben");
  });
});

describe("imBlickAus", () => {
  it("stellt Bestätigen vor künftige Einträge ohne Team und sortiert nach Tag und Titel", () => {
    const vogel = eintrag({
      id: "vogel",
      tag: "2026-11-15",
      titel: "Vogel",
      ton: "gold",
      fehlt: ["team"],
    });
    const baer = eintrag({
      id: "baer",
      tag: "2026-11-14",
      titel: "Bär",
      ton: "gold",
      fehlt: ["bestaetigen"],
    });
    const adler = eintrag({
      id: "adler",
      tag: "2026-11-14",
      titel: "Adler",
      ton: "gold",
      fehlt: ["bestaetigen", "team"],
    });
    const can = eintrag({
      id: "can",
      tag: "2026-11-14",
      titel: "Familie Can",
      ton: "gold",
      fehlt: ["bestaetigen"],
    });
    expect(imBlickAus([vogel, baer, can, adler], "2026-11-15")).toEqual([
      {
        key: "bestaetigen:adler",
        art: "bestaetigen",
        ton: "gold",
        fett: "Sa 14.11.",
        text: "Adler bestätigen",
        tag: "2026-11-14",
      },
      {
        key: "bestaetigen:baer",
        art: "bestaetigen",
        ton: "gold",
        fett: "Sa 14.11.",
        text: "Bär bestätigen",
        tag: "2026-11-14",
      },
      {
        key: "bestaetigen:can",
        art: "bestaetigen",
        ton: "gold",
        fett: "Sa 14.11.",
        text: "Familie Can bestätigen",
        tag: "2026-11-14",
      },
      {
        key: "ohne_team:vogel",
        art: "ohne_team",
        ton: "gold",
        fett: "So 15.11.",
        text: "Vogel ohne Team",
        tag: "2026-11-15",
      },
    ]);
  });

  it("lässt vergangenes fehlendes Team weg, künftige Gründe bleiben", () => {
    const nurTeam = eintrag({
      id: "nur",
      tag: "2026-11-04",
      titel: "Nur",
      ton: "gold",
      fehlt: ["team"],
    });
    const alt = eintrag({
      id: "alt",
      tag: "2026-11-04",
      titel: "Alt",
      ton: "gold",
      fehlt: ["bestaetigen", "team"],
    });
    expect(imBlickAus([nurTeam], HEUTE)).toEqual([]);
    expect(imBlickAus([alt], HEUTE).map((chip) => chip.key)).toEqual(["bestaetigen:alt"]);
  });

  it("kappt nach vier Datumschips, Einzahl und Mehrzahl", () => {
    const datiert = [1, 2, 3, 4, 5].map((n) =>
      eintrag({
        id: `b${n}`,
        tag: `2026-11-0${n}`,
        titel: `Name ${n}`,
        ton: "gold",
        fehlt: ["bestaetigen"],
      }),
    );
    const einer = imBlickAus(datiert, HEUTE);
    expect(einer.map((chip) => chip.fett)).toEqual(["So 01.11.", "Mo 02.11.", "Di 03.11.", "Mi 04.11.", "+1"]);
    expect(einer[4]).toMatchObject({ key: "weitere", text: "weiterer", tag: null, ton: "gold" });

    const sechs = imBlickAus(
      [
        ...datiert,
        eintrag({ id: "b0", tag: "2026-10-31", titel: "Name 0", ton: "gold", fehlt: ["bestaetigen"] }),
      ],
      HEUTE,
    );
    expect(sechs.at(-1)).toMatchObject({ key: "weitere", fett: "+2", text: "weitere", tag: null });
  });

  it("zählt nicht feste Termine ab heute, Einzahl und Mehrzahl, vergangene nicht", () => {
    const fest = eintrag({ id: "fest", tag: HEUTE, ton: "jade" });
    const offenHeute = eintrag({ id: "offen", tag: HEUTE, ton: "gestrichelt", titel: "Offen" });
    const offenSpaeter = eintrag({ id: "spaeter", tag: "2026-11-08", ton: "gestrichelt", titel: "Später" });
    const offenVorher = eintrag({ id: "vorher", tag: "2026-11-05", ton: "gestrichelt", titel: "Vorher" });

    expect(imBlickAus([fest, offenHeute, offenVorher], HEUTE)).toEqual([
      {
        key: "nicht_fest",
        art: "nicht_fest",
        ton: "grau",
        fett: "1",
        text: "Termin noch nicht fest",
        tag: null,
      },
    ]);
    expect(imBlickAus([offenHeute, offenSpaeter, offenVorher], HEUTE).at(-1)).toMatchObject({
      key: "nicht_fest",
      fett: "2",
      text: "Termine noch nicht fest",
      ton: "grau",
      tag: null,
    });
    expect(imBlickAus([fest, offenVorher], HEUTE)).toEqual([]);
  });

  it("setzt den Zählchip hinter die gekappten Datumschips", () => {
    const datiert = [1, 2, 3, 4, 5].map((n) =>
      eintrag({
        id: `b${n}`,
        tag: `2026-11-0${n}`,
        titel: `Name ${n}`,
        ton: "gold",
        fehlt: ["bestaetigen"],
      }),
    );
    const offen = eintrag({ id: "offen", tag: "2026-11-09", ton: "gestrichelt" });
    const chips = imBlickAus([...datiert, offen], HEUTE);
    expect(chips.map((chip) => chip.key)).toEqual([
      "bestaetigen:b1",
      "bestaetigen:b2",
      "bestaetigen:b3",
      "bestaetigen:b4",
      "weitere",
      "nicht_fest",
    ]);
  });
});

describe("eintraegeAm", () => {
  const lang = eintrag({ id: "lang", tag: "2026-11-02", bisTag: "2026-11-04", titel: "Lang" });
  const kurz = eintrag({ id: "kurz", tag: "2026-11-03", titel: "Kurz" });
  const vorher = eintrag({ id: "vorher", tag: "2026-11-01", titel: "Vorher" });
  const alle = [lang, kurz, vorher];

  it("zeigt mehrtägige Einträge an jedem Tag des Intervalls, Ränder inklusive", () => {
    expect(eintraegeAm(alle, "2026-11-02").map((e) => e.id)).toEqual(["lang"]);
    expect(eintraegeAm(alle, "2026-11-03").map((e) => e.id)).toEqual(["lang", "kurz"]);
    expect(eintraegeAm(alle, "2026-11-04").map((e) => e.id)).toEqual(["lang"]);
    expect(eintraegeAm(alle, "2026-11-01").map((e) => e.id)).toEqual(["vorher"]);
    expect(eintraegeAm(alle, "2026-11-05")).toEqual([]);
  });
});

describe("liveText", () => {
  const leer: PlanLive = { losAm: null, vorOrtAm: null, fertigAm: null };

  it("nimmt fertig vor Ort vor unterwegs und sonst nichts", () => {
    expect(liveText(null)).toBeNull();
    expect(liveText(leer)).toBeNull();
    expect(liveText({ ...leer, losAm: "2026-11-06T06:12:00.000Z" })).toBe("unterwegs seit 07:12");
    expect(
      liveText({ losAm: "2026-11-06T06:12:00.000Z", vorOrtAm: "2026-11-06T07:05:00.000Z", fertigAm: null }),
    ).toBe("vor Ort seit 08:05");
    expect(
      liveText({
        losAm: "2026-11-06T06:12:00.000Z",
        vorOrtAm: "2026-11-06T07:05:00.000Z",
        fertigAm: "2026-11-06T13:10:00.000Z",
      }),
    ).toBe("fertig 14:10");
  });
});

describe("heuteKopf", () => {
  it("nennt den Berliner Tag kurz nach Mitternacht UTC", () => {
    expect(heuteKopf(new Date("2026-11-06T00:30:00.000Z"))).toBe("Freitag, 6. November");
    expect(heuteKopf(new Date("2026-07-06T00:30:00.000Z"))).toBe("Montag, 6. Juli");
  });

  it("nimmt den Berliner Folgetag, wenn UTC noch auf dem Vortag steht", () => {
    // 23:30 UTC am 5.11. ist in Berlin schon der 6.11., 00:30.
    expect(heuteKopf(new Date("2026-11-05T23:30:00.000Z"))).toBe("Freitag, 6. November");
    // Im Sommer reicht 22:30 UTC für 00:30 in Berlin.
    expect(heuteKopf(new Date("2026-07-05T22:30:00.000Z"))).toBe("Montag, 6. Juli");
  });
});

describe("leadsChipLink", () => {
  it.each<{ key: LeadsChipKey }>([
    { key: "warten" },
    { key: "kv_ungesehen" },
    { key: "ohne_team" },
    { key: "rechnung_offen" },
    { key: "ohne_ab" },
    { key: "diese_woche" },
  ])("öffnet das Board nur mit Chip $key", ({ key }) => {
    expect(leadsChipLink(key)).toBe(`/app/leads?chip=${key}`);
  });
});
