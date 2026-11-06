import { describe, expect, it } from "vitest";
import {
  anrufAntwortAus,
  anrufDauerText,
  anruferText,
  hatTranskript,
  leitungen,
  nachTagen,
  tagTitel,
  telefonAnzeige,
  zuordnungText,
} from "./anrufe";

const JETZT = new Date("2026-11-06T10:00:00.000Z");

describe("anrufAntwortAus", () => {
  it("bildet die Zeile auf die Antwort beider Routen ab, Zeit als ISO, Stichworte nie null", () => {
    expect(
      anrufAntwortAus({
        id: "c1",
        callerE164: "+4915500000201",
        callerRaw: "01550 0000201",
        calledE164: null,
        lineLabel: "Festnetz",
        answeredBy: "Dario",
        startedAt: new Date("2026-11-05T09:14:00.000Z"),
        durationSeconds: 240,
        summary: "Umzug",
        transcript: "Text",
        keywords: null,
        personRecordId: null,
        dealRecordId: "d1",
        matchStatus: "matched",
      })
    ).toEqual({
      id: "c1",
      callerE164: "+4915500000201",
      callerRaw: "01550 0000201",
      calledE164: null,
      lineLabel: "Festnetz",
      answeredBy: "Dario",
      startedAt: "2026-11-05T09:14:00.000Z",
      durationSeconds: 240,
      summary: "Umzug",
      transcript: "Text",
      keywords: [],
      personRecordId: null,
      personName: null,
      dealRecordId: "d1",
      matchStatus: "matched",
    });
  });

  it("Personenname nur mit angehängter Person", () => {
    const zeile = {
      id: "c1",
      callerE164: null,
      callerRaw: null,
      calledE164: null,
      lineLabel: null,
      answeredBy: null,
      startedAt: new Date("2026-11-05T09:14:00.000Z"),
      durationSeconds: null,
      summary: null,
      transcript: null,
      keywords: [],
      personRecordId: "p1",
      dealRecordId: null,
      matchStatus: "matched",
    };
    expect(anrufAntwortAus(zeile, "Familie Weber").personName).toBe("Familie Weber");
    expect(anrufAntwortAus({ ...zeile, personRecordId: null }, "Familie Weber").personName).toBeNull();
    expect(anrufAntwortAus(zeile).personName).toBeNull();
  });
});

describe("hatTranskript", () => {
  it("nur bei Text, nicht bei leer oder Leerraum", () => {
    expect(hatTranskript("Kunde: Hallo")).toBe(true);
    expect(hatTranskript("")).toBe(false);
    expect(hatTranskript("   \n")).toBe(false);
    expect(hatTranskript(null)).toBe(false);
    expect(hatTranskript(undefined)).toBe(false);
  });
});

describe("telefonAnzeige", () => {
  it("deutsche Mobilnummer national mit Lücke nach der Vorwahl", () => {
    expect(telefonAnzeige("+4915500000201")).toBe("01550 0000201");
    expect(telefonAnzeige("+491711234567")).toBe("01711 234567");
  });

  it("deutsches Festnetz national ohne Lücke, Ausland bleibt E.164, roher Text bleibt", () => {
    expect(telefonAnzeige("+497111234")).toBe("07111234");
    expect(telefonAnzeige("+41441234567")).toBe("+41441234567");
    expect(telefonAnzeige("anonym")).toBe("anonym");
    expect(telefonAnzeige("  ")).toBeNull();
    expect(telefonAnzeige(null)).toBeNull();
  });
});

describe("anruferText", () => {
  it("Name vor Nummer vor rohem Text vor „Ohne Nummer“", () => {
    expect(anruferText({ name: "Familie Weber", callerE164: "+4915500000201", callerRaw: null })).toBe("Familie Weber");
    expect(anruferText({ name: " ", callerE164: "+4915500000201", callerRaw: null })).toBe("01550 0000201");
    expect(anruferText({ callerE164: null, callerRaw: "unterdrückt" })).toBe("unterdrückt");
    expect(anruferText({ callerE164: null, callerRaw: null })).toBe("Ohne Nummer");
  });
});

describe("anrufDauerText", () => {
  it("rundet auf Minuten, mindestens 1 Min, ohne Dauer null", () => {
    expect(anrufDauerText(240)).toBe("4 Min");
    expect(anrufDauerText(20)).toBe("1 Min");
    expect(anrufDauerText(150)).toBe("3 Min");
    expect(anrufDauerText(0)).toBeNull();
    expect(anrufDauerText(null)).toBeNull();
    expect(anrufDauerText(undefined)).toBeNull();
  });
});

describe("zuordnungText", () => {
  it("mit Lead nichts, sonst je nach Lage", () => {
    expect(zuordnungText({ matchStatus: "matched", dealRecordId: "d1", personRecordId: "p1" })).toBeNull();
    expect(zuordnungText({ matchStatus: "matched", dealRecordId: null, personRecordId: "p1" })).toBe("Kunde bekannt, kein Lead");
    expect(zuordnungText({ matchStatus: "ambiguous", dealRecordId: null, personRecordId: null })).toBe("Mehrere Kunden mit dieser Nummer");
    expect(zuordnungText({ matchStatus: "unmatched", dealRecordId: null, personRecordId: null })).toBe("Noch keinem Lead zugeordnet");
    expect(zuordnungText({ matchStatus: "no_number", dealRecordId: null, personRecordId: null })).toBe("Noch keinem Lead zugeordnet");
  });
});

describe("tagTitel und nachTagen", () => {
  it("Heute, Gestern, sonst Wochentag und Datum (Berliner Tag)", () => {
    expect(tagTitel("2026-11-06", JETZT)).toBe("Heute");
    expect(tagTitel("2026-11-05", JETZT)).toBe("Gestern");
    expect(tagTitel("2026-11-03", JETZT)).toBe("Di 03.11.");
  });

  it("gruppiert in der gelieferten Reihenfolge nach Berliner Kalendertag", () => {
    const a = (id: string, startedAt: string) => ({ id, startedAt });
    const gruppen = nachTagen(
      [
        a("1", "2026-11-06T08:00:00.000Z"),
        // 23:30 UTC am 05.11. ist in Berlin schon der 06.11.
        a("2", "2026-11-05T23:30:00.000Z"),
        a("3", "2026-11-05T10:00:00.000Z"),
        a("4", "2026-11-03T10:00:00.000Z"),
      ],
      JETZT
    );
    expect(gruppen.map((g) => [g.tag, g.titel, g.anrufe.map((x) => x.id)])).toEqual([
      ["2026-11-06", "Heute", ["1", "2"]],
      ["2026-11-05", "Gestern", ["3"]],
      ["2026-11-03", "Di 03.11.", ["4"]],
    ]);
    expect(nachTagen([], JETZT)).toEqual([]);
  });
});

describe("leitungen", () => {
  it("jede Leitung einmal in Reihenfolge des ersten Auftretens, leere fallen weg", () => {
    expect(
      leitungen([
        { lineLabel: "Festnetz" },
        { lineLabel: "Kottke Mobil" },
        { lineLabel: null },
        { lineLabel: " " },
        { lineLabel: "Festnetz" },
        { lineLabel: "Ceylan" },
      ])
    ).toEqual(["Festnetz", "Kottke Mobil", "Ceylan"]);
  });
});
