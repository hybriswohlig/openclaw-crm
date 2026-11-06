import { describe, expect, it } from "vitest";
import type { AblaufFakten } from "./ablauf";
import {
  artAus,
  dockAus,
  kuerzelAus,
  metaAus,
  ortAus,
  streckeAus,
  stufenTon,
  volumenHerkunftAus,
  zahlenreiheAus,
  type Kachel,
} from "./akte";

/** Do 05.11.2026, 10:00 Berlin. */
const JETZT = new Date("2026-11-05T09:00:00.000Z");

/** Stand des Mockups: KV v2 gesendet, nicht angenommen, Team mit drei Leuten. */
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
    nachfass: { modus: "sendet", text: "automatisch, sendet", regeln: [] },
    annahme: null,
    abAm: null,
    team: { personen: 3, namen: ["Max Kottke", "Tim Schulz", "Ali Rahimi"] },
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

const WARTET_KUNDE = {
  waitingOn: "kunde" as const,
  waitingSince: "2026-11-03T09:00:00.000Z",
  waitingReason: "KV 3× geöffnet",
};

function kachel(kacheln: Kachel[], key: Kachel["key"]): Kachel {
  const k = kacheln.find((x) => x.key === key);
  if (!k) throw new Error(`Kachel ${key} fehlt`);
  return k;
}

describe("zahlenreiheAus", () => {
  it("Mockup: immer sechs Kacheln in fester Reihenfolge mit den Werten der Spec", () => {
    const kacheln = zahlenreiheAus(mockup(), WARTET_KUNDE, "aus 14 Fotos und Chat", JETZT);
    expect(kacheln.map((k) => k.key)).toEqual(["kv", "marge", "termin", "volumen", "team", "wartet"]);
    expect(kacheln).toEqual([
      { key: "kv", label: "Kostenvoranschlag", wert: "2.480 €", zeile: "v2 · gesendet Mi 04.11." },
      { key: "marge", label: "Marge", wert: "38 %", zeile: "Selbstkosten 1.540 €" },
      { key: "termin", label: "Termin", wert: "Sa 21.11.", zeile: "in 16 Tagen" },
      { key: "volumen", label: "Volumen", wert: "38 m³", zeile: "aus 14 Fotos und Chat" },
      { key: "team", label: "Team", wert: "3 · Sprinter L", zeile: "Fahrt 1,2 h · Arbeit 5,5 h" },
      { key: "wartet", label: "Wartet auf Kunden", wert: "2 Tage", zeile: "KV 3× geöffnet", ton: "grau" },
    ]);
  });

  it("alle Rückfälle: ohne KV, Version, Termin, Volumen, Team und Wartet-Zeile immer noch sechs Kacheln", () => {
    const f: AblaufFakten = {
      ...mockup(),
      kalkulation: null,
      kv: null,
      termin: null,
      volumenCbm: null,
      team: { personen: 0, namen: [] },
      einsatz: null,
    };
    const kacheln = zahlenreiheAus(f, { waitingOn: null, waitingSince: null, waitingReason: null }, null, JETZT);
    expect(kacheln).toEqual([
      { key: "kv", label: "Kostenvoranschlag", wert: "–", zeile: "noch kein KV" },
      { key: "marge", label: "Marge", wert: "–", zeile: "noch keine Kalkulation" },
      { key: "termin", label: "Termin", wert: "–", zeile: "kein Termin" },
      { key: "volumen", label: "Volumen", wert: "–", zeile: "noch offen" },
      { key: "team", label: "Team", wert: "–", zeile: "noch kein Team" },
      { key: "wartet", label: "Läuft", wert: "–", zeile: "", ton: "jade" },
    ]);
  });

  it("KV nicht gesendet, Stunden-KV, KV ohne Version und ohne Betrag", () => {
    const basis = mockup();
    const z = (kv: AblaufFakten["kv"]) => kachel(zahlenreiheAus({ ...basis, kv }, WARTET_KUNDE, null, JETZT), "kv");
    expect(z({ ...basis.kv!, gesendetAm: null })).toMatchObject({ wert: "2.480 €", zeile: "v2 · noch nicht gesendet" });
    expect(z({ ...basis.kv!, istStunden: true, betragCent: null })).toMatchObject({
      wert: "Stunden-KV",
      zeile: "v2 · gesendet Mi 04.11.",
    });
    expect(z({ ...basis.kv!, version: null })).toMatchObject({ wert: "2.480 €", zeile: "gesendet Mi 04.11." });
    expect(z({ ...basis.kv!, betragCent: null })).toMatchObject({ wert: "–", zeile: "v2 · gesendet Mi 04.11." });
  });

  it("Marge: ganze Prozent, Selbstkosten fehlen, Marge fehlt", () => {
    const basis = mockup();
    const m = (k: Partial<NonNullable<AblaufFakten["kalkulation"]>>) =>
      kachel(zahlenreiheAus({ ...basis, kalkulation: { ...basis.kalkulation!, ...k } }, WARTET_KUNDE, null, JETZT), "marge");
    expect(m({ margeProzent: 38.4 })).toMatchObject({ wert: "38 %" });
    expect(m({ selbstkostenCent: null })).toMatchObject({ wert: "38 %", zeile: "" });
    expect(m({ margeProzent: null })).toMatchObject({ wert: "–", zeile: "Selbstkosten 1.540 €" });
  });

  it("Termin: heute, morgen, vor 3 Tagen", () => {
    const t = (datum: string) =>
      kachel(zahlenreiheAus({ ...mockup(), termin: { datum, von: null, bis: null } }, WARTET_KUNDE, null, JETZT), "termin");
    expect(t("2026-11-05")).toEqual({ key: "termin", label: "Termin", wert: "Do 05.11.", zeile: "heute" });
    expect(t("2026-11-06")).toMatchObject({ zeile: "morgen" });
    expect(t("2026-11-02")).toMatchObject({ wert: "Mo 02.11.", zeile: "vor 3 Tagen" });
  });

  it("Volumen ohne Herkunft: leere Zeile; Volumen 0 gilt als offen", () => {
    expect(kachel(zahlenreiheAus(mockup(), WARTET_KUNDE, null, JETZT), "volumen")).toMatchObject({ wert: "38 m³", zeile: "" });
    expect(kachel(zahlenreiheAus({ ...mockup(), volumenCbm: 0 }, WARTET_KUNDE, "aus Chat", JETZT), "volumen")).toMatchObject({
      wert: "–",
      zeile: "noch offen",
    });
  });

  it("Team: ohne Fahrzeug nur die Zahl, ohne Zeiten leere Zeile, nur eine Zeit", () => {
    const basis = mockup();
    const t = (einsatz: AblaufFakten["einsatz"]) =>
      kachel(zahlenreiheAus({ ...basis, einsatz }, WARTET_KUNDE, null, JETZT), "team");
    expect(t(null)).toMatchObject({ wert: "3", zeile: "" });
    expect(t({ ...basis.einsatz!, fahrzeug: null, fahrtH: null })).toMatchObject({ wert: "3", zeile: "Arbeit 5,5 h" });
    // Rechner-Einsatz ohne zugewiesenes Team: noch kein Team.
    expect(kachel(zahlenreiheAus({ ...basis, team: { personen: 0, namen: [] } }, WARTET_KUNDE, null, JETZT), "team")).toMatchObject({
      wert: "–",
      zeile: "noch kein Team",
    });
  });

  it("Wartet: gold bei uns, grau bei Kunde, jade „Läuft“ bei niemand; Dauer in Min, Std, Tagen", () => {
    const w = (waitingOn: "uns" | "kunde" | "niemand" | null, waitingSince: string | null, waitingReason: string | null = null) =>
      kachel(zahlenreiheAus(mockup(), { waitingOn, waitingSince, waitingReason }, null, JETZT), "wartet");
    expect(w("uns", "2026-11-05T08:25:00.000Z", "Neue Nachricht")).toEqual({
      key: "wartet",
      label: "Wartet auf uns",
      wert: "35 Min",
      zeile: "Neue Nachricht",
      ton: "gold",
    });
    expect(w("kunde", "2026-11-05T04:00:00.000Z")).toEqual({ key: "wartet", label: "Wartet auf Kunden", wert: "5 Std", zeile: "", ton: "grau" });
    expect(w("niemand", "2026-11-04T08:00:00.000Z")).toEqual({ key: "wartet", label: "Läuft", wert: "1 Tag", zeile: "", ton: "jade" });
    expect(w("uns", null)).toMatchObject({ wert: "–", ton: "gold" });
    // Zeitpunkt in der Zukunft (Uhrabweichung): 0 Min statt negativ.
    expect(w("uns", "2026-11-05T09:05:00.000Z")).toMatchObject({ wert: "0 Min" });
    // Text ohne Zeitzone wie aus der Datenbank gilt als UTC.
    expect(w("kunde", "2026-11-03 09:00:00")).toMatchObject({ wert: "2 Tage" });
  });
});

const KEIN_E = { offenerNachfassEntwurf: null, einzigeMeldung: null, hatKanal: true };
const ENTWURF = { id: "draft_1", gespraechId: "c_wa" };

describe("dockAus", () => {
  const dock = (f: Partial<AblaufFakten>, e: Partial<Parameters<typeof dockAus>[1]> = {}) =>
    dockAus({ ...mockup(), ...f }, { ...KEIN_E, ...e });

  it("Verloren und Kein Lead: Nachricht schreiben, auch mit Entwurf und Meldung", () => {
    for (const stageCategory of ["lost", "kein_lead"]) {
      expect(dock({ stageCategory, offeneMeldungen: 1 }, { offenerNachfassEntwurf: ENTWURF, einzigeMeldung: "evt_1" }).primaer).toEqual({
        aktion: "nachricht_schreiben",
        label: "Nachricht schreiben",
      });
    }
  });

  it("offener Nachfass-Entwurf mit Kanal: Nachfass senden mit Entwurf-ID", () => {
    expect(dock({}, { offenerNachfassEntwurf: ENTWURF }).primaer).toEqual({
      aktion: "nachfass_senden",
      label: "Nachfass senden",
      ziel: "draft_1",
    });
  });

  it("ohne Kanal nie Nachfass senden", () => {
    const d = dock({}, { offenerNachfassEntwurf: ENTWURF, hatKanal: false });
    expect(d.primaer.aktion).not.toBe("nachfass_senden");
    expect(d.primaer).toEqual({ aktion: "nachricht_schreiben", label: "Nachricht schreiben" });
    // Auch wenn danach keine andere Regel greift, bleibt es beim Rückfall.
    expect(dock({ stageCategory: "open_new", kalkulation: null }, { offenerNachfassEntwurf: ENTWURF, hatKanal: false }).primaer.aktion).toBe(
      "kv_erstellen"
    );
  });

  it("offene Zahlungsmeldung: Zahlung bestätigen, Ziel nur bei genau einer", () => {
    expect(dock({ offeneMeldungen: 1 }, { einzigeMeldung: "evt_1" }).primaer).toEqual({
      aktion: "zahlung_bestaetigen",
      label: "Zahlung bestätigen",
      ziel: "evt_1",
    });
    expect(dock({ offeneMeldungen: 2 }).primaer).toEqual({ aktion: "zahlung_bestaetigen", label: "Zahlung bestätigen" });
  });

  it("Nachfass geht vor Zahlungsmeldung", () => {
    expect(dock({ offeneMeldungen: 1 }, { offenerNachfassEntwurf: ENTWURF, einzigeMeldung: "evt_1" }).primaer.aktion).toBe("nachfass_senden");
  });

  it("offene Stufe ohne gesperrte Version: KV erstellen", () => {
    const entwurf = { ...mockup().kalkulation!, status: "entwurf" as const };
    expect(dock({ stageCategory: "open_new", kalkulation: null }).primaer).toEqual({ aktion: "kv_erstellen", label: "KV erstellen" });
    expect(dock({ stageCategory: "open_engaged", kalkulation: entwurf }).primaer.aktion).toBe("kv_erstellen");
    // Gesperrt: kein KV erstellen.
    expect(dock({ stageCategory: "open_engaged" }).primaer.aktion).toBe("nachricht_schreiben");
    // Angebot ohne gesperrte Version: nicht diese Regel.
    expect(dock({ stageCategory: "quoted", kalkulation: null }).primaer.aktion).toBe("nachricht_schreiben");
  });

  it("Annahme ohne AB: AB erstellen; mit AB nicht", () => {
    const annahme = { am: "2026-11-05T08:00:00.000Z", unterschriftAm: null };
    expect(dock({ annahme }).primaer).toEqual({ aktion: "ab_erstellen", label: "AB erstellen" });
    expect(dock({ annahme, abAm: "2026-11-05T08:30:00.000Z" }).primaer.aktion).toBe("nachricht_schreiben");
  });

  it("Durchgeführt ohne Rechnung: Rechnung erstellen", () => {
    expect(dock({ stageCategory: "done_unpaid" }).primaer).toEqual({ aktion: "rechnung_erstellen", label: "Rechnung erstellen" });
  });

  it("Rechnung mit Rest: Zahlung erfassen; Rest 0 oder unbekannt nicht", () => {
    const rechnung = { am: "2026-11-22T10:00:00.000Z", faelligAm: "2026-12-06" };
    expect(dock({ stageCategory: "booked", rechnung }).primaer).toEqual({ aktion: "zahlung_erfassen", label: "Zahlung erfassen" });
    expect(dock({ stageCategory: "booked", rechnung, rest: { restCent: 0, quelle: "angebot" } }).primaer.aktion).toBe("nachricht_schreiben");
    expect(dock({ stageCategory: "booked", rechnung, rest: { restCent: null, quelle: "stunden" } }).primaer.aktion).toBe(
      "nachricht_schreiben"
    );
  });

  it("Durchgeführt oder Bezahlt ohne Bewertungsanfrage: Bewertung anfragen; angefragt: Nachricht schreiben", () => {
    const rechnung = { am: "2026-11-22T10:00:00.000Z", faelligAm: null };
    const bezahlt = { rest: { restCent: 0, quelle: "annahme" }, rechnung };
    expect(dock({ stageCategory: "done_unpaid", ...bezahlt }).primaer).toEqual({ aktion: "bewertung_anfragen", label: "Bewertung anfragen" });
    expect(dock({ stageCategory: "paid", ...bezahlt }).primaer.aktion).toBe("bewertung_anfragen");
    expect(
      dock({ stageCategory: "paid", ...bezahlt, bewertung: { status: "sent_whatsapp", am: "2026-11-23T10:00:00.000Z" } }).primaer.aktion
    ).toBe("nachricht_schreiben");
    // Rechnung mit Rest geht vor der Bewertung.
    expect(dock({ stageCategory: "done_unpaid", rechnung }).primaer.aktion).toBe("zahlung_erfassen");
  });

  it("sonst Nachricht schreiben (Mockup: KV gesendet, kein Entwurf)", () => {
    expect(dock({}).primaer).toEqual({ aktion: "nachricht_schreiben", label: "Nachricht schreiben" });
  });

  it("abErlaubt nur mit Annahme; rechnungErlaubt bei Geplant, Durchgeführt, Bezahlt", () => {
    expect(dock({}).abErlaubt).toBe(false);
    expect(dock({ annahme: { am: "2026-11-05T08:00:00.000Z", unterschriftAm: null } }).abErlaubt).toBe(true);
    const erlaubt = (stageCategory: string | null) => dock({ stageCategory }).rechnungErlaubt;
    expect(["booked", "done_unpaid", "paid"].map(erlaubt)).toEqual([true, true, true]);
    expect(["open_new", "open_engaged", "quoted", "lost", "kein_lead", null].map(erlaubt)).toEqual([false, false, false, false, false, false]);
  });
});

describe("stufenTon", () => {
  it("blau, gold, jade, sonst grau", () => {
    expect(stufenTon("open_new")).toBe("blau");
    expect(stufenTon("open_engaged")).toBe("blau");
    expect(stufenTon("quoted")).toBe("gold");
    expect(stufenTon("booked")).toBe("jade");
    expect(stufenTon("done_unpaid")).toBe("jade");
    expect(stufenTon("paid")).toBe("jade");
    expect(stufenTon("lost")).toBe("grau");
    expect(stufenTon("kein_lead")).toBe("grau");
    expect(stufenTon(null)).toBe("grau");
  });
});

describe("ortAus", () => {
  it("LocationValue: city", () => {
    expect(ortAus({ line1: "Rotebühlstr. 112", postcode: "70178", city: "Stuttgart-West" })).toBe("Stuttgart-West");
    expect(ortAus({ line1: "Rotebühlstr. 112", city: "  Esslingen  " })).toBe("Esslingen");
  });

  it("Freitext: Ort nach der Postleitzahl", () => {
    expect(ortAus("Rotebühlstr. 112, 70178 Stuttgart")).toBe("Stuttgart");
    expect(ortAus("70178 Stuttgart-West")).toBe("Stuttgart-West");
    expect(ortAus("Hauptstr. 1, 73728 Esslingen am Neckar, Deutschland")).toBe("Esslingen am Neckar");
  });

  it("LocationValue ohne city: Freitext in line1", () => {
    expect(ortAus({ line1: "Rotebühlstr. 112, 70178 Stuttgart" })).toBe("Stuttgart");
  });

  it("nichts Verwertbares: null", () => {
    expect(ortAus(null)).toBeNull();
    expect(ortAus(undefined)).toBeNull();
    expect(ortAus("")).toBeNull();
    expect(ortAus("Rotebühlstr. 112")).toBeNull();
    expect(ortAus({ line1: "Rotebühlstr. 112" })).toBeNull();
    expect(ortAus(42)).toBeNull();
  });
});

describe("Kopf-Helfer", () => {
  it("artAus: Leistung und Zimmer", () => {
    expect(artAus("move", 3)).toBe("Umzug, 3 Zimmer");
    expect(artAus("move", null)).toBe("Umzug");
    expect(artAus("clearance", 2)).toBe("Entrümpelung, 2 Zimmer");
    expect(artAus("clearance_move", 4)).toBe("Entrümpelung und Umzug, 4 Zimmer");
    expect(artAus("kitchen_installation", 3)).toBe("Küchenmontage");
    expect(artAus("move", 0)).toBe("Umzug");
    expect(artAus("move", 2.5)).toBe("Umzug, 2,5 Zimmer");
  });

  it("streckeAus: von nach, ohne Ziel nur der Ort", () => {
    expect(streckeAus("Stuttgart-West", "Esslingen")).toBe("Stuttgart-West nach Esslingen");
    expect(streckeAus("Stuttgart-West", null)).toBe("Stuttgart-West");
    expect(streckeAus(null, "Esslingen")).toBe("nach Esslingen");
    expect(streckeAus(null, null)).toBe("");
  });

  it("metaAus: Quelle, Firma, Lead seit", () => {
    expect(metaAus("Kleinanzeigen", "Kottke", "2026-11-03T08:14:00.000Z")).toBe("Über Kleinanzeigen · Kottke · Lead seit Di 03.11.");
    expect(metaAus(null, null, "2026-11-03T08:14:00.000Z")).toBe("Lead seit Di 03.11.");
  });

  it("kuerzelAus: erste Buchstaben von Vor- und Nachname", () => {
    expect(kuerzelAus("Max Kottke")).toBe("MK");
    expect(kuerzelAus("tim von schulz")).toBe("TS");
    expect(kuerzelAus("  Ali  ")).toBe("A");
    expect(kuerzelAus("Özil Ünal")).toBe("ÖÜ");
    expect(kuerzelAus("")).toBe("");
  });

  it("volumenHerkunftAus: Fotos, Chat, von Hand, Kalkulation", () => {
    expect(volumenHerkunftAus({ quelle: "inventar", inventarQuellen: ["foto", "chat"] }, 14)).toBe("aus 14 Fotos und Chat");
    expect(volumenHerkunftAus({ quelle: "inventar", inventarQuellen: ["chat"] }, 14)).toBe("aus Chat");
    expect(volumenHerkunftAus({ quelle: "inventar", inventarQuellen: ["foto"] }, 1)).toBe("aus 1 Foto");
    expect(volumenHerkunftAus({ quelle: "inventar", inventarQuellen: ["foto"] }, 0)).toBe("aus Fotos");
    expect(volumenHerkunftAus({ quelle: "inventar", inventarQuellen: ["operator", "foto", "chat"] }, 14)).toBe(
      "aus 14 Fotos, Chat und Angaben von Hand"
    );
    expect(volumenHerkunftAus({ quelle: "kalkulation", inventarQuellen: [] }, 14)).toBe("aus der Kalkulation");
    expect(volumenHerkunftAus({ quelle: null, inventarQuellen: [] }, 14)).toBeNull();
  });
});
