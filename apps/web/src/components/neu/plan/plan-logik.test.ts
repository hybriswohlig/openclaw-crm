import { afterEach, describe, expect, it, vi } from "vitest";
import { LEERER_FILTER } from "@/lib/leads-board";
import { planAbfrageAusParams, type PlanEintrag } from "@/lib/plan-heute";
import {
  ZUG_RUHE,
  abfrageFuer,
  ablageId,
  ansichtSpeicherer,
  besichtigungZug,
  dealSucheUrl,
  festlegenZug,
  filterSchluessel,
  imBlickKlick,
  leerArt,
  mehrText,
  mussLaden,
  planUrl,
  popoverAktionen,
  schwebend,
  sichtbareEintraege,
  tagAusAblageId,
  verschiebenZug,
  zelleArt,
  zelleEintraege,
  zelleLabel,
  zelleZusatz,
  zugLaeuft,
  zugWeiter,
  type Schreibzug,
  type ZugZustand,
} from "./plan-logik";

const HEUTE = "2026-11-06";

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
    zeile: "Umzug · 2.950 € · Stuttgart-Süd → Esslingen",
    betragText: "2.950 €",
    strecke: "Stuttgart-Süd → Esslingen",
    team: [],
    teamFehlt: false,
    transporter: null,
    firma: null,
    stufe: { id: "s-geplant", label: "Geplant", kategorie: "booked" },
    datumQuelle: "feld",
    ziehbar: true,
    annahmeAm: null,
    href: "/app/leads/d1",
    ...teil,
  };
}

describe("Zellen", () => {
  it("zeigt höchstens drei Einträge und zählt den Rest", () => {
    const fuenf = ["a", "b", "c", "d", "e"].map((x) => eintrag({ id: x, titel: x }));
    expect(zelleEintraege(fuenf, "2026-11-14")).toEqual({ sichtbar: fuenf.slice(0, 3), mehr: 2 });
    expect(zelleEintraege(fuenf.slice(0, 3), "2026-11-14")).toEqual({ sichtbar: fuenf.slice(0, 3), mehr: 0 });
    expect(zelleEintraege(fuenf.slice(0, 4), "2026-11-14").mehr).toBe(1);
  });

  it("zeigt mehrtägige Einträge an jedem ihrer Tage", () => {
    const lang = eintrag({ tag: "2026-11-30", bisTag: "2026-12-01" });
    expect(zelleEintraege([lang], "2026-11-30").sichtbar).toHaveLength(1);
    expect(zelleEintraege([lang], "2026-12-01").sichtbar).toHaveLength(1);
    expect(zelleEintraege([lang], "2026-12-02").sichtbar).toHaveLength(0);
  });

  it("schreibt „+N weitere“ in Ein- und Mehrzahl", () => {
    expect(mehrText(1)).toBe("+1 weiterer");
    expect(mehrText(4)).toBe("+4 weitere");
  });

  it("macht aus Tag und Ablage-ID dasselbe hin und zurück", () => {
    expect(tagAusAblageId(ablageId("2026-12-31"))).toBe("2026-12-31");
    expect(tagAusAblageId("tag:2026-02-31")).toBeNull();
    expect(tagAusAblageId("move:d1")).toBeNull();
    expect(tagAusAblageId(7)).toBeNull();
  });

  it("beschreibt Zellen für den Bildschirmleser", () => {
    expect(zelleLabel("2026-11-06", HEUTE, 0)).toBe("Freitag 06.11., heute, keine Termine");
    expect(zelleLabel("2026-11-17", HEUTE, 1)).toBe("Dienstag 17.11., 1 Termin");
    expect(zelleLabel("2027-01-01", HEUTE, 3)).toBe("Freitag 01.01., 3 Termine");
  });

  it("kennt heute, vergangen, Wochenende und Nachbarmonat", () => {
    expect(zelleArt("2026-11-01", "2026-11-17", HEUTE)).toEqual({ heute: false, vergangen: true, wochenende: true, nachbar: false });
    expect(zelleArt("2026-10-31", "2026-11-17", HEUTE)).toMatchObject({ nachbar: true, wochenende: true });
    expect(zelleArt(HEUTE, "2026-11-17", HEUTE)).toMatchObject({ heute: true, vergangen: false });
  });

  it("schreibt „heute“ und am Monatsersten den Monat", () => {
    expect(zelleZusatz(HEUTE, HEUTE)).toBe("heute");
    expect(zelleZusatz("2026-12-01", HEUTE)).toBe("Dez");
    expect(zelleZusatz("2027-01-01", HEUTE)).toBe("Jan");
    expect(zelleZusatz("2026-11-17", HEUTE)).toBeNull();
  });

  it("blendet außerhalb des Fensters und mit „nur nicht fest“ aus", () => {
    const fest = eintrag({ id: "a" });
    const offen = eintrag({ id: "b", ton: "gestrichelt" });
    const spaeter = eintrag({ id: "c", tag: "2026-12-20", bisTag: "2026-12-20" });
    const fenster = { von: "2026-11-01", bis: "2026-11-30" };
    expect(sichtbareEintraege([fest, offen, spaeter], fenster, false)).toEqual([fest, offen]);
    expect(sichtbareEintraege([fest, offen, spaeter], fenster, true)).toEqual([offen]);
  });
});

describe("Laden", () => {
  const zustand = { modus: "monat" as const, anker: "2026-11-17", firmaId: "f1", mitarbeiterId: null };

  it("baut die Abfrage aus Ansicht und Filtern", () => {
    expect(abfrageFuer(zustand, null)).toEqual({ von: "2026-10-26", bis: "2026-12-06", firmaId: "f1", mitarbeiterId: null, leads: null });
    const leads = abfrageFuer({ ...zustand, modus: "woche" }, { ...LEERER_FILTER, monat: "2026-11", firmaId: "f2", suche: "can" });
    expect(leads.von).toBe("2026-11-16");
    expect(leads.firmaId).toBeNull();
    expect(leads.leads).toMatchObject({ monat: null, firmaId: "f2", suche: "can" });
  });

  it("ergibt eine URL, die der Server wieder liest", () => {
    const a = abfrageFuer({ ...zustand, mitarbeiterId: "m1" }, null);
    const url = planUrl(a);
    expect(url.startsWith("/api/v1/plan?")).toBe(true);
    expect(planAbfrageAusParams(new URLSearchParams(url.split("?")[1]))).toEqual(a);
  });

  it("lädt nicht doppelt: gleiche Filter und Fenster im geladenen", () => {
    const monat = abfrageFuer(zustand, null);
    const geladen = { von: monat.von, bis: monat.bis, filter: filterSchluessel(monat) };
    expect(mussLaden(null, monat)).toBe(true);
    expect(mussLaden(geladen, monat)).toBe(false);
    expect(mussLaden(geladen, abfrageFuer({ ...zustand, modus: "tag", anker: "2026-11-20" }, null))).toBe(false);
    expect(mussLaden(geladen, abfrageFuer({ ...zustand, modus: "woche", anker: "2026-12-07" }, null))).toBe(true);
    expect(mussLaden(geladen, abfrageFuer({ ...zustand, firmaId: null }, null))).toBe(true);
    expect(mussLaden(geladen, abfrageFuer({ ...zustand, mitarbeiterId: "m1" }, null))).toBe(true);
  });

  it("unterscheidet leer im Zeitraum und leer durch Filter", () => {
    expect(leerArt(2, true)).toBeNull();
    expect(leerArt(0, false)).toBe("zeitraum");
    expect(leerArt(0, true)).toBe("filter");
  });
});

describe("Ansicht speichern", () => {
  afterEach(() => vi.useRealTimers());

  it("speichert 500 ms nach der letzten Änderung, nur geänderte Stände", () => {
    vi.useFakeTimers();
    const speichern = vi.fn();
    const s = ansichtSpeicherer(speichern, { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (id) => clearTimeout(id as never) });
    s.geladen({ modus: "monat" });
    s.planen({ modus: "monat" });
    vi.advanceTimersByTime(1000);
    expect(speichern).not.toHaveBeenCalled();

    s.planen({ modus: "woche" });
    vi.advanceTimersByTime(300);
    s.planen({ modus: "tag" });
    vi.advanceTimersByTime(499);
    expect(speichern).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(speichern).toHaveBeenCalledTimes(1);
    expect(speichern).toHaveBeenCalledWith({ modus: "tag" });

    s.planen({ modus: "tag" });
    vi.advanceTimersByTime(600);
    expect(speichern).toHaveBeenCalledTimes(1);

    s.planen({ modus: "monat" });
    s.abbrechen();
    vi.advanceTimersByTime(600);
    expect(speichern).toHaveBeenCalledTimes(1);
  });
});

describe("Im Blick", () => {
  it("Datumschip öffnet den Tag, Zählchip schaltet, „weitere“ klappt auf", () => {
    expect(imBlickKlick({ art: "ohne_team", tag: "2026-11-15", key: "ohne_team:x" }, false)).toEqual({ art: "tag", tag: "2026-11-15" });
    expect(imBlickKlick({ art: "nicht_fest", tag: null, key: "nicht_fest" }, false)).toEqual({ art: "nicht_fest", an: true });
    expect(imBlickKlick({ art: "nicht_fest", tag: null, key: "nicht_fest" }, true)).toEqual({ art: "nicht_fest", an: false });
    expect(imBlickKlick({ art: "ohne_team", tag: null, key: "weitere" }, false)).toEqual({ art: "aufklappen" });
  });
});

describe("Popover", () => {
  const stufen = [
    { id: "s1", label: "Geplant", kategorie: "booked" as const },
    { id: "s2", label: "Durchgeführt", kategorie: "done_unpaid" as const },
    { id: "s3", label: "Erledigt alt", kategorie: "done_unpaid" as const },
  ];

  it("bietet nur passende Aktionen an", () => {
    expect(popoverAktionen(eintrag(), stufen)).toEqual({ verschieben: true, bestaetigen: null, terminangebote: false, teamZuordnen: false });
    const alt = eintrag({ ton: "gold", fehlt: ["bestaetigen", "team"], ziehbar: false, teamFehlt: true });
    expect(popoverAktionen(alt, stufen)).toEqual({
      verschieben: false,
      bestaetigen: { id: "s2", label: "Durchgeführt" },
      terminangebote: false,
      teamZuordnen: true,
    });
    expect(popoverAktionen(alt, stufen.slice(0, 1)).bestaetigen).toBeNull();
    expect(popoverAktionen(eintrag({ ton: "gestrichelt", ziehbar: false }), stufen).terminangebote).toBe(true);
    expect(popoverAktionen(eintrag({ art: "besichtigung", ton: "violett", ziehbar: false, teamFehlt: true }), stufen)).toMatchObject({
      terminangebote: false,
      teamZuordnen: false,
    });
  });
});

describe("Zug", () => {
  const zug: Schreibzug = {
    dealId: "d1",
    eintragId: "move:d1",
    name: "Familie Can",
    ziel: "2026-11-20",
    text: { titel: "t", text: "x", knopf: "Verschieben", pflicht: null },
    werte: { move_date: "2026-11-20" },
    kunde: true,
  };

  function folge(start: ZugZustand, ...ereignisse: Parameters<typeof zugWeiter>[1][]): ZugZustand[] {
    const aus: ZugZustand[] = [];
    let z = start;
    for (const e of ereignisse) {
      z = zugWeiter(z, e);
      aus.push(z);
    }
    return aus;
  }

  it("bestätigen, speichern, Kunden informieren, Vorlage, fertig", () => {
    expect(folge(ZUG_RUHE, { typ: "start", zug }, { typ: "bestaetigen" }, { typ: "gespeichert" }, { typ: "vorlage" }, { typ: "fertig" }).map((z) => z.art)).toEqual([
      "frage",
      "speichert",
      "informieren",
      "vorlage",
      "ruhe",
    ]);
  });

  it("Abbrechen vor dem Speichern lässt nichts zurück", () => {
    expect(folge(ZUG_RUHE, { typ: "start", zug }, { typ: "abbrechen" }).map((z) => z.art)).toEqual(["frage", "ruhe"]);
  });

  it("Fehler führt mit Meldung zurück in die Rückfrage", () => {
    const [, , z] = folge(ZUG_RUHE, { typ: "start", zug }, { typ: "bestaetigen" }, { typ: "fehler", meldung: "Kaputt" });
    expect(z).toEqual({ art: "frage", zug, fehler: "Kaputt" });
  });

  it("„Nicht jetzt“ beendet nach dem Speichern; ohne Kunde gleich Ruhe", () => {
    expect(folge(ZUG_RUHE, { typ: "start", zug }, { typ: "bestaetigen" }, { typ: "gespeichert" }, { typ: "fertig" }).at(-1)).toEqual(ZUG_RUHE);
    expect(folge(ZUG_RUHE, { typ: "start", zug: { ...zug, kunde: false } }, { typ: "bestaetigen" }, { typ: "gespeichert" }).at(-1)).toEqual(ZUG_RUHE);
  });

  it("ignoriert unpassende Ereignisse", () => {
    const speichert: ZugZustand = { art: "speichert", zug };
    expect(zugWeiter(speichert, { typ: "abbrechen" })).toBe(speichert);
    expect(zugWeiter(speichert, { typ: "start", zug })).toBe(speichert);
    expect(zugWeiter(ZUG_RUHE, { typ: "bestaetigen" })).toBe(ZUG_RUHE);
    expect(zugWeiter(ZUG_RUHE, { typ: "gespeichert" })).toBe(ZUG_RUHE);
  });

  it("pausiert und zeigt die Vorschau nur während der Rückfrage", () => {
    expect(zugLaeuft(ZUG_RUHE)).toBe(false);
    expect(zugLaeuft({ art: "informieren", zug })).toBe(true);
    expect(schwebend({ art: "frage", zug, fehler: null })).toEqual({ eintragId: "move:d1", ziel: "2026-11-20" });
    expect(schwebend({ art: "informieren", zug })).toBeNull();
    expect(schwebend({ art: "frage", zug: { ...zug, eintragId: null }, fehler: null })).toBeNull();
  });

  it("Verschieben: gleicher Tag schreibt nichts, gesperrt und vergangen geben Hinweise", () => {
    expect(verschiebenZug(eintrag(), "2026-11-14", HEUTE)).toEqual({ hinweis: null });
    expect(verschiebenZug(eintrag({ ziehbar: false }), "2026-11-20", HEUTE)).toMatchObject({ hinweis: expect.stringContaining("Nur feste Umzüge") });
    expect(verschiebenZug(eintrag(), "2026-11-01", HEUTE)).toMatchObject({ hinweis: expect.stringContaining("vergangenen") });
    expect(verschiebenZug(eintrag(), "2026-02-30", HEUTE)).toMatchObject({ hinweis: expect.any(String) });
  });

  it("Verschieben: schreibt nur move_date und fragt nach Annahme mit Pflichthaken", () => {
    const r = verschiebenZug(eintrag({ von: "07:30", annahmeAm: "2026-11-02T10:00:00Z" }), "2026-11-20", HEUTE);
    if (!("zug" in r)) throw new Error("kein Zug");
    expect(r.zug.werte).toEqual({ move_date: "2026-11-20" });
    expect(r.zug.kunde).toBe(true);
    expect(r.zug.text.titel).toBe("Familie Can auf Fr 20.11. verschieben?");
    expect(r.zug.text.pflicht).toBe("Der Kunde ist mit dem neuen Tag einverstanden.");
    expect(r.zug.text.text).toContain("07:30");
  });

  it("Festlegen: neuer Tag, bisheriger Tag, gleicher Tag, Vergangenheit", () => {
    const d = { dealId: "d9", name: "Familie Weber", termin: null, annahmeAm: null };
    const neu = festlegenZug(d, "2026-11-21", HEUTE);
    if (!("zug" in neu)) throw new Error("kein Zug");
    expect(neu.zug.text.titel).toBe("Umzug von Familie Weber auf Sa 21.11. festlegen?");
    expect(neu.zug.text.knopf).toBe("Festlegen");
    expect(neu.zug.werte).toEqual({ move_date: "2026-11-21" });
    const verlegt = festlegenZug({ ...d, termin: "2026-11-19", annahmeAm: "2026-11-01T09:00:00Z" }, "2026-11-21", HEUTE);
    if (!("zug" in verlegt)) throw new Error("kein Zug");
    expect(verlegt.zug.text.text).toContain("Bisher Do 19.11.");
    expect(verlegt.zug.text.pflicht).not.toBeNull();
    expect(festlegenZug({ ...d, termin: "2026-11-21" }, "2026-11-21", HEUTE)).toEqual({ hinweis: "Der Umzug steht schon auf diesem Tag." });
    expect(festlegenZug(d, "2026-11-01", HEUTE)).toMatchObject({ hinweis: expect.any(String) });
  });

  it("Besichtigung: Tag oder Tag mit Uhrzeit, ohne Kundenschritt", () => {
    const tag = besichtigungZug({ dealId: "d2", name: "Nowak" }, { slug: "besichtigung_am", typ: "date" }, "2026-11-12", "", null);
    if (!("zug" in tag)) throw new Error("kein Zug");
    expect(tag.zug.werte).toEqual({ besichtigung_am: "2026-11-12" });
    expect(tag.zug.kunde).toBe(false);
    const zeit = besichtigungZug({ dealId: "d2", name: "Nowak" }, { slug: "besichtigung_am", typ: "timestamp" }, "2026-11-12", "16:00", "2026-11-12T15:00:00.000Z");
    if (!("zug" in zeit)) throw new Error("kein Zug");
    expect(zeit.zug.werte).toEqual({ besichtigung_am: "2026-11-12T15:00:00.000Z" });
    expect(zeit.zug.text.titel).toBe("Besichtigung bei Nowak am Do 12.11. um 16:00 eintragen?");
    expect(besichtigungZug({ dealId: "d2", name: "Nowak" }, { slug: "b", typ: "timestamp" }, "2026-11-12", "", null)).toEqual({ hinweis: "Bitte eine Uhrzeit wählen." });
    expect(besichtigungZug({ dealId: "d2", name: "Nowak" }, { slug: "b", typ: "timestamp" }, "2027-03-28", "02:30", null)).toEqual({
      hinweis: "Diese Uhrzeit gibt es an dem Tag nicht.",
    });
  });

  it("Deal-Suche erst ab zwei Zeichen", () => {
    expect(dealSucheUrl(" c ")).toBeNull();
    expect(dealSucheUrl("Can ")).toBe("/api/v1/leads/liste?q=Can&offset=0");
  });
});
