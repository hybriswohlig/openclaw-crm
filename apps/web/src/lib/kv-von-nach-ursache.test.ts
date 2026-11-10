/**
 * KV-Meldung 10.11. (Viktoriia): VON und NACH der Projektübersicht zeigten beide
 * „Westfalenstr. 1, 71640, Ludwigsburg“. Der VPS druckt `auftrag.strecke_von` und
 * `auftrag.strecke_nach`, die `buildDealDataForDocs` 1:1 aus `move_from_address` und
 * `move_to_address` des Leads bildet; kein Rückfall im Dokumentpfad. Stehen im Lead
 * zweimal dieselbe Adresse, ging das bisher ohne jede Prüfung bis in den KV.
 */
import { describe, expect, it, vi } from "vitest";
import { buildDealDataForDocs, type LeadContext } from "./deal-doc-data";
import { gleicheAdresse } from "./adresse";
import { angabenFehlenText, fehlendeVpsAngaben, jobFehlerText } from "./dokument-angaben";
import { kvVorpruefung, EINZUG_GLEICH_TEXT } from "./kv-vorpruefung";
import { vorschlagHinweis } from "./kunde-entwurf";
import { kundeVorschlag, type VorschlagQuellen } from "@/services/kunde-vorschlag";

const auszug = { line1: "Westfalenstr. 1", postcode: "71640", city: "Ludwigsburg" };
function ctx(over: Partial<LeadContext> = {}): LeadContext {
  return {
    name: "Viktoriia Artemchuk",
    person_name: "Viktoriia Artemchuk",
    person_vorname: "Viktoriia",
    person_nachname: "Artemchuk",
    move_date: "2026-11-29",
    move_from_address: auszug,
    move_to_address: { ...auszug },
    floors_from: null,
    floors_to: null,
    elevator_from: null,
    elevator_to: null,
    inventory_notes: null,
    operating_company: { id: "oc1", displayName: "Kottke Dienstleistungen" },
    ...over,
  };
}

describe("Ursache VON = NACH", () => {
  it("der Dokumentpfad gibt das Lead 1:1 weiter: gleiche Lead-Adressen ergeben VON = NACH", () => {
    const deal = buildDealDataForDocs("d1", ctx());
    expect(deal?.auftrag.strecke_von).toBe("Westfalenstr. 1, 71640, Ludwigsburg");
    expect(deal?.auftrag.strecke_nach).toBe(deal?.auftrag.strecke_von);
    // Ohne Einzug im Lead fällt nichts auf den Auszug zurück.
    expect(buildDealDataForDocs("d1", ctx({ move_to_address: null }))?.auftrag.strecke_nach).toBeUndefined();
  });

  it("gleicheAdresse: Schreibweisen zählen nicht, zwei verschiedene Zusätze schon, ohne Straße nie gleich", () => {
    expect(gleicheAdresse(auszug, "Westfalenstraße 1, 71640 Ludwigsburg")).toBe(true);
    expect(gleicheAdresse("Westfalenstr. 1, 71640, Ludwigsburg", "westfalenstr 1, 71640 ludwigsburg")).toBe(true);
    expect(gleicheAdresse(auszug, { ...auszug, line2: "3. OG" })).toBe(true);
    expect(gleicheAdresse({ ...auszug, line2: "EG" }, { ...auszug, line2: "3. OG" })).toBe(false);
    expect(gleicheAdresse(auszug, { ...auszug, line1: "Westfalenstr. 11" })).toBe(false);
    expect(gleicheAdresse({ postcode: "70372", city: "Stuttgart" }, "70372 Stuttgart")).toBe(false);
    expect(gleicheAdresse(null, auszug)).toBe(false);
  });

  it("Server: kein Vorlagen-Job, wenn VON und NACH gleich sind; Fehlertext führt zur Akte", () => {
    const params = { kunde: { nachname: "Artemchuk", adresse: "Westfalenstr. 1, 71640, Ludwigsburg" }, auftrag: { strecke_von: "Westfalenstr. 1, 71640, Ludwigsburg", strecke_nach: "Westfalenstr. 1, 71640, Ludwigsburg" } };
    const fehlt = fehlendeVpsAngaben(params);
    expect(fehlt).toEqual(["einzug_gleich"]);
    const text = angabenFehlenText("KV", fehlt);
    expect(text).toBe("KV nicht erstellt: Einzugsadresse ist gleich der Auszugsadresse. Angaben ergänzen.");
    expect(jobFehlerText(text, "KV").angabenFehlen).toBe(true);
    expect(fehlendeVpsAngaben({ ...params, auftrag: { ...params.auftrag, strecke_nach: "Bahnhofstr. 5, 71032 Böblingen" } })).toEqual([]);
  });

  it("Vorprüfung: Einzug gleich Auszug zählt wie fehlend, mit Grund", () => {
    const p = kvVorpruefung({ ctx: ctx(), daten: null, documentType: "KV" });
    expect(p.bereit).toBe(false);
    expect(p.felder.find((f) => f.feld === "einzug")).toMatchObject({ fehlt: true, grund: EINZUG_GLEICH_TEXT });
    expect(p.felder.find((f) => f.feld === "auszug")?.fehlt).toBe(false);
    const ok = kvVorpruefung({ ctx: ctx({ move_to_address: { line1: "Bahnhofstr. 5", postcode: "71032", city: "Böblingen" } }), daten: null, documentType: "KV" });
    expect(ok.bereit).toBe(true);
  });

  it("Aus dem Chat: nennt die KI dieselbe Adresse für beide Seiten, kein Einzug-Vorschlag, mit Hinweis", async () => {
    const q: VorschlagQuellen = {
      eingang: vi.fn(async () => ({ texte: ["Meine Adresse: Westfalenstr. 1, 71640 Ludwigsburg"], stand: "1:m1" })),
      gespeichert: vi.fn(async () => null),
      speichern: vi.fn(async () => {}),
      ki: vi.fn(async () => ({ move_from_address: "Westfalenstr. 1, 71640 Ludwigsburg", move_to_address: "Westfalenstr. 1, 71640 Ludwigsburg" })),
      kiAnalyse: vi.fn(async () => null),
    };
    const v = await kundeVorschlag("ws", "d1", q);
    expect(v.auszug).toEqual({ strasse: "Westfalenstr. 1", plz: "71640", ort: "Ludwigsburg" });
    expect(v.einzug).toBeNull();
    expect(v.hinweis).toMatch(/dieselbe Adresse/);
    expect(vorschlagHinweis(v, ["auszug"])).toMatch(/Einzugsadresse bitte beim Kunden erfragen/);
  });
});
