import { describe, expect, it } from "vitest";
import type { LeadContext } from "./deal-doc-data";
import { kvVorpruefung, type KvHinweisDaten } from "./kv-vorpruefung";
import { addressStringToLocationValue, alsOrtWert } from "./adresse";

function ctx(over: Partial<LeadContext> = {}): LeadContext {
  return {
    name: "Beatrice Fallscheer",
    person_name: null,
    person_vorname: null,
    person_nachname: null,
    move_date: "2026-11-02",
    move_from_address: { line1: "Hauptstr. 1", postcode: "72218", city: "Wildberg" },
    move_to_address: { line1: "Bahnhofstr. 5", postcode: "75365", city: "Calw" },
    floors_from: null,
    floors_to: null,
    elevator_from: null,
    elevator_to: null,
    inventory_notes: null,
    operating_company: { id: "oc1", displayName: "Kottke Dienstleistungen" },
    ...over,
  };
}
const daten = (over: Partial<KvHinweisDaten> = {}): KvHinweisDaten => ({
  umzugsgutAnzahl: 12,
  fotosOffen: 0,
  fotosGescheitert: 0,
  hatAngebot: true,
  festpreisCents: null,
  conversationId: "conv-1",
  ...over,
});

describe("kvVorpruefung", () => {
  it("vollständiger Auftrag: bereit, keine Hinweise", () => {
    const r = kvVorpruefung({ ctx: ctx(), daten: daten(), documentType: "KV" });
    expect(r.bereit).toBe(true);
    expect(r.felder.every((f) => !f.fehlt)).toBe(true);
    expect(r.hinweise).toEqual([]);
  });
  it("fehlende Adresse und Datum: nicht bereit, Felder markiert, Rest vorausgefüllt", () => {
    const r = kvVorpruefung({ ctx: ctx({ move_from_address: null, move_date: null }), daten: daten(), documentType: "KV" });
    expect(r.bereit).toBe(false);
    expect(r.felder.find((f) => f.feld === "auszug")).toMatchObject({ fehlt: true, wert: "" });
    expect(r.felder.find((f) => f.feld === "datum")).toMatchObject({ fehlt: true });
    expect(r.felder.find((f) => f.feld === "einzug")).toMatchObject({ fehlt: false, wert: "Bahnhofstr. 5, 75365 Calw" });
    expect(r.felder.find((f) => f.feld === "kundenname")).toMatchObject({ fehlt: false, wert: "Beatrice Fallscheer" });
  });
  it("ohne Lead-Kontext: alles fehlt, Firma fehlt", () => {
    const r = kvVorpruefung({ ctx: null, daten: null, documentType: "KV" });
    expect(r.bereit).toBe(false);
    expect(r.firmaFehlt).toBe(true);
    expect(r.felder.every((f) => f.fehlt)).toBe(true);
  });
  it("leeres Umzugsgut mit laufender Foto-Auswertung: Hinweis, blockiert nicht", () => {
    const r = kvVorpruefung({ ctx: ctx(), daten: daten({ umzugsgutAnzahl: 0, fotosOffen: 7 }), documentType: "KV" });
    expect(r.bereit).toBe(true);
    expect(r.hinweise).toEqual([{ art: "umzugsgut", text: "Umzugsgut ist noch leer, 7 Fotos werden gerade ausgewertet." }]);
  });
  it("nur Festpreis bei Kottke: Pauschale-Hinweis; bei Ceylan nicht", () => {
    const k = kvVorpruefung({ ctx: ctx(), daten: daten({ festpreisCents: 172000 }), documentType: "KV" });
    expect(k.hinweise.map((h) => h.art)).toEqual(["preis"]);
    expect(k.hinweise[0].text).toContain("1.720,00");
    const c = kvVorpruefung({
      ctx: ctx({ operating_company: { id: "oc2", displayName: "Ceylan Umzüge & Transporte" } }),
      daten: daten({ festpreisCents: 172000 }),
      documentType: "KV",
    });
    expect(c.hinweise).toEqual([]);
  });
  it("Fotos noch in Arbeit, Umzugsgut schon teilweise da: trotzdem Hinweis", () => {
    const r = kvVorpruefung({ ctx: ctx(), daten: daten({ umzugsgutAnzahl: 5, fotosOffen: 1 }), documentType: "KV" });
    expect(r.hinweise).toEqual([{ art: "umzugsgut", text: "Umzugsgut hat 5 Einträge, 1 Foto wird noch ausgewertet." }]);
  });
  it("Fotos nicht auswertbar: eigener Hinweis, auch neben laufender Auswertung (Fall Jonas)", () => {
    const r = kvVorpruefung({ ctx: ctx(), daten: daten({ umzugsgutAnzahl: 35, fotosOffen: 2, fotosGescheitert: 4 }), documentType: "KV" });
    expect(r.bereit).toBe(true);
    expect(r.hinweise).toEqual([
      { art: "umzugsgut", text: "Umzugsgut hat 35 Einträge, 2 Fotos werden noch ausgewertet." },
      { art: "umzugsgut", text: "4 Fotos konnten nicht ausgewertet werden. Bitte das Umzugsgut mit den Fotos im Posteingang vergleichen." },
    ]);
    const eins = kvVorpruefung({ ctx: ctx(), daten: daten({ umzugsgutAnzahl: 0, fotosGescheitert: 1 }), documentType: "KV" });
    expect(eins.hinweise.map((h) => h.text)).toEqual([
      "Umzugsgut ist leer. Im KV steht dann keine Liste.",
      "1 Foto konnte nicht ausgewertet werden. Bitte das Umzugsgut mit den Fotos im Posteingang vergleichen.",
    ]);
  });
  it("Adresse als Text gespeichert: zählt als vorhanden", () => {
    const r = kvVorpruefung({ ctx: ctx({ move_from_address: "Hauptstr. 1, 72218 Wildberg" }), daten: daten(), documentType: "KV" });
    expect(r.felder.find((f) => f.feld === "auszug")).toMatchObject({ fehlt: false });
  });
  it("AB ohne Angebot: Preis fehlt blockiert; Hinweise nur beim KV", () => {
    const r = kvVorpruefung({ ctx: ctx(), daten: daten({ hatAngebot: false, umzugsgutAnzahl: 0 }), documentType: "AB" });
    expect(r.preisFehlt).toBe(true);
    expect(r.bereit).toBe(false);
    expect(r.hinweise).toEqual([]);
  });
  it("KV braucht vorher kein Angebot", () => {
    expect(kvVorpruefung({ ctx: ctx(), daten: daten({ hatAngebot: false }), documentType: "KV" }).preisFehlt).toBe(false);
  });
});

describe("addressStringToLocationValue", () => {
  it("Straße, PLZ Ort", () => {
    expect(addressStringToLocationValue("Hauptstr. 1, 72218 Wildberg")).toEqual({ line1: "Hauptstr. 1", postcode: "72218", city: "Wildberg" });
  });
  it("PLZ und Ort durch Komma getrennt: Ort geht nicht verloren", () => {
    expect(addressStringToLocationValue("Bahnhofstr. 5, 75365, Calw")).toEqual({ line1: "Bahnhofstr. 5", postcode: "75365", city: "Calw" });
  });
  it("ohne Komma bleibt alles in line1", () => {
    expect(addressStringToLocationValue("Hauptstr. 1 Wildberg")).toEqual({ line1: "Hauptstr. 1 Wildberg" });
  });
});

describe("alsOrtWert", () => {
  it("strukturierte Adresse bleibt erhalten", () => {
    expect(alsOrtWert({ line1: "Hauptstr. 1", postcode: "72218", city: "Wildberg" })).toEqual({ line1: "Hauptstr. 1", postcode: "72218", city: "Wildberg", countryCode: undefined });
  });
  it("Adresse als Text wird zerlegt statt verworfen", () => {
    expect(alsOrtWert("Hauptstr. 1, 72218 Wildberg")).toMatchObject({ line1: "Hauptstr. 1", postcode: "72218", city: "Wildberg" });
  });
  it("leer oder ohne Straße: null", () => {
    expect(alsOrtWert(null)).toBeNull();
    expect(alsOrtWert({ city: "Calw" })).toBeNull();
  });
});

describe("leistungsartVorschlag", () => {
  it("gespeicherte Küche oder Entrümpelung gewinnt", async () => {
    const { leistungsartVorschlag } = await import("./kv-vorpruefung");
    expect(leistungsartVorschlag({ gespeichert: "kitchen_installation", leadType: "entruempelung" })).toBe("kitchen_installation");
    expect(leistungsartVorschlag({ gespeichert: "clearance", leadType: "umzug" })).toBe("clearance");
  });
  it("Entrümpelungs-Anfrage ohne gespeicherte Sonderart: Entrümpelung", async () => {
    const { leistungsartVorschlag } = await import("./kv-vorpruefung");
    expect(leistungsartVorschlag({ gespeichert: "move", leadType: "entruempelung" })).toBe("clearance");
    expect(leistungsartVorschlag({ gespeichert: null, leadType: "Entruempelung" })).toBe("clearance");
  });
  it("sonst Umzug", async () => {
    const { leistungsartVorschlag } = await import("./kv-vorpruefung");
    expect(leistungsartVorschlag({ gespeichert: null, leadType: null })).toBe("move");
    expect(leistungsartVorschlag({ gespeichert: "move", leadType: "fmz" })).toBe("move");
  });
});
