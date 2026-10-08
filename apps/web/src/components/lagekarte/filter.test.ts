import { describe, expect, it } from "vitest";
import { beispielAntwort } from "@/lib/lagekarte/beispiel-daten";
import { KARTEN_STATUS_REIHENFOLGE, type LeadPunkt } from "@/lib/lagekarte/typen";
import {
  STANDARD_FILTER,
  behalteAuswahl,
  filterAusUrl,
  filterZuUrl,
  filtereLeads,
  weitereFilterAktiv,
  zaehleStatus,
  type KartenFilter,
} from "./filter";

const JETZT = new Date("2026-10-08T07:30:00+02:00");
const TAG = 24 * 60 * 60 * 1000;
const leads = beispielAntwort(JETZT).leads;

function mitAlter(lead: LeadPunkt, tage: number): LeadPunkt {
  return { ...lead, angelegtAm: new Date(JETZT.getTime() - tage * TAG).toISOString() };
}

function filter(teil: Partial<KartenFilter> = {}): KartenFilter {
  return { ...STANDARD_FILTER, ...teil };
}

describe("STANDARD_FILTER", () => {
  it("zeigt alle Status außer verloren, ohne weitere Einschränkung", () => {
    expect(STANDARD_FILTER.status).toEqual(["neu", "kontakt", "angebot", "auftrag", "erledigt", "unbekannt"]);
    expect(STANDARD_FILTER.nurWartet).toBe(false);
    expect(STANDARD_FILTER.firmen).toEqual([]);
    expect(STANDARD_FILTER.zeitraum).toBe("alle");
    expect(STANDARD_FILTER.wertAbEuro).toBeNull();
    expect(STANDARD_FILTER.suche).toBe("");
  });
});

describe("URL-Zustand", () => {
  it("erzeugt für den Standard eine leere URL", () => {
    expect(filterZuUrl(STANDARD_FILTER).toString()).toBe("");
  });

  it("liest eine leere URL als Standard", () => {
    expect(filterAusUrl(new URLSearchParams())).toEqual(STANDARD_FILTER);
  });

  it("macht einen Roundtrip über filterZuUrl und filterAusUrl", () => {
    const f: KartenFilter = {
      status: ["angebot", "verloren"],
      nurWartet: true,
      firmen: ["firma-kottke", "ohne"],
      zeitraum: "90",
      wertAbEuro: 1500,
      suche: "70176 Müller",
    };
    expect(filterAusUrl(filterZuUrl(f))).toEqual(f);
  });

  it("schreibt die dokumentierten Schlüssel", () => {
    const url = filterZuUrl(
      filter({ status: ["neu", "auftrag"], nurWartet: true, firmen: ["a", "ohne"], zeitraum: "30", wertAbEuro: 1000, suche: "stutt" }),
    );
    expect(url.get("status")).toBe("neu,auftrag");
    expect(url.get("wartet")).toBe("1");
    expect(url.get("firma")).toBe("a,ohne");
    expect(url.get("zeit")).toBe("30");
    expect(url.get("wert")).toBe("1000");
    expect(url.get("q")).toBe("stutt");
  });

  it("lässt Standardwerte weg und behält fremde Parameter", () => {
    const basis = new URLSearchParams("lead=lead-3&ansicht=3d&wartet=1&zeit=30");
    const url = filterZuUrl(STANDARD_FILTER, basis);
    expect(url.get("lead")).toBe("lead-3");
    expect(url.get("ansicht")).toBe("3d");
    expect(url.has("wartet")).toBe(false);
    expect(url.has("zeit")).toBe(false);
    expect(basis.get("wartet")).toBe("1");
  });

  it("ignoriert unbekannte Werte", () => {
    const f = filterAusUrl(new URLSearchParams("status=foo,angebot,bar&zeit=7&wert=abc&firma=,x,&wartet=2"));
    expect(f.status).toEqual(["angebot"]);
    expect(f.zeitraum).toBe("alle");
    expect(f.wertAbEuro).toBeNull();
    expect(f.firmen).toEqual(["x"]);
    expect(f.nurWartet).toBe(false);
  });

  it("fällt bei ausschließlich unbekannten Status auf den Standard zurück", () => {
    expect(filterAusUrl(new URLSearchParams("status=foo")).status).toEqual(STANDARD_FILTER.status);
  });

  it("ignoriert nicht positive oder nicht endliche Wertgrenzen", () => {
    expect(filterAusUrl(new URLSearchParams("wert=0")).wertAbEuro).toBeNull();
    expect(filterAusUrl(new URLSearchParams("wert=-5")).wertAbEuro).toBeNull();
    expect(filterAusUrl(new URLSearchParams("wert=Infinity")).wertAbEuro).toBeNull();
  });

  it("hält eine bewusst leere Status-Auswahl im Roundtrip", () => {
    const f = filter({ status: [] });
    const url = filterZuUrl(f);
    expect(url.has("status")).toBe(true);
    expect(filterAusUrl(url).status).toEqual([]);
  });

  it("normiert Status-Reihenfolge und entfernt Doppelte", () => {
    const f = filterAusUrl(new URLSearchParams("status=auftrag,neu,neu"));
    expect(f.status).toEqual(["neu", "auftrag"]);
  });

  it("lässt status weg, wenn die Auswahl dem Standard entspricht (auch umsortiert)", () => {
    const url = filterZuUrl(filter({ status: [...STANDARD_FILTER.status].reverse() }));
    expect(url.has("status")).toBe(false);
  });
});

describe("filtereLeads", () => {
  it("blendet im Standard nur verlorene Leads aus", () => {
    const erwartet = leads.filter((l) => l.status !== "verloren");
    expect(erwartet.length).toBeLessThan(leads.length);
    expect(filtereLeads(leads, STANDARD_FILTER, JETZT)).toEqual(erwartet);
  });

  it("zeigt verlorene Leads, wenn der Status gewählt ist", () => {
    const r = filtereLeads(leads, filter({ status: ["verloren"] }), JETZT);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((l) => l.status === "verloren")).toBe(true);
  });

  it("liefert mit Firma „ohne“ nur Leads ohne Firma", () => {
    const r = filtereLeads(leads, filter({ firmen: ["ohne"], status: [...KARTEN_STATUS_REIHENFOLGE] }), JETZT);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((l) => l.firmaId === null)).toBe(true);
    expect(r.length).toBe(leads.filter((l) => l.firmaId === null).length);
  });

  it("kombiniert Firma-ID und „ohne“", () => {
    const r = filtereLeads(leads, filter({ firmen: ["firma-ceylan", "ohne"] }), JETZT);
    expect(r.every((l) => l.firmaId === null || l.firmaId === "firma-ceylan")).toBe(true);
    expect(r.some((l) => l.firmaId === "firma-ceylan")).toBe(true);
    expect(r.some((l) => l.firmaId === null)).toBe(true);
  });

  it("filtert nach einer Firma", () => {
    const r = filtereLeads(leads, filter({ firmen: ["firma-kottke"] }), JETZT);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((l) => l.firmaId === "firma-kottke")).toBe(true);
  });

  it("schließt beim Zeitraum 30 Tage 31 Tage alte Leads aus und behält 29 Tage alte", () => {
    const basis = leads[0];
    const alt = mitAlter({ ...basis, id: "alt", status: "neu" }, 31);
    const frisch = mitAlter({ ...basis, id: "frisch", status: "neu" }, 29);
    const r = filtereLeads([alt, frisch], filter({ zeitraum: "30" }), JETZT);
    expect(r.map((l) => l.id)).toEqual(["frisch"]);
  });

  it("zählt genau 30 Tage alte Leads noch zum Zeitraum 30", () => {
    const grenze = mitAlter({ ...leads[0], id: "grenze", status: "neu" }, 30);
    expect(filtereLeads([grenze], filter({ zeitraum: "30" }), JETZT)).toHaveLength(1);
  });

  it("unterstützt die Zeiträume 90 und 365", () => {
    const l = (id: string, tage: number) => mitAlter({ ...leads[0], id, status: "neu" }, tage);
    const test = [l("a", 89), l("b", 91), l("c", 364), l("d", 366)];
    expect(filtereLeads(test, filter({ zeitraum: "90" }), JETZT).map((x) => x.id)).toEqual(["a"]);
    expect(filtereLeads(test, filter({ zeitraum: "365" }), JETZT).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("schließt bei wertAbEuro Leads ohne Wert aus", () => {
    const r = filtereLeads(leads, filter({ wertAbEuro: 1000, status: [...KARTEN_STATUS_REIHENFOLGE] }), JETZT);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((l) => l.wert !== null && l.wert.cent >= 100000)).toBe(true);
    expect(leads.some((l) => l.wert === null)).toBe(true);
  });

  it("vergleicht den Wert in Euro gegen Cent inklusive Grenze", () => {
    const l = (id: string, cent: number): LeadPunkt => ({ ...leads[0], id, status: "neu", wert: { cent, art: "angebot" } });
    const r = filtereLeads([l("knapp", 99999), l("genau", 100000)], filter({ wertAbEuro: 1000 }), JETZT);
    expect(r.map((x) => x.id)).toEqual(["genau"]);
  });

  it("zeigt bei nurWartet nur wartende Leads", () => {
    const r = filtereLeads(leads, filter({ nurWartet: true }), JETZT);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((l) => l.wartet !== null)).toBe(true);
  });

  it("sucht nach PLZ", () => {
    const r = filtereLeads(leads, filter({ suche: "70176" }), JETZT);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((l) => l.ort?.plz === "70176")).toBe(true);
  });

  it("sucht case-insensitiv nach Name, Nummer und Ortsname", () => {
    const nachName = filtereLeads(leads, filter({ suche: "FAMILIE ALBRECHT" }), JETZT);
    expect(nachName.map((l) => l.name)).toEqual(["Familie Albrecht"]);

    const nummer = leads[2].nummer as string;
    expect(filtereLeads(leads, filter({ suche: nummer }), JETZT).map((l) => l.id)).toContain(leads[2].id);

    const nachOrt = filtereLeads(leads, filter({ suche: "nagold" }), JETZT);
    expect(nachOrt.length).toBeGreaterThan(0);
    expect(nachOrt.every((l) => l.ort?.ortsname === "Nagold")).toBe(true);
  });

  it("findet Leads ohne Ort bei der Suche nur über Name und Nummer, ohne zu werfen", () => {
    const ohneOrt = leads.find((l) => l.ort === null) as LeadPunkt;
    expect(filtereLeads([ohneOrt], filter({ suche: "zzz-nicht-da" }), JETZT)).toEqual([]);
    expect(filtereLeads([ohneOrt], filter({ suche: ohneOrt.name.toLowerCase(), status: [...KARTEN_STATUS_REIHENFOLGE] }), JETZT)).toHaveLength(1);
  });

  it("ignoriert Leerzeichen um die Suche", () => {
    expect(filtereLeads(leads, filter({ suche: "  70176  " }), JETZT)).toEqual(filtereLeads(leads, filter({ suche: "70176" }), JETZT));
  });

  it("kombiniert Filter mit UND", () => {
    const r = filtereLeads(leads, filter({ status: ["kontakt"], nurWartet: true, firmen: ["firma-kottke"] }), JETZT);
    expect(r.every((l) => l.status === "kontakt" && l.wartet !== null && l.firmaId === "firma-kottke")).toBe(true);
  });

  it("verändert die Eingabeliste nicht", () => {
    const kopie = [...leads];
    filtereLeads(leads, filter({ nurWartet: true }), JETZT);
    expect(leads).toEqual(kopie);
  });
});

describe("zaehleStatus", () => {
  it("enthält alle Status und zählt im Standard ohne Status-Filter", () => {
    const z = zaehleStatus(leads, STANDARD_FILTER, JETZT);
    expect(Object.keys(z).sort()).toEqual([...KARTEN_STATUS_REIHENFOLGE].sort());
    for (const s of KARTEN_STATUS_REIHENFOLGE) {
      expect(z[s]).toBe(leads.filter((l) => l.status === s).length);
    }
  });

  it("ignoriert den Status-Filter", () => {
    const a = zaehleStatus(leads, filter({ status: ["neu"] }), JETZT);
    const b = zaehleStatus(leads, filter({ status: [] }), JETZT);
    expect(a).toEqual(zaehleStatus(leads, STANDARD_FILTER, JETZT));
    expect(b).toEqual(a);
    expect(a.verloren).toBeGreaterThan(0);
  });

  it("berücksichtigt alle übrigen Filter", () => {
    const f = filter({ nurWartet: true, status: ["neu"] });
    const z = zaehleStatus(leads, f, JETZT);
    for (const s of KARTEN_STATUS_REIHENFOLGE) {
      expect(z[s]).toBe(leads.filter((l) => l.status === s && l.wartet !== null).length);
    }
  });
});

describe("behalteAuswahl", () => {
  const verloren = leads.find((l) => l.status === "verloren") as LeadPunkt;
  const gefiltert = filtereLeads(leads, STANDARD_FILTER, JETZT);

  it("findet einen Lead im Filter", () => {
    const lead = gefiltert[0];
    expect(behalteAuswahl(lead.id, leads, gefiltert)).toEqual({ lead, imFilter: true });
  });

  it("findet den Lead auch, wenn der Filter ihn ausblendet", () => {
    expect(gefiltert.some((l) => l.id === verloren.id)).toBe(false);
    expect(behalteAuswahl(verloren.id, leads, gefiltert)).toEqual({ lead: verloren, imFilter: false });
  });

  it("liefert für unbekannte oder fehlende IDs null", () => {
    expect(behalteAuswahl("gibt-es-nicht", leads, gefiltert)).toEqual({ lead: null, imFilter: false });
    expect(behalteAuswahl(null, leads, gefiltert)).toEqual({ lead: null, imFilter: false });
  });
});

describe("weitereFilterAktiv (Zahl am Knopf „Filter“ der schmalen Legende)", () => {
  it("ist 0 im Standard und wenn nur Status, Wartet oder Suche abweichen", () => {
    expect(weitereFilterAktiv(STANDARD_FILTER)).toBe(0);
    expect(weitereFilterAktiv(filter({ status: ["neu"], nurWartet: true, suche: "müller" }))).toBe(0);
  });

  it("zählt Firma, Eingang und Wert je einmal", () => {
    expect(weitereFilterAktiv(filter({ firmen: ["a", "ohne"] }))).toBe(1);
    expect(weitereFilterAktiv(filter({ zeitraum: "30" }))).toBe(1);
    expect(weitereFilterAktiv(filter({ wertAbEuro: 1500 }))).toBe(1);
    expect(weitereFilterAktiv(filter({ firmen: ["a"], zeitraum: "365", wertAbEuro: 500 }))).toBe(3);
  });

  it("zählt einen Mindestwert von 0 € als gesetzt", () => {
    expect(weitereFilterAktiv(filter({ wertAbEuro: 0 }))).toBe(1);
  });
});
