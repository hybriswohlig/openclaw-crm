import { describe, expect, it } from "vitest";
import { HEUTE_LISTE_MAX, planZustandAusParams, type HeuteAntwort, type PlanEintrag } from "@/lib/plan-heute";
import {
  INBOX_JETZT,
  INBOX_LINK,
  LAGEKARTE_LINK,
  LEER_BEIDE,
  freigabenGesamt,
  gekappt,
  handyUnterzeile,
  inboxChipText,
  inboxZahl,
  ladeFehlerFolge,
  meldungenGesamt,
  morgenTag,
  naechsterText,
  panelUnter,
  planTagLink,
  termineAnsicht,
  weitereText,
} from "./heute-logik";

function eintrag(teil: Partial<PlanEintrag> = {}): PlanEintrag {
  return {
    id: "move:d1",
    dealId: "d1",
    art: "umzug",
    label: "Umzug",
    tag: "2026-11-14",
    bisTag: "2026-11-14",
    von: null,
    bis: null,
    zeitText: null,
    ton: "jade",
    fehlt: [],
    titel: "Familie Can",
    zeile: "Umzug · 2.950 €",
    betragText: "2.950 €",
    strecke: null,
    team: [],
    teamFehlt: false,
    transporter: null,
    firma: null,
    stufe: { id: "s1", label: "Geplant", kategorie: "booked" },
    datumQuelle: "feld",
    ziehbar: true,
    annahmeAm: null,
    href: "/app/leads/d1",
    ...teil,
  };
}

function antwort(teil: Partial<HeuteAntwort> = {}): HeuteAntwort {
  return {
    tag: "2026-11-06",
    chips: { warten: 4, kv_ungesehen: 1, ohne_team: 1, rechnung_offen: 2, diese_woche: 3 },
    inbox: { ungelesen: 7, wartenAufUns: 4, kiEntwuerfe: 3, infoKeinLead: 3 },
    inboxAbgeschnitten: false,
    heute: [],
    morgen: [],
    naechster: null,
    meldungen: [],
    meldungenGesamt: 0,
    freigaben: [],
    stand: "2026-11-06T09:00:00.000Z",
    ...teil,
  };
}

describe("Termine: Leertexte und nächster Termin", () => {
  it("beide leer: gemeinsamer Hinweis, mit nächstem Termin", () => {
    expect(termineAnsicht(antwort({ naechster: eintrag() }))).toEqual({
      art: "leer",
      text: LEER_BEIDE,
      naechster: "Nächster Termin: Sa 14.11. · Familie Can",
    });
    expect(LEER_BEIDE).toBe("Heute und morgen keine Umzüge und Besichtigungen.");
  });

  it("beide leer ohne Termin in 14 Tagen: kein Satz zum nächsten", () => {
    expect(termineAnsicht(antwort())).toEqual({ art: "leer", text: LEER_BEIDE, naechster: null });
  });

  it("nur einer leer: beide Panels", () => {
    expect(termineAnsicht(antwort({ morgen: [eintrag()] }))).toEqual({ art: "panels" });
    expect(termineAnsicht(antwort({ heute: [{ ...eintrag(), live: null }] }))).toEqual({ art: "panels" });
  });

  it("nächster Termin mit Wochentag und Titel", () => {
    expect(naechsterText({ tag: "2026-11-13", titel: "Familie Can" })).toBe("Nächster Termin: Fr 13.11. · Familie Can");
  });

  it("Panel-Unterzeile mit Einzahl und Mehrzahl", () => {
    expect(panelUnter("2026-11-06", 0)).toBe("Fr 06.11.");
    expect(panelUnter("2026-11-06", 1)).toBe("Fr 06.11. · 1 Termin");
    expect(panelUnter("2026-11-06", 3)).toBe("Fr 06.11. · 3 Termine");
  });

  it("morgen über Monats- und Jahresgrenze", () => {
    expect(morgenTag({ tag: "2026-11-30" })).toBe("2026-12-01");
    expect(morgenTag({ tag: "2026-12-31" })).toBe("2027-01-01");
    expect(morgenTag({ tag: "2026-10-25" })).toBe("2026-10-26");
  });
});

describe("Listen: „und N weitere“", () => {
  it("nur, wenn mehr da ist als gezeigt", () => {
    expect(weitereText(5, 5)).toBeNull();
    expect(weitereText(3, 3)).toBeNull();
    expect(weitereText(8, 5)).toBe("und 3 weitere");
    expect(weitereText(6, 5)).toBe("und 1 weitere");
  });

  it("kappt auf HEUTE_LISTE_MAX", () => {
    expect(gekappt([1, 2, 3, 4, 5, 6, 7])).toHaveLength(HEUTE_LISTE_MAX);
    expect(gekappt([1, 2])).toEqual([1, 2]);
  });

  it("Meldungen: Gesamtzahl vom Server, nie kleiner als die Liste", () => {
    const m = { dealId: "d", name: "N", text: "Kunde meldet bezahlt · 500 €", href: "/app/leads/d" };
    expect(meldungenGesamt(antwort({ meldungen: [m, m, m, m, m], meldungenGesamt: 8 }))).toBe(8);
    expect(meldungenGesamt(antwort({ meldungen: [m], meldungenGesamt: 0 }))).toBe(1);
  });

  it("Freigaben: Gesamtzahl gleich dem Inbox-Chip „KI-Entwürfe“", () => {
    const f = { key: "deal:d", name: "N", text: "KI-Entwurf", href: "/app/inbox?e=deal%3Ad" };
    const a = antwort({ freigaben: [f, f, f, f, f], inbox: { ungelesen: 0, wartenAufUns: 0, kiEntwuerfe: 9, infoKeinLead: 0 } });
    expect(freigabenGesamt(a)).toBe(9);
    expect(weitereText(freigabenGesamt(a), 5)).toBe("und 4 weitere");
  });
});

describe("Inbox „Jetzt“", () => {
  it("Reihenfolge und Töne wie die Inbox, ohne „Anruf verpasst“", () => {
    expect(INBOX_JETZT.map((c) => [c.key, c.ton])).toEqual([
      ["ungelesen", "blau"],
      ["wartenAufUns", "gold"],
      ["kiEntwuerfe", "blau"],
      ["infoKeinLead", "grau"],
    ]);
  });

  it("Texte mit Einzahl", () => {
    expect(inboxChipText("wartenAufUns", 1)).toBe("wartet auf uns");
    expect(inboxChipText("wartenAufUns", 4)).toBe("warten auf uns");
    expect(inboxChipText("kiEntwuerfe", 1)).toBe("KI-Entwurf zur Freigabe");
    expect(inboxChipText("kiEntwuerfe", 0)).toBe("KI-Entwürfe zur Freigabe");
    expect(inboxChipText("ungelesen", 7)).toBe("ungelesen");
    expect(inboxChipText("infoKeinLead", 3)).toBe("Info / Kein Lead");
  });

  it("abgeschnitten: Zahl als Untergrenze", () => {
    expect(inboxZahl(7, false)).toBe("7");
    expect(inboxZahl(7, true)).toBe("7+");
    expect(inboxZahl(0, true)).toBe("0");
  });
});

describe("Link-Ziele", () => {
  it("Plan in der Tagesansicht am Tag, rund über planZustandAusParams", () => {
    const link = planTagLink("2026-11-06");
    expect(link).toBe("/app/plan?ansicht=tag&tag=2026-11-06");
    const p = new URLSearchParams(link.split("?")[1]);
    expect(planZustandAusParams(p, "2026-01-01", { modus: "monat" })).toEqual({
      modus: "tag",
      anker: "2026-11-06",
      firmaId: null,
      mitarbeiterId: null,
    });
  });

  it("Inbox und Lagekarte", () => {
    expect(INBOX_LINK).toBe("/app/inbox");
    expect(LAGEKARTE_LINK).toBe("/app/heute/karte");
  });
});

describe("Unterzeile am Handy", () => {
  it("Tag und Zahl der Termine heute", () => {
    expect(handyUnterzeile("Freitag, 6. November", 3)).toBe("Freitag, 6. November · 3 Termine heute");
    expect(handyUnterzeile("Freitag, 6. November", 1)).toBe("Freitag, 6. November · 1 Termin heute");
    expect(handyUnterzeile("Freitag, 6. November", 0)).toBe("Freitag, 6. November · keine Termine heute");
    expect(handyUnterzeile("Freitag, 6. November", null)).toBe("Freitag, 6. November");
  });
});

describe("Ladefehler", () => {
  it("ohne Daten Fehlansicht, mit Daten still im Takt, sonst Meldung", () => {
    expect(ladeFehlerFolge(false, "oeffnen")).toBe("fehler");
    expect(ladeFehlerFolge(false, "takt")).toBe("fehler");
    expect(ladeFehlerFolge(true, "takt")).toBe("still");
    expect(ladeFehlerFolge(true, "erneut")).toBe("toast");
    expect(ladeFehlerFolge(true, "oeffnen")).toBe("toast");
  });
});

describe("keine Gedankenstriche", () => {
  it("in allen festen Texten", () => {
    const texte = [LEER_BEIDE, ...INBOX_JETZT.map((c) => c.label), naechsterText({ tag: "2026-11-14", titel: "X" }), panelUnter("2026-11-06", 2)];
    for (const t of texte) expect(t).not.toMatch(/[–—]/);
  });
});
