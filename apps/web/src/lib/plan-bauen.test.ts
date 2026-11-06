import { describe, expect, it } from "vitest";
import { chipsZaehlen } from "./leads-board-bauen";
import {
  beginnWortAus,
  datumQuelleAus,
  eintragAus,
  heuteAus,
  liveAmTag,
  navZaehlerAus,
  planFiltern,
  planSortieren,
  zeitTextAus,
} from "./plan-bauen";
import {
  PLAN_HEUTE,
  PLAN_JETZT,
  inboxEintrag,
  inboxListe,
  kalenderEreignis,
  leadEintrag,
} from "./plan-bauen.fixture";
import { HEUTE_LISTE_MAX, type PlanEintrag, type PlanLive } from "./plan-heute";

const OHNE = { transporter: null };

function eintrag(ev: Parameters<typeof kalenderEreignis>[0] = {}, karte: Parameters<typeof leadEintrag>[0] | null = {}, transporter: string | null = null) {
  return eintragAus(kalenderEreignis(ev), karte === null ? null : leadEintrag({ id: ev.dealId ?? "d1", ...karte }), { transporter }, PLAN_HEUTE);
}

const BESICHTIGUNG = {
  id: "appt:besichtigung_am:d2",
  dealId: "d2",
  kind: "appointment" as const,
  appointmentLabel: "Besichtigung",
  date: "2026-11-12",
  endDate: "2026-11-12",
  startTime: "16:00",
  endTime: "18:00",
  dateSource: "appointment" as const,
  endIsFallback: true,
};

describe("datumQuelleAus", () => {
  it("bildet jede Kalenderquelle ab; ohne Angabe sicher als Fenster (nicht ziehbar)", () => {
    expect(datumQuelleAus({ kind: "move", dateSource: "attribute" })).toBe("feld");
    expect(datumQuelleAus({ kind: "move", dateSource: "selection" })).toBe("auswahl");
    expect(datumQuelleAus({ kind: "move", dateSource: "window" })).toBe("fenster");
    expect(datumQuelleAus({ kind: "move", dateSource: "proposal" })).toBe("angebot");
    expect(datumQuelleAus({ kind: "appointment", dateSource: "appointment" })).toBe("termin");
    expect(datumQuelleAus({ kind: "appointment", dateSource: undefined })).toBe("termin");
    expect(datumQuelleAus({ kind: "move", dateSource: undefined })).toBe("fenster");
  });
});

describe("zeitTextAus", () => {
  it("Beginn und echtes Ende; „fertig“ nicht bei der +2 h-Notlösung; ganztägig null", () => {
    const ev = { startTime: "07:30", endTime: "13:00", endIsFallback: false, allDay: false };
    expect(zeitTextAus(ev, "umzug", "Beladen")).toBe("07:30 Beladen · ca. 13:00 fertig");
    expect(zeitTextAus({ ...ev, endIsFallback: true, endTime: "09:30" }, "umzug", "Beladen")).toBe("07:30 Beladen");
    expect(zeitTextAus({ ...ev, endTime: null }, "umzug", "Beginn")).toBe("07:30 Beginn");
    expect(zeitTextAus({ ...ev, allDay: true, startTime: null, endTime: null }, "umzug", "Beladen")).toBeNull();
    expect(zeitTextAus({ ...ev, startTime: "16:00", endTime: "18:00", endIsFallback: true }, "besichtigung", "Beladen")).toBe("16:00");
  });

  it("Beginnwort nach Leistung der Karte", () => {
    expect(beginnWortAus("Umzug")).toBe("Beladen");
    expect(beginnWortAus("Entrümpelung und Umzug")).toBe("Beladen");
    expect(beginnWortAus("Entrümpelung")).toBe("Beginn");
    expect(beginnWortAus("Küchenmontage")).toBe("Beginn");
    expect(beginnWortAus(null)).toBe("Beladen");
  });
});

describe("eintragAus", () => {
  it("fester Umzug mit Team: jade, ziehbar, Zeile, Zeittext, Akte der neuen Oberfläche", () => {
    const e = eintrag({}, {}, "Mercedes Sprinter lang");
    expect(e).toMatchObject({
      id: "move:d1",
      dealId: "d1",
      art: "umzug",
      label: "Umzug",
      tag: "2026-11-10",
      bisTag: "2026-11-10",
      von: "07:30",
      bis: "13:00",
      zeitText: "07:30 Beladen · ca. 13:00 fertig",
      ton: "jade",
      fehlt: [],
      titel: "Familie Weber",
      zeile: "Umzug · 2.950 € · Stuttgart-Süd → Esslingen",
      betragText: "2.950 €",
      strecke: "Stuttgart-Süd → Esslingen",
      teamFehlt: false,
      transporter: "Mercedes Sprinter lang",
      firma: { id: "f_kottke", name: "Kottke Umzüge", farbe: "#222224" },
      stufe: { id: "s_geplant", label: "Geplant", kategorie: "booked" },
      datumQuelle: "feld",
      ziehbar: true,
      annahmeAm: null,
      href: "/app/leads/d1",
    });
    expect(e.team.map((t) => t.kuerzel)).toEqual(["MK", "AB"]);
  });

  it("Team fehlt: gold mit Grund als Text, weiter ziehbar", () => {
    const e = eintrag({}, { teamFehlt: true });
    expect([e.ton, e.fehlt, e.zeile, e.ziehbar]).toEqual(["gold", ["team"], "Umzug · 2.950 € · Team fehlt", true]);
  });

  it("vergangener Geplant-Termin: gold „Durchführung bestätigen“ ab dem Folgetag, nicht ziehbar", () => {
    const gestern = eintrag({ date: "2026-11-05", endDate: "2026-11-05" }, { teamFehlt: true });
    expect([gestern.ton, gestern.fehlt, gestern.ziehbar]).toEqual(["gold", ["bestaetigen", "team"], false]);
    expect(gestern.zeile).toBe("Umzug · 2.950 € · Durchführung bestätigen, Team fehlt");
    const heute = eintrag({ date: PLAN_HEUTE, endDate: PLAN_HEUTE });
    expect([heute.ton, heute.ziehbar]).toEqual(["jade", true]);
  });

  it("Angebot oder geschätzt: gestrichelt mit „?“, Stufe vorne, nicht ziehbar", () => {
    const angebot = eintrag({}, { stufe: { id: "s_angebot", label: "Angebot", kategorie: "quoted" }, betragText: "2.480 €" });
    expect([angebot.ton, angebot.titel, angebot.zeile, angebot.ziehbar]).toEqual([
      "gestrichelt",
      "Familie Weber?",
      "Angebot · 2.480 € · Stuttgart-Süd → Esslingen",
      false,
    ]);
    const geschaetzt = eintrag({ estimated: true });
    expect([geschaetzt.ton, geschaetzt.ziehbar]).toEqual(["gestrichelt", false]);
    const vorschlag = eintrag({ dateSource: "proposal", estimated: true }, { stufe: { id: "s_neu", label: "Neue Anfrage", kategorie: "open_new" } });
    expect([vorschlag.ton, vorschlag.datumQuelle, vorschlag.ziehbar]).toEqual(["gestrichelt", "angebot", false]);
  });

  it("Datum aus Portal-Wahl, Auftrag-Fenster oder mehrtägig: Ton bleibt, aber nicht ziehbar", () => {
    const auswahl = eintrag({ dateSource: "selection" });
    expect([auswahl.ton, auswahl.datumQuelle, auswahl.ziehbar]).toEqual(["jade", "auswahl", false]);
    const fenster = eintrag({ dateSource: "window" });
    expect([fenster.datumQuelle, fenster.ziehbar]).toEqual(["fenster", false]);
    const lang = eintrag({ endDate: "2026-11-11" });
    expect([lang.ton, lang.ziehbar]).toEqual(["jade", false]);
  });

  it("Durchgeführt und Bezahlt grau, auch mit fehlendem Team", () => {
    for (const kategorie of ["done_unpaid", "paid"] as const) {
      const e = eintrag({}, { stufe: { id: "s", label: "x", kategorie }, teamFehlt: true });
      expect([e.ton, e.fehlt, e.ziehbar]).toEqual(["grau", [], false]);
    }
  });

  it("Besichtigung: violett, Titel mit Label, Zeile mit Wochentag und Uhrzeit; vergangen grau; nie Fahrzeug", () => {
    const b = eintrag(BESICHTIGUNG, { stufe: { id: "s_kontakt", label: "In Kontakt", kategorie: "open_engaged" } }, "Auto");
    expect(b).toMatchObject({
      art: "besichtigung",
      label: "Besichtigung",
      ton: "violett",
      titel: "Besichtigung Familie Weber",
      zeile: "Do 16:00 · Stuttgart-Süd → Esslingen",
      zeitText: "16:00",
      datumQuelle: "termin",
      ziehbar: false,
      transporter: null,
    });
    const alt = eintrag({ ...BESICHTIGUNG, date: "2026-11-04", endDate: "2026-11-04" });
    expect(alt.ton).toBe("grau");
  });

  it("Entrümpelung: Label und Beginnwort nach Leistung", () => {
    const e = eintrag({}, { art: "Entrümpelung" });
    expect([e.label, e.zeitText, e.zeile]).toEqual(["Entrümpelung", "07:30 Beginn · ca. 13:00 fertig", "Entrümpelung · 2.950 € · Stuttgart-Süd → Esslingen"]);
  });

  it("ohne Preis kein Betrag in der Zeile; Annahme durchgereicht", () => {
    const e = eintrag({}, { betrag: null, betragText: "ohne Preis", fakten: { annahmeAm: "2026-11-02T10:00:00.000Z", kvVorhanden: true, verlustGrund: null } });
    expect([e.betragText, e.zeile, e.annahmeAm]).toEqual([null, "Umzug · Stuttgart-Süd → Esslingen", "2026-11-02T10:00:00.000Z"]);
  });

  it("ohne Lead: Name aus dem Kalender, Kategorie null und damit gestrichelt, Orte und Firma aus dem Kalender", () => {
    const e = eintrag({ title: "Herr Can", companyName: "Ceylan Operations", companyId: "f_ceylan" }, null);
    expect(e).toMatchObject({
      titel: "Herr Can?",
      ton: "gestrichelt",
      stufe: { id: "s_geplant", label: "Geplant", kategorie: null },
      zeile: "Geplant · Stuttgart → Esslingen",
      strecke: "Stuttgart → Esslingen",
      betragText: null,
      team: [],
      teamFehlt: false,
      firma: { id: "f_ceylan", name: "Ceylan Operations", farbe: "#c9361a" },
      ziehbar: false,
      href: "/app/leads/d1",
    });
  });
});

describe("planSortieren und planFiltern", () => {
  const e = (id: string, tag: string, von: string | null, titel: string, firmaId: string | null = "f_kottke"): PlanEintrag =>
    ({
      ...eintrag({ id, dealId: id }),
      tag,
      bisTag: tag,
      von,
      titel,
      firma: firmaId ? { id: firmaId, name: firmaId, farbe: "#000" } : null,
    }) as PlanEintrag;

  it("Tag, Uhrzeit, ganztägig zuletzt, dann Titel", () => {
    const sortiert = planSortieren([
      e("a", "2026-11-11", null, "Anna"),
      e("b", "2026-11-10", null, "Bea"),
      e("c", "2026-11-10", "09:00", "Zora"),
      e("d", "2026-11-10", "07:30", "Udo"),
      e("f", "2026-11-10", null, "Ärger"),
    ]);
    expect(sortiert.map((x) => x.id)).toEqual(["d", "c", "f", "b", "a"]);
  });

  it("Firma (ohne Firma fällt heraus) und Deal-Menge; null filtert nicht", () => {
    const alle = [e("a", "2026-11-10", null, "A"), e("b", "2026-11-10", null, "B", "f_ceylan"), e("c", "2026-11-10", null, "C", null)];
    expect(planFiltern(alle, { firmaId: null, dealIds: null }).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(planFiltern(alle, { firmaId: "f_kottke", dealIds: null }).map((x) => x.id)).toEqual(["a"]);
    expect(planFiltern(alle, { firmaId: null, dealIds: new Set(["b", "c"]) }).map((x) => x.id)).toEqual(["b", "c"]);
    expect(planFiltern(alle, { firmaId: "f_ceylan", dealIds: new Set(["a"]) })).toEqual([]);
  });
});

describe("heuteAus", () => {
  const plan = (liste: Parameters<typeof kalenderEreignis>[0][]) =>
    liste.map((ev) => eintragAus(kalenderEreignis(ev), leadEintrag({ id: ev?.dealId ?? "d1" }), OHNE, PLAN_HEUTE));
  const leer = inboxListe([]);

  it("heute nach Uhrzeit mit Live-Status nur für Umzüge, morgen kompakt, kein nächster", () => {
    const live = new Map<string, PlanLive>([
      ["d1", { losAm: "2026-11-06T06:12:00.000Z", vorOrtAm: null, fertigAm: null }],
      ["d2", { losAm: "2026-11-06T06:00:00.000Z", vorOrtAm: null, fertigAm: null }],
    ]);
    const h = heuteAus(
      {
        plan: plan([
          { dealId: "d1", id: "move:d1", date: PLAN_HEUTE, endDate: PLAN_HEUTE, startTime: "09:00" },
          { ...BESICHTIGUNG, dealId: "d2", id: "appt:besichtigung_am:d2", date: PLAN_HEUTE, endDate: PLAN_HEUTE, startTime: "07:00" },
          { dealId: "d3", id: "move:d3", date: "2026-11-07", endDate: "2026-11-07" },
          { dealId: "d4", id: "move:d4", date: "2026-11-09", endDate: "2026-11-09" },
        ]),
        leads: [],
        inbox: leer,
        live,
      },
      PLAN_JETZT,
    );
    expect(h.tag).toBe(PLAN_HEUTE);
    expect(h.heute.map((t) => [t.id, t.live])).toEqual([
      ["appt:besichtigung_am:d2", null],
      ["move:d1", { losAm: "2026-11-06T06:12:00.000Z", vorOrtAm: null, fertigAm: null }],
    ]);
    expect(h.morgen.map((t) => t.id)).toEqual(["move:d3"]);
    expect(h.naechster).toBeNull();
    expect(h.stand).toBe(PLAN_JETZT.toISOString());
  });

  it("mehrtägiger Umzug steht heute und morgen", () => {
    const h = heuteAus(
      { plan: plan([{ date: "2026-11-05", endDate: "2026-11-07" }]), leads: [], inbox: leer, live: new Map() },
      PLAN_JETZT,
    );
    expect([h.heute.length, h.morgen.length]).toEqual([1, 1]);
  });

  it("erst auf den Tag filtern, dann nach der Zeit an diesem Tag: Uhrzeit zählt nur am ersten Tag, ganztägig und fortlaufend danach", () => {
    const h = heuteAus(
      {
        plan: plan([
          // beginnt gestern 07:30, läuft heute weiter: heute ohne eigene Uhrzeit
          { dealId: "d1", id: "move:d1", title: "Anton", date: "2026-11-05", endDate: "2026-11-06", startTime: "07:30" },
          { dealId: "d2", id: "move:d2", title: "Berta", date: PLAN_HEUTE, endDate: PLAN_HEUTE, startTime: "09:00" },
          { dealId: "d3", id: "move:d3", title: "Cäsar", date: PLAN_HEUTE, endDate: PLAN_HEUTE, startTime: null, endTime: null, allDay: true },
          { dealId: "d4", id: "move:d4", title: "Dora", date: PLAN_HEUTE, endDate: PLAN_HEUTE, startTime: "08:00" },
          // morgen: mehrtägig ab heute 06:00 und ein Termin morgen 10:00
          { dealId: "d5", id: "move:d5", title: "Emil", date: PLAN_HEUTE, endDate: "2026-11-07", startTime: "06:00" },
          { dealId: "d6", id: "move:d6", title: "Fritz", date: "2026-11-07", endDate: "2026-11-07", startTime: "10:00" },
        ]),
        leads: [],
        inbox: leer,
        live: new Map(),
      },
      PLAN_JETZT,
    );
    expect(h.heute.map((t) => t.id)).toEqual(["move:d5", "move:d4", "move:d2", "move:d1", "move:d3"]);
    expect(h.morgen.map((t) => t.id)).toEqual(["move:d6", "move:d5"]);
  });

  it("nächster Termin nur, wenn heute und morgen leer sind", () => {
    const h = heuteAus(
      {
        plan: plan([
          { dealId: "d5", id: "move:d5", date: "2026-11-14", endDate: "2026-11-14" },
          { dealId: "d4", id: "move:d4", date: "2026-11-12", endDate: "2026-11-12" },
        ]),
        leads: [],
        inbox: leer,
        live: new Map(),
      },
      PLAN_JETZT,
    );
    expect([h.heute, h.morgen, h.naechster?.id]).toEqual([[], [], "move:d4"]);
    expect(heuteAus({ plan: [], leads: [], inbox: leer, live: new Map() }, PLAN_JETZT).naechster).toBeNull();
  });

  it("„heute“ kurz nach Mitternacht Berlin ist schon der neue Tag", () => {
    const h = heuteAus(
      { plan: plan([{ date: "2026-11-07", endDate: "2026-11-07" }]), leads: [], inbox: leer, live: new Map() },
      new Date("2026-11-06T23:30:00.000Z"),
    );
    expect([h.tag, h.heute.length, h.morgen.length]).toEqual(["2026-11-07", 1, 0]);
  });

  it("Zahlungsmeldungen und Freigaben gekappt, Gesamtzahlen, Links", () => {
    const leads = Array.from({ length: 7 }, (_, i) =>
      leadEintrag({
        id: `m${i}`,
        name: `Kunde ${i}`,
        zahlungGemeldet: i < 6 ? `Kunde meldet bezahlt · ${i + 1}00 €` : null,
        aktivitaet: `2026-11-0${i + 1}T10:00:00.000Z`,
      }),
    );
    const inbox = inboxListe(
      Array.from({ length: 8 }, (_, i) =>
        inboxEintrag({ key: `deal:e${i}`, name: `Entwurf ${i}`, kiEntwurf: i < 7 ? { text: i === 0 ? "KI-Entwurf · Nachfass" : "KI-Entwurf" } : null }),
      ),
    );
    const h = heuteAus({ plan: [], leads, inbox, live: new Map() }, PLAN_JETZT);
    expect(h.meldungenGesamt).toBe(6);
    expect(h.meldungen).toHaveLength(HEUTE_LISTE_MAX);
    expect(h.meldungen[0]).toEqual({ dealId: "m5", name: "Kunde 5", text: "Kunde meldet bezahlt · 600 €", href: "/app/leads/m5" });
    expect(h.freigaben).toHaveLength(HEUTE_LISTE_MAX);
    expect(h.freigaben[0]).toEqual({ key: "deal:e0", name: "Entwurf 0", text: "KI-Entwurf · Nachfass", href: "/app/inbox?e=deal%3Ae0" });
    expect(new URLSearchParams(h.freigaben[0].href.split("?")[1]).get("e")).toBe("deal:e0");
    // Gesamtzahl der Freigaben = Inbox-Chip KI-Entwürfe.
    expect(h.inbox.kiEntwuerfe).toBe(7);
  });

  it("Inbox-Zahlen und Abschneiden durchgereicht, Leads-Chips gleich chipsZaehlen", () => {
    const leads = [
      leadEintrag({ id: "a" }, ["warten", "ohne_team"]),
      leadEintrag({ id: "b" }, ["warten", "diese_woche"]),
      leadEintrag({ id: "c" }, ["rechnung_offen"]),
    ];
    const inbox = inboxListe([inboxEintrag({ ungelesen: 2 }), inboxEintrag({ key: "deal:d2", wartet: { auf: "uns", seit: null, text: null } })], {
      abgeschnitten: true,
    });
    const h = heuteAus({ plan: [], leads, inbox, live: new Map() }, PLAN_JETZT);
    expect(h.chips).toEqual(chipsZaehlen(leads));
    expect(h.chips).toEqual({ warten: 2, kv_ungesehen: 0, ohne_team: 1, rechnung_offen: 1, diese_woche: 1 });
    expect(h.inbox).toEqual(inbox.chips);
    expect(h.inboxAbgeschnitten).toBe(true);
  });
});

describe("liveAmTag", () => {
  it("nur Zeiten des Tages zählen; ohne Zeiten null", () => {
    expect(liveAmTag(undefined, PLAN_HEUTE)).toBeNull();
    expect(liveAmTag({ losAm: "2026-11-05T06:00:00.000Z", vorOrtAm: null, fertigAm: "2026-11-05T12:00:00.000Z" }, PLAN_HEUTE)).toBeNull();
    // 23:30 UTC am 05.11. ist 00:30 Berlin am 06.11.
    expect(liveAmTag({ losAm: "2026-11-05T23:30:00.000Z", vorOrtAm: null, fertigAm: null }, PLAN_HEUTE)).toEqual({
      losAm: "2026-11-05T23:30:00.000Z",
      vorOrtAm: null,
      fertigAm: null,
    });
  });
});

describe("navZaehlerAus", () => {
  it("Heute = Chip „warten“, Leads = offene Kategorien", () => {
    const leads = [
      leadEintrag({ id: "a", stufe: { id: "1", label: "Neue Anfrage", kategorie: "open_new" } }, ["warten"]),
      leadEintrag({ id: "b", stufe: { id: "2", label: "In Kontakt", kategorie: "open_engaged" } }),
      leadEintrag({ id: "c", stufe: { id: "3", label: "Angebot", kategorie: "quoted" } }, ["warten", "kv_ungesehen"]),
      leadEintrag({ id: "d", stufe: { id: "4", label: "Geplant", kategorie: "booked" } }, ["warten"]),
      leadEintrag({ id: "e", stufe: { id: "5", label: "Verloren", kategorie: "lost" } }),
      leadEintrag({ id: "f", stufe: { id: null, label: "Ohne Stufe", kategorie: null } }),
    ];
    const z = navZaehlerAus(leads);
    expect(z).toEqual({ heute: 3, leads: 3 });
    expect(z.heute).toBe(chipsZaehlen(leads).warten);
  });
});
