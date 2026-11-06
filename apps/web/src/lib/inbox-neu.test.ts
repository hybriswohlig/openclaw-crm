import { describe, expect, it } from "vitest";
import {
  chipsZaehlen,
  eintraegeBauen,
  filtern,
  kuerzelAus,
  nummerKurz,
  sortieren,
  vorschauTeilen,
  wartedauer,
  zeitText,
  type InboxEintrag,
  type InboxFilter,
  type InboxZeile,
} from "./inbox-neu";

// Freitag, 06.11.2026, 12:00 in Berlin (UTC+1).
const JETZT = new Date("2026-11-06T11:00:00.000Z");
const vor = (minuten: number) => new Date(JETZT.getTime() - minuten * 60_000).toISOString();
const TAG = 24 * 60;

function zeile(teil: Partial<InboxZeile> & { gespraechId: string }): InboxZeile {
  return {
    dealId: null,
    kanal: "whatsapp",
    kleinanzeigen: false,
    personName: null,
    kontaktName: null,
    telefon: null,
    email: null,
    vorschau: "Hallo",
    zeit: vor(60),
    letzteNachricht: { richtung: "inbound", am: vor(60) },
    ungelesen: 0,
    lane: "lead",
    wartet: null,
    stufe: null,
    entwurf: null,
    firma: null,
    ...teil,
  };
}

const OFFEN = { id: "st_neu", label: "Neue Anfrage", kategorie: "open_new" };
const ANGEBOT = { id: "st_angebot", label: "Angebot", kategorie: "quoted" };
const VERLOREN = { id: "st_verloren", label: "Verloren", kategorie: "lost" };

const LEER: InboxFilter = { chip: null, kanal: null, firmaId: null, stufeId: null, nurWartet: false, suche: "" };

describe("zeitText", () => {
  it("heute Uhrzeit, gestern, Wochentag, sonst Datum (Berlin)", () => {
    expect(zeitText("2026-11-06T08:14:00.000Z", JETZT)).toBe("09:14");
    expect(zeitText("2026-11-05T22:30:00.000Z", JETZT)).toBe("gestern");
    expect(zeitText("2026-11-04T09:00:00.000Z", JETZT)).toBe("Mi");
    expect(zeitText("2026-11-03T09:00:00.000Z", JETZT)).toBe("Di");
    expect(zeitText("2026-10-31T09:00:00.000Z", JETZT)).toBe("Sa");
    expect(zeitText("2026-10-30T09:00:00.000Z", JETZT)).toBe("30.10.");
    expect(zeitText(null, JETZT)).toBe("");
  });

  it("Mitternacht in Berlin, nicht in UTC", () => {
    // 23:30 UTC am 05.11. ist 00:30 am 06.11. in Berlin: heute.
    expect(zeitText("2026-11-05T23:30:00.000Z", JETZT)).toBe("00:30");
  });
});

describe("kuerzelAus, nummerKurz, vorschauTeilen", () => {
  it("Kürzel aus Vor- und Nachname, „?“ ohne Namen", () => {
    expect(kuerzelAus("Familie Öztürk")).toBe("FÖ");
    expect(kuerzelAus("Dr. Kaiser")).toBe("DK");
    expect(kuerzelAus("")).toBe("?");
    expect(kuerzelAus(null)).toBe("?");
  });

  it("kürzt Nummern", () => {
    expect(nummerKurz("+491701234567")).toBe("+49 170 …");
    expect(nummerKurz("+43 660 1234567")).toBe("+43 660 …");
    expect(nummerKurz("01701234567")).toBe("0170 …");
  });

  it("„Du: “ wird Präfix, ausgehend ohne Präfix im Text auch, eingehende E-Mail „E-Mail:“", () => {
    expect(vorschauTeilen("Du: Anbei Ihr KV", "outbound", "email", false)).toEqual({
      vorschau: "Anbei Ihr KV",
      vorschauPraefix: "Du:",
    });
    expect(vorschauTeilen("Freitag 07:30", "outbound", "whatsapp", false)).toEqual({
      vorschau: "Freitag 07:30",
      vorschauPraefix: "Du:",
    });
    expect(vorschauTeilen("Anfrage Entrümpelung", "inbound", "email", false).vorschauPraefix).toBe("E-Mail:");
    expect(vorschauTeilen("Ist das noch da?", "inbound", "email", true).vorschauPraefix).toBeNull();
    expect(vorschauTeilen("Hallo", "inbound", "whatsapp", false).vorschauPraefix).toBeNull();
    expect(vorschauTeilen(null, null, "sms", false)).toEqual({ vorschau: "", vorschauPraefix: null });
  });
});

describe("eintraegeBauen", () => {
  it("Deal mit WhatsApp und E-Mail wird ein Eintrag: Kanal, Vorschau und Zeit vom neuesten, Ungelesen summiert", () => {
    const [e, ...rest] = eintraegeBauen(
      [
        zeile({ gespraechId: "c_mail", dealId: "d1", kanal: "email", zeit: vor(30), vorschau: "Du: Anbei der KV", letzteNachricht: { richtung: "outbound", am: vor(30) }, ungelesen: 1, personName: "Familie Weber", stufe: ANGEBOT }),
        zeile({ gespraechId: "c_wa", dealId: "d1", zeit: vor(90), ungelesen: 2, personName: "Familie Weber", stufe: ANGEBOT }),
      ],
      JETZT,
    );
    expect(rest).toHaveLength(0);
    expect(e).toMatchObject({
      key: "deal:d1",
      dealId: "d1",
      gespraechIds: ["c_mail", "c_wa"],
      name: "Familie Weber",
      kuerzel: "FW",
      kanal: "email",
      kanaele: ["email", "whatsapp"],
      vorschau: "Anbei der KV",
      vorschauPraefix: "Du:",
      zeit: vor(30),
      zeitText: "11:30",
      ungelesen: 3,
      stufe: { id: "st_angebot", label: "Angebot", ton: "gold" },
      gruppe: "haupt",
      laneText: null,
    });
  });

  it("Gespräche ohne Deal bleiben einzeln", () => {
    const e = eintraegeBauen([zeile({ gespraechId: "c1" }), zeile({ gespraechId: "c2" })], JETZT);
    expect(e.map((x) => x.key)).toEqual(["gespraech:c1", "gespraech:c2"]);
    expect(e[0].stufe).toBeNull();
    expect(e[0].kiEntwurf).toBeNull();
  });

  it("Name: Person vor Kontaktname vor gekürzter Nummer; Kürzel „?“ bei unbekannt", () => {
    const [a, b, c, d] = eintraegeBauen(
      [
        zeile({ gespraechId: "a", personName: "Ralf Fischer", kontaktName: "Ralle" }),
        zeile({ gespraechId: "b", kontaktName: "M. Lehmann" }),
        zeile({ gespraechId: "c", kontaktName: "+49 170 1234567", telefon: "+491701234567" }),
        zeile({ gespraechId: "d", email: "x@example.org" }),
      ],
      JETZT,
    );
    expect([a.name, a.kuerzel]).toEqual(["Ralf Fischer", "RF"]);
    expect([b.name, b.kuerzel]).toEqual(["M. Lehmann", "ML"]);
    expect([c.name, c.kuerzel]).toEqual(["+49 170 …", "?"]);
    expect([d.name, d.kuerzel]).toEqual(["x@example.org", "?"]);
  });

  it("Kleinanzeigen zählt als eigener Kanal im Filter, Kanal bleibt E-Mail", () => {
    const [e] = eintraegeBauen([zeile({ gespraechId: "k", kanal: "email", kleinanzeigen: true })], JETZT);
    expect(e.kanal).toBe("email");
    expect(e.kanaele).toEqual(["kleinanzeigen"]);
    expect(e.kleinanzeigen).toBe(true);
  });

  it("Info-Gruppe nur, wenn alle Gespräche Info oder Kein Lead sind; Lane-Text vom neuesten", () => {
    const [info, keinLead, gemischt] = eintraegeBauen(
      [
        zeile({ gespraechId: "i", lane: "info" }),
        zeile({ gespraechId: "k", dealId: "d2", lane: "kein_lead", stufe: OFFEN }),
        zeile({ gespraechId: "m1", dealId: "d3", lane: "info", zeit: vor(10), stufe: OFFEN }),
        zeile({ gespraechId: "m2", dealId: "d3", lane: "lead", zeit: vor(20), stufe: OFFEN }),
      ],
      JETZT,
    );
    expect([info.gruppe, info.laneText]).toEqual(["info", "Info"]);
    expect([keinLead.gruppe, keinLead.laneText]).toEqual(["info", "Kein Lead"]);
    expect([gemischt.gruppe, gemischt.laneText]).toEqual(["haupt", null]);
  });

  describe("Wartet-Pille", () => {
    const deal = (wartet: InboxZeile["wartet"], stufe = OFFEN, lane = "lead") =>
      eintraegeBauen([zeile({ gespraechId: "c", dealId: "d", wartet, stufe, lane })], JETZT)[0].wartet;

    it("uns, Kunde, KV ungesehen, läuft", () => {
      expect(deal({ auf: "uns", seit: vor(35), grund: "Kunde wartet auf Antwort" })).toEqual({
        auf: "uns",
        seit: vor(35),
        text: "wartet auf uns · 35 Min",
      });
      expect(deal({ auf: "kunde", seit: vor(2 * TAG), grund: "Wartet auf Kunden" }).text).toBe(
        "wartet auf Kunden · 2 Tage",
      );
      expect(deal({ auf: "kunde", seit: vor(4 * TAG), grund: "KV seit 4 Tagen ungesehen" }, ANGEBOT).text).toBe(
        "KV ungesehen · 4 Tage",
      );
      // so meldet berechneWartet einen KV, der über 3 Tage ungesehen ist: „uns“, sortiert oben
      expect(deal({ auf: "uns", seit: vor(4 * TAG), grund: "KV seit 4 Tagen ungesehen" }, ANGEBOT)).toEqual({
        auf: "uns",
        seit: vor(4 * TAG),
        text: "KV ungesehen · 4 Tage",
      });
      expect(deal({ auf: "niemand", seit: null, grund: null })).toEqual({ auf: "niemand", seit: null, text: "läuft" });
      expect(deal(null).text).toBe("läuft");
      expect(deal({ auf: "uns", seit: null, grund: null }).text).toBe("wartet auf uns");
    });

    it("Endstufe ohne Pille, auch wenn der Zustand noch „uns“ sagt", () => {
      expect(deal({ auf: "uns", seit: vor(60), grund: "x" }, VERLOREN)).toEqual({ auf: "niemand", seit: null, text: null });
    });

    it("Info-Gruppe wartet nie auf uns", () => {
      expect(deal({ auf: "uns", seit: vor(60), grund: "x" }, OFFEN, "info").auf).toBe("niemand");
      const [ohneDeal] = eintraegeBauen([zeile({ gespraechId: "i", lane: "info" })], JETZT);
      expect(ohneDeal.wartet.auf).toBe("niemand");
    });

    it("ohne Deal: uns seit der letzten eingehenden Nachricht, sonst keine Pille", () => {
      const [ein, aus] = eintraegeBauen(
        [
          zeile({ gespraechId: "a", letzteNachricht: { richtung: "inbound", am: vor(180) } }),
          zeile({ gespraechId: "b", letzteNachricht: { richtung: "outbound", am: vor(5) } }),
        ],
        JETZT,
      );
      expect(ein.wartet).toEqual({ auf: "uns", seit: vor(180), text: "wartet auf uns · 3 Std" });
      expect(aus.wartet).toEqual({ auf: "niemand", seit: null, text: null });
    });
  });

  it("KI-Entwurf: neuester des Eintrags, Nachfass als Zusatz; nie ohne Deal", () => {
    const [d, ohne] = eintraegeBauen(
      [
        zeile({ gespraechId: "a", dealId: "d", stufe: OFFEN, entwurf: { nachfass: false, am: vor(100) } }),
        zeile({ gespraechId: "b", dealId: "d", stufe: OFFEN, entwurf: { nachfass: true, am: vor(10) } }),
        zeile({ gespraechId: "c", entwurf: { nachfass: false, am: vor(10) } }),
      ],
      JETZT,
    );
    expect(d.kiEntwurf).toEqual({ text: "KI-Entwurf · Nachfass" });
    expect(ohne.kiEntwurf).toBeNull();
  });
});

function eintrag(teil: Partial<InboxEintrag> & { key: string }): InboxEintrag {
  return {
    dealId: null,
    gespraechIds: [],
    name: "X",
    kuerzel: "X",
    kanal: "whatsapp",
    kanaele: ["whatsapp"],
    kleinanzeigen: false,
    vorschau: "",
    vorschauPraefix: null,
    zeit: null,
    zeitText: "",
    ungelesen: 0,
    wartet: { auf: "niemand", seit: null, text: null },
    kiEntwurf: null,
    stufe: null,
    gruppe: "haupt",
    laneText: null,
    firma: null,
    ...teil,
  };
}

const uns = (seit: string | null) => ({ auf: "uns" as const, seit, text: "wartet auf uns" });

describe("sortieren", () => {
  it("wartet auf uns zuerst (längste Wartezeit oben), dann Zeit absteigend, Info-Gruppe unten", () => {
    const liste = [
      eintrag({ key: "neu", zeit: vor(1) }),
      eintrag({ key: "info", gruppe: "info", zeit: vor(0) }),
      eintrag({ key: "uns35", wartet: uns(vor(35)), zeit: vor(35) }),
      eintrag({ key: "ohneZeit", zeit: null }),
      eintrag({ key: "uns2Tage", wartet: uns(vor(2 * TAG)), zeit: vor(2 * TAG) }),
      eintrag({ key: "unsOhneSeit", wartet: uns(null), zeit: vor(3) }),
      eintrag({ key: "alt", zeit: vor(5 * TAG) }),
      eintrag({ key: "infoAlt", gruppe: "info", zeit: vor(TAG) }),
    ];
    expect(sortieren(liste).map((e) => e.key)).toEqual([
      "uns2Tage",
      "uns35",
      "unsOhneSeit",
      "neu",
      "alt",
      "ohneZeit",
      "info",
      "infoAlt",
    ]);
    expect(liste[0].key).toBe("neu");
  });
});

describe("chipsZaehlen und filtern", () => {
  const liste = [
    eintrag({ key: "a", ungelesen: 2, wartet: uns(vor(10)), firma: { id: "f_k", name: "Kottke" }, stufe: { id: "s1", label: "Neue Anfrage", ton: "blau" } }),
    eintrag({ key: "b", kiEntwurf: { text: "KI-Entwurf" }, kanal: "email", kanaele: ["email", "whatsapp"], firma: { id: "f_c", name: "Ceylan" }, stufe: { id: "s2", label: "Angebot", ton: "gold" } }),
    eintrag({ key: "c", kanal: "email", kanaele: ["kleinanzeigen"], kleinanzeigen: true, ungelesen: 1 }),
    eintrag({ key: "i", gruppe: "info", ungelesen: 4, kanal: "sms", kanaele: ["sms"] }),
  ];

  it("Zähler: ungelesen nur Hauptgruppe, Einträge statt Nachrichten", () => {
    expect(chipsZaehlen(liste)).toEqual({ ungelesen: 2, wartenAufUns: 1, kiEntwuerfe: 1, infoKeinLead: 1 });
  });

  it("Chip als Filter", () => {
    const keys = (f: Partial<InboxFilter>) => filtern(liste, { ...LEER, ...f }).map((e) => e.key);
    expect(keys({})).toEqual(["a", "b", "c", "i"]);
    expect(keys({ chip: "ungelesen" })).toEqual(["a", "c"]);
    expect(keys({ chip: "warten" })).toEqual(["a"]);
    expect(keys({ chip: "ki" })).toEqual(["b"]);
    expect(keys({ chip: "info" })).toEqual(["i"]);
  });

  it("Kanal über alle Kanäle des Eintrags, Kleinanzeigen getrennt", () => {
    const keys = (kanal: InboxFilter["kanal"]) => filtern(liste, { ...LEER, kanal }).map((e) => e.key);
    expect(keys("whatsapp")).toEqual(["a", "b"]);
    expect(keys("email")).toEqual(["b"]);
    expect(keys("kleinanzeigen")).toEqual(["c"]);
    expect(keys("sms")).toEqual(["i"]);
  });

  it("Firma, Stufe, nur wartet auf uns", () => {
    expect(filtern(liste, { ...LEER, firmaId: "f_c" }).map((e) => e.key)).toEqual(["b"]);
    expect(filtern(liste, { ...LEER, stufeId: "s1" }).map((e) => e.key)).toEqual(["a"]);
    expect(filtern(liste, { ...LEER, nurWartet: true }).map((e) => e.key)).toEqual(["a"]);
    expect(filtern(liste, { ...LEER, chip: "ki", kanal: "whatsapp" }).map((e) => e.key)).toEqual(["b"]);
  });

  it("Suche ab 2 Zeichen hebt den Chip auf, andere Filter bleiben", () => {
    expect(filtern(liste, { ...LEER, chip: "info", suche: "we" }).map((e) => e.key)).toEqual(["a", "b", "c", "i"]);
    expect(filtern(liste, { ...LEER, chip: "info", suche: "w" }).map((e) => e.key)).toEqual(["i"]);
    expect(filtern(liste, { ...LEER, chip: "info", suche: "we", kanal: "email" }).map((e) => e.key)).toEqual(["b"]);
  });
});

describe("wartedauer (Vertrag)", () => {
  it("Minuten, Stunden, Tage", () => {
    expect(wartedauer(vor(35), JETZT)).toBe("35 Min");
    expect(wartedauer(vor(TAG), JETZT)).toBe("1 Tag");
  });
});
