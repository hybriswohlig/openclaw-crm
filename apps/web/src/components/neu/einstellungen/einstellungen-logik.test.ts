import { describe, expect, it } from "vitest";
import { ZAHLUNGSREGEL_STANDARD } from "@/lib/geld";
import type { RechnerStammdaten, TarifAnsicht } from "@/lib/einstellungen-uebersicht";
import {
  bewertungModusGesperrt,
  gleich,
  googleRueckfrage,
  portalRueckfrage,
  speichernAktiv,
  tagespreiseGesperrt,
  zahlFeld,
  zahlungAusEntwurf,
  zahlungEntwurfAus,
  zahlungRueckfrage,
  zeitpostenAusEntwurf,
  zeitpostenVerschieben,
} from "./einstellungen-logik";
import { FIXTURE_ADMIN } from "./einstellungen.fixture";
import { portalAenderung } from "./firma-portal";
import { mieteText, tarifFuerFirma } from "./rechner-abschnitt";
import { RUECKFRAGE } from "./texte";

describe("Formular-Zustand „geändert“", () => {
  it("vergleicht tief und ignoriert undefined-Felder", () => {
    expect(gleich({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(gleich({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(gleich([1, 2], [2, 1])).toBe(false);
    expect(gleich({ a: 1 }, { a: "1" })).toBe(false);
  });

  it("Speichern nur bei Änderung, ohne Fehler und nicht während des Laufs", () => {
    expect(speichernAktiv({ a: 1 }, { a: 1 }, null, false)).toBe(false);
    expect(speichernAktiv({ a: 1 }, { a: 2 }, null, false)).toBe(true);
    expect(speichernAktiv({ a: 1 }, { a: 2 }, "Fehler", false)).toBe(false);
    expect(speichernAktiv({ a: 1 }, { a: 2 }, null, true)).toBe(false);
  });
});

describe("Zahlung", () => {
  it("prüft Felder wie pruefeZahlungsregel", () => {
    expect(zahlFeld("0", 0, 60)).toBe(0);
    expect(zahlFeld("61", 0, 60)).toBeNull();
    expect(zahlFeld("1,5", 0, 60)).toBeNull();
    expect(zahlFeld("", 1, 60)).toBeNull();
    const e = zahlungEntwurfAus(ZAHLUNGSREGEL_STANDARD);
    expect(zahlungAusEntwurf(e)).toEqual({ ok: true, regel: ZAHLUNGSREGEL_STANDARD });
    expect(zahlungAusEntwurf({ ...e, erinnerungTage: "0" })).toEqual({ ok: false, feld: "erinnerungTage" });
  });

  it("fragt nur beim Einschalten der Erinnerung", () => {
    const an = { ...ZAHLUNGSREGEL_STANDARD, erinnerungModus: "entwurf" as const };
    expect(zahlungRueckfrage(ZAHLUNGSREGEL_STANDARD, an)).toBe("erinnerung");
    expect(zahlungRueckfrage(an, ZAHLUNGSREGEL_STANDARD)).toBeNull();
    expect(zahlungRueckfrage(ZAHLUNGSREGEL_STANDARD, { ...ZAHLUNGSREGEL_STANDARD, tage: 14 })).toBeNull();
  });
});

describe("Sperren", () => {
  const portal = { enabled: true, signatureEnabled: false, angebotAusKalkulation: false, tagespreiseEnabled: false };

  it("Tagespreise gesperrt ohne Angebot aus Kalkulation, Ausschalten bleibt möglich", () => {
    expect(tagespreiseGesperrt(portal)).toBe(true);
    expect(tagespreiseGesperrt({ ...portal, angebotAusKalkulation: true })).toBe(false);
    expect(tagespreiseGesperrt({ ...portal, tagespreiseEnabled: true })).toBe(false);
  });

  it("Bewertung Entwurf und Senden ohne gültigen Google-Link gesperrt, Aus nie", () => {
    expect(bewertungModusGesperrt("entwurf", null)).toBe(true);
    expect(bewertungModusGesperrt("senden", "kein link")).toBe(true);
    expect(bewertungModusGesperrt("aus", null)).toBe(false);
    expect(bewertungModusGesperrt("senden", "https://g.page/r/x/review")).toBe(false);
  });
});

describe("Rückfragen", () => {
  it("Portal: Einschalten fragt, Ausschalten nicht", () => {
    expect(portalRueckfrage("signatureEnabled", true)).toBe("unterschrift");
    expect(portalRueckfrage("angebotAusKalkulation", true)).toBe("angebotAusKalkulation");
    expect(portalRueckfrage("tagespreiseEnabled", true)).toBe("tagespreise");
    expect(portalRueckfrage("tagespreiseEnabled", false)).toBeNull();
  });

  it("Google-Link: neu oder geändert fragt, gleich oder leer nicht", () => {
    expect(googleRueckfrage(null, "https://g.page/r/x")).toBe("googleLink");
    expect(googleRueckfrage("https://a", " https://a ")).toBeNull();
    expect(googleRueckfrage("https://a", "")).toBeNull();
  });

  it("jede Rückfrage hat Titel, einen Satz und Knopf, ohne Gedankenstrich", () => {
    for (const t of Object.values(RUECKFRAGE)) {
      expect(t.titel.length).toBeGreaterThan(0);
      expect(t.knopf.length).toBeGreaterThan(0);
      expect(`${t.titel} ${t.text}`).not.toMatch(/ [–—] /);
    }
  });

  it("portalAenderung schickt nur geänderte Schalter", () => {
    const a = { enabled: true, signatureEnabled: false, angebotAusKalkulation: true, tagespreiseEnabled: true };
    expect(portalAenderung(a, { ...a, angebotAusKalkulation: false, tagespreiseEnabled: false })).toEqual({
      angebotAusKalkulation: false,
      tagespreiseEnabled: false,
    });
    expect(portalAenderung(a, a)).toEqual({});
  });
});

describe("Zeitposten", () => {
  it("hoch und runter, am Rand unverändert", () => {
    expect(zeitpostenVerschieben(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(zeitpostenVerschieben(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(zeitpostenVerschieben(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(zeitpostenVerschieben(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });

  it("prüft Bezeichnung, Minuten und Höchstzahl; Hinweis nur wenn gesetzt", () => {
    const z = { id: "zp-1", bezeichnung: " Klavier ", minuten: "90", hinweis: "" };
    expect(zeitpostenAusEntwurf([z])).toEqual({ ok: true, liste: [{ id: "zp-1", bezeichnung: "Klavier", minuten: 90 }] });
    expect(zeitpostenAusEntwurf([{ ...z, hinweis: " oben " }])).toEqual({
      ok: true,
      liste: [{ id: "zp-1", bezeichnung: "Klavier", minuten: 90, hinweis: "oben" }],
    });
    expect(zeitpostenAusEntwurf([{ ...z, bezeichnung: "" }])).toMatchObject({ ok: false, index: 0 });
    expect(zeitpostenAusEntwurf([{ ...z, minuten: "601" }])).toMatchObject({ ok: false, index: 0 });
    const viele = Array.from({ length: 51 }, (_, i) => ({ ...z, id: `zp-${i + 1}` }));
    expect(zeitpostenAusEntwurf(viele)).toMatchObject({ ok: false, fehler: "Höchstens 50 Zeitposten." });
  });
});

describe("Rechner-Abschnitt", () => {
  const tarif = (id: string, marke: TarifAnsicht["marke"], aktiv: boolean): TarifAnsicht => ({
    id,
    version: 1,
    marke,
    aktiv,
    gueltigAb: null,
    kommentar: null,
    satzArbeit: null,
    satzFahrt: null,
    stundensatzIntern: 30,
    stundensatzVerkauf: 59,
    fahrzeugpauschaleVerkaufProTag: 100,
    kmSatzVerkauf: 1,
    gemeinkostenProzent: null,
    versicherungPauschal: null,
    rundungEur: 10,
    halteverbotVerkauf: 150,
    entsorgungProCbmVerkauf: 40,
    material: [],
  });

  it("Firma ohne Marke bekommt den gemeinsamen aktiven Tarif", () => {
    const g = tarif("g", null, true);
    const k = tarif("k", "kottke", true);
    const d: RechnerStammdaten = { tarif: { kottke: k, ceylan: g }, versionen: [k, g, tarif("alt", null, false)], stationen: [], fahrzeuge: [], stand: "" };
    expect(tarifFuerFirma(d, "kottke")?.id).toBe("k");
    expect(tarifFuerFirma(d, "ceylan")?.id).toBe("g");
    expect(tarifFuerFirma(d, null)?.id).toBe("g");
  });

  it("Miete je Wochentag oder je Tag", () => {
    const basis = { id: "f", name: "S", typ: "", stationId: "s", stationName: null, laderaumCbm: 10, inklusivKmProTag: null, mehrkilometerPreis: null, tagespauschale: null, aktiv: true };
    expect(mieteText({ ...basis, mietpreisProTag: 89, mietpreisWochentage: null })).toMatch(/89,00\s€ je Tag/);
    expect(mieteText({ ...basis, mietpreisProTag: null, mietpreisWochentage: null })).toBe("–");
    const wt = { mo: 1, di: 2, mi: 3, do: 4, fr: 5, sa: 6, so: 7 };
    expect(mieteText({ ...basis, mietpreisProTag: null, mietpreisWochentage: wt })).toMatch(/^Mo 1,00\s€, Di/);
  });
});

describe("Fixture", () => {
  it("Admin-Fixture hat eine Firma ohne Google-Link und Tagespreise nur mit Angebot", () => {
    const ohne = FIXTURE_ADMIN.firmen!.filter((f) => !f.googleReviewUrl);
    expect(ohne).toHaveLength(1);
    for (const f of FIXTURE_ADMIN.firmen!) if (f.portal.tagespreiseEnabled) expect(f.portal.angebotAusKalkulation).toBe(true);
  });
});
