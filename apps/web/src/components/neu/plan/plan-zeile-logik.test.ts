import { describe, expect, it } from "vitest";
import type { PlanEintrag } from "@/lib/plan-heute";
import { TON_TEXT, bisText, livePille, liveStufe, teamLuecke, teamText, teamZeigen, zeileLabel, zeitRest, zeitSpalte } from "./plan-zeile-logik";

function eintrag(teil: Partial<PlanEintrag> = {}): PlanEintrag {
  return {
    id: "move:d1",
    dealId: "d1",
    art: "umzug",
    label: "Umzug",
    tag: "2026-11-06",
    bisTag: "2026-11-06",
    von: "07:30",
    bis: "13:00",
    zeitText: "07:30 Beladen · ca. 13:00 fertig",
    ton: "jade",
    fehlt: [],
    titel: "Familie Can",
    zeile: "Umzug · 2.950 € · Stuttgart-Süd → Esslingen",
    betragText: "2.950 €",
    strecke: "Stuttgart-Süd → Esslingen",
    team: [
      { kuerzel: "MK", name: "Mehmet K." },
      { kuerzel: "TS", name: "Tobias S." },
    ],
    teamFehlt: false,
    transporter: "Mercedes Sprinter lang",
    firma: { id: "f1", name: "Kottke", farbe: "#222224" },
    stufe: { id: "s1", label: "Geplant", kategorie: "booked" },
    datumQuelle: "feld",
    ziehbar: true,
    annahmeAm: null,
    href: "/app/leads/d1",
    ...teil,
  };
}

describe("zeitSpalte und zeitRest", () => {
  it("Beginn links, der Rest des Zeittexts ohne die Uhrzeit", () => {
    const e = eintrag();
    expect(zeitSpalte(e)).toBe("07:30");
    expect(zeitRest(e)).toBe("Beladen · ca. 13:00 fertig");
  });

  it("nur Uhrzeit: kein Rest", () => {
    expect(zeitRest(eintrag({ von: "16:00", zeitText: "16:00" }))).toBeNull();
  });

  it("ganztägig ohne Zeittext", () => {
    const e = eintrag({ von: null, bis: null, zeitText: null });
    expect(zeitSpalte(e)).toBe("ganztägig");
    expect(zeitRest(e)).toBeNull();
  });

  it("Zeittext, der nicht mit der Uhrzeit beginnt, bleibt ganz", () => {
    expect(zeitRest(eintrag({ von: null, zeitText: "ca. 13:00 fertig" }))).toBe("ca. 13:00 fertig");
  });
});

describe("bisText", () => {
  it("nur bei mehrtägigen Einträgen", () => {
    expect(bisText(eintrag())).toBeNull();
    expect(bisText(eintrag({ bisTag: "2026-11-07" }))).toBe("bis Sa 07.11.");
  });
});

describe("Team", () => {
  it("zeigt Team nur bei Umzügen mit Team oder Lücke", () => {
    expect(teamZeigen(eintrag())).toBe(true);
    expect(teamZeigen(eintrag({ team: [], teamFehlt: true, ton: "gold" }))).toBe(true);
    expect(teamZeigen(eintrag({ team: [], teamFehlt: false }))).toBe(false);
    expect(teamZeigen(eintrag({ art: "besichtigung" }))).toBe(false);
  });

  it("Lücke („?“) nur bei festen Umzügen, nicht bei Angebot oder erledigt", () => {
    expect(teamLuecke(eintrag({ teamFehlt: true, ton: "gold" }))).toBe(true);
    expect(teamLuecke(eintrag({ teamFehlt: true, ton: "jade" }))).toBe(true);
    expect(teamLuecke(eintrag({ teamFehlt: true, ton: "gestrichelt" }))).toBe(false);
    expect(teamLuecke(eintrag({ teamFehlt: true, ton: "grau" }))).toBe(false);
    expect(teamZeigen(eintrag({ team: [], teamFehlt: true, ton: "gestrichelt" }))).toBe(false);
    expect(teamText(eintrag({ teamFehlt: true, ton: "gestrichelt" }))).toBe("Team: Mehmet K., Tobias S.");
  });

  it("Text mit Namen, Lücke und ohne Team", () => {
    expect(teamText(eintrag())).toBe("Team: Mehmet K., Tobias S.");
    expect(teamText(eintrag({ teamFehlt: true, ton: "gold" }))).toBe("Team: Mehmet K., Tobias S., unvollständig");
    expect(teamText(eintrag({ team: [], teamFehlt: true, ton: "gold" }))).toBe("Team fehlt");
    expect(teamText(eintrag({ team: [], teamFehlt: false }))).toBe("Kein Team");
  });
});

describe("Live-Stand", () => {
  const los = "2026-11-06T06:12:00.000Z";
  const vorOrt = "2026-11-06T07:05:00.000Z";
  const fertig = "2026-11-06T13:10:00.000Z";

  it("Stufe nach dem spätesten Klick", () => {
    expect(liveStufe(null)).toBeNull();
    expect(liveStufe({ losAm: null, vorOrtAm: null, fertigAm: null })).toBeNull();
    expect(liveStufe({ losAm: los, vorOrtAm: null, fertigAm: null })).toBe("unterwegs");
    expect(liveStufe({ losAm: los, vorOrtAm: vorOrt, fertigAm: null })).toBe("vor_ort");
    expect(liveStufe({ losAm: los, vorOrtAm: vorOrt, fertigAm: fertig })).toBe("fertig");
  });

  it("Pille mit Berliner Uhrzeit (UTC-Zeitpunkt, Winterzeit)", () => {
    expect(livePille({ losAm: los, vorOrtAm: null, fertigAm: null })).toEqual({ stufe: "unterwegs", text: "unterwegs seit 07:12" });
    expect(livePille({ losAm: los, vorOrtAm: vorOrt, fertigAm: fertig })).toEqual({ stufe: "fertig", text: "fertig 14:10" });
    expect(livePille(undefined)).toBeNull();
  });
});

describe("zeileLabel", () => {
  it("nennt Titel, Bedeutung der Farbe, Uhrzeit und Live-Stand", () => {
    expect(zeileLabel(eintrag(), { losAm: "2026-11-06T06:12:00.000Z", vorOrtAm: null, fertigAm: null })).toBe(
      "Familie Can, fest, Team steht, 07:30, unterwegs seit 07:12"
    );
    expect(zeileLabel(eintrag({ ton: "gestrichelt", titel: "Weber?", von: null }))).toBe("Weber?, noch nicht fest, ganztägig");
  });

  it("jeder Ton hat einen Text", () => {
    expect(Object.keys(TON_TEXT).sort()).toEqual(["gestrichelt", "gold", "grau", "jade", "violett"]);
  });
});
