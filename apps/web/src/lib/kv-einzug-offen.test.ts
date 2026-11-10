/**
 * Inhaber 10.11.: „Was, wenn ich nicht die ganze Einzugsadresse habe? Manchmal brauche ich
 * sie auch nicht.“ Einzug mit nur PLZ und Ort (oder nur Ort) ist gültig; „Einzug noch offen“
 * druckt bei NACH „wird noch abgestimmt“. Hier der Datenpfad bis zu den VPS-Parametern.
 */
import { describe, expect, it } from "vitest";
import { buildDealDataForDocs, formatLocation, type LeadContext } from "./deal-doc-data";
import { EINZUG_OFFEN_WERT, einzugOffen, gleicheAdresse } from "./adresse";
import { fehlendeVpsAngaben } from "./dokument-angaben";
import { kvVorpruefung } from "./kv-vorpruefung";
import { pruefeKundeEingabe, teileAusOrt, KundeFehler } from "./deal-kunde";
import { aenderungen, entwurfAus, feldLeer, vorschlagEinsetzen } from "./kunde-entwurf";
import { ortText } from "@/services/rechner/lead-daten-helfer";

const auszug = { line1: "Westfalenstr. 1", postcode: "71640", city: "Ludwigsburg" };
const ctx = (move_to_address: unknown): LeadContext => ({
  name: "Viktoriia Artemchuk",
  person_name: "Viktoriia Artemchuk",
  person_vorname: "Viktoriia",
  person_nachname: "Artemchuk",
  move_date: "2026-11-29",
  move_from_address: auszug,
  move_to_address,
  floors_from: null,
  floors_to: null,
  elevator_from: null,
  elevator_to: null,
  inventory_notes: null,
  operating_company: { id: "oc1", displayName: "Kottke Dienstleistungen" },
});

describe("Einzug ohne Straße und „Einzug noch offen“ (Inhaber 10.11.)", () => {
  it.each([
    ["nur PLZ und Ort", { postcode: "71032", city: "Böblingen", countryCode: "DE" }, "71032 Böblingen"],
    ["nur Ort", { postcode: "", city: "Böblingen", countryCode: "DE" }, "Böblingen"],
    ["nur PLZ", { postcode: "71032", city: "", countryCode: "DE" }, "71032"],
    ["PLZ und Ort als Text in line1 (Plan 15)", { line1: "71032 Böblingen" }, "71032 Böblingen"],
    ["noch offen", { ...EINZUG_OFFEN_WERT }, "wird noch abgestimmt"],
  ])("%s: Vorprüfung lässt den KV durch, VPS bekommt strecke_nach als Textzeile", (_, nach, text) => {
    expect(kvVorpruefung({ ctx: ctx(nach), daten: null, documentType: "KV" }).bereit).toBe(true);
    const deal = buildDealDataForDocs("d1", ctx(nach))!;
    expect(deal.auftrag.strecke_nach).toBe(text);
    expect(deal.auftrag.strecke_von).toBe("Westfalenstr. 1, 71640, Ludwigsburg");
    // Server-Prüfung vor dem Vorlagen-Job (/api/tools/run): nichts fehlt, VON ≠ NACH.
    expect(fehlendeVpsAngaben({ kunde: { nachname: "Artemchuk", adresse: deal.kunde.adresse }, auftrag: deal.auftrag })).toEqual([]);
  });

  it("Format mit Straße bleibt wie bisher; ohne Straße nie „gleich“ (Umzug im selben Ort)", () => {
    expect(formatLocation(auszug)).toBe("Westfalenstr. 1, 71640, Ludwigsburg");
    expect(gleicheAdresse({ postcode: "71640", city: "Ludwigsburg" }, { postcode: "71640", city: "Ludwigsburg" })).toBe(false);
    expect(gleicheAdresse(auszug, EINZUG_OFFEN_WERT)).toBe(false);
  });

  it("noch offen: Markierung erkannt, für den Rechner keine Adresse, im Formular kein Einzug", () => {
    expect(einzugOffen(EINZUG_OFFEN_WERT)).toBe(true);
    expect(einzugOffen("wird noch abgestimmt")).toBe(true);
    expect(einzugOffen(auszug)).toBe(false);
    expect(ortText(EINZUG_OFFEN_WERT)).toBeNull();
    expect(ortText({ postcode: "71032", city: "Böblingen" })).toBe("71032 Böblingen");
    expect(teileAusOrt(EINZUG_OFFEN_WERT)).toBeNull();
  });

  it("Eingabe: Einzug nur mit Ort gültig, falsche PLZ nicht; Kundenanschrift braucht weiter die PLZ", () => {
    expect(pruefeKundeEingabe({ einzug: { strasse: "", plz: "", ort: "Böblingen" } }).einzug).toEqual({ strasse: "", plz: "", ort: "Böblingen" });
    expect(() => pruefeKundeEingabe({ einzug: { strasse: "", plz: "7103", ort: "Böblingen" } })).toThrow(KundeFehler);
    // Entscheidung 10.11.: PLZ und/oder Ort, eins reicht; keins von beiden nicht.
    expect(pruefeKundeEingabe({ einzug: { strasse: "", plz: "71032", ort: "" } }).einzug).toEqual({ strasse: "", plz: "71032", ort: "" });
    expect(() => pruefeKundeEingabe({ einzug: { strasse: "Bahnhofstr. 5", plz: "", ort: "" } })).toThrow(/PLZ oder Ort/);
    expect(() => pruefeKundeEingabe({ auszug: { strasse: "", plz: "", ort: "Böblingen" } })).toThrow(/PLZ/);
    expect(pruefeKundeEingabe({ einzugOffen: true }).einzugOffen).toBe(true);
    expect(() => pruefeKundeEingabe({ einzugOffen: true, einzug: { strasse: "", plz: "71032", ort: "Böblingen" } })).toThrow(/entweder/);
  });

  it("Formular: Schalter „noch offen“ gilt als erfüllt und geht ohne Adresse an den Server", () => {
    const k = { personId: null, name: "V A", nameAusPerson: false, telefon: null, email: null, auszug: null, einzug: null, einzugOffen: false, datum: null };
    const e = { ...entwurfAus(k), einzugOffen: true };
    expect(feldLeer(entwurfAus(k), "einzug")).toBe(true);
    expect(feldLeer(e, "einzug")).toBe(false);
    expect(aenderungen(e, k)).toEqual({ einzugOffen: true });
    // Nur Ort genügt.
    const nurOrt = { ...entwurfAus(k), einzug: { strasse: "", plz: "", ort: "Böblingen" } };
    expect(feldLeer(nurOrt, "einzug")).toBe(false);
    expect(feldLeer({ ...entwurfAus(k), einzug: { strasse: "", plz: "71032", ort: "" } }, "einzug")).toBe(false);
    expect(feldLeer({ ...entwurfAus(k), einzug: { strasse: "Bahnhofstr. 5", plz: "", ort: "" } }, "einzug")).toBe(true);
    expect(aenderungen(nurOrt, k)).toEqual({ einzug: { strasse: "", plz: "", ort: "Böblingen" } });
    // Wieder eine Adresse: Schalter aus und Einzug gehen zusammen.
    const offen = { ...k, einzugOffen: true };
    const zurueck = { ...entwurfAus(offen), einzugOffen: false, einzug: { strasse: "Bahnhofstr. 5", plz: "71032", ort: "Böblingen" } };
    expect(aenderungen(zurueck, offen)).toEqual({ einzugOffen: false, einzug: { strasse: "Bahnhofstr. 5", plz: "71032", ort: "Böblingen" } });
    // Ein Einzug aus dem Chat hebt „noch offen“ auf.
    const v = vorschlagEinsetzen(entwurfAus(offen), {
      quelle: "ki", name: null, email: null, telefon: null, auszug: null,
      einzug: { strasse: "Bahnhofstr. 5", plz: "71032", ort: "Böblingen" }, hinweis: null,
    });
    expect(v.entwurf.einzugOffen).toBe(false);
  });
});

describe("Review 10.11.: Zusatz und Markierung an weiteren Stellen", () => {
  it("Umzug im selben Haus (EG nach 3. OG): Strecke mit Zusatz, kein „VON = NACH“", () => {
    const deal = buildDealDataForDocs("d1", { ...ctx({ ...auszug, line2: "3. OG" }), move_from_address: { ...auszug, line2: "EG" } })!;
    expect(deal.auftrag.strecke_von).toBe("Westfalenstr. 1, EG, 71640, Ludwigsburg");
    expect(deal.auftrag.strecke_nach).toBe("Westfalenstr. 1, 3. OG, 71640, Ludwigsburg");
    expect(fehlendeVpsAngaben({ kunde: { nachname: "A", adresse: deal.kunde.adresse }, auftrag: deal.auftrag })).toEqual([]);
  });

  it("Lead-Titel nimmt „wird noch abgestimmt“ nicht als Zielort", async () => {
    const { computeLeadName } = await import("@/services/lead-name");
    const titel = computeLeadName({ customerName: "Viktoriia Artemchuk", moveDate: null, fromAddress: auszug, toAddress: EINZUG_OFFEN_WERT });
    expect(titel ?? "").not.toMatch(/abgestimmt/);
  });
});

