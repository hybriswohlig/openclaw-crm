import { describe, expect, it } from "vitest";
import type { LeadContext } from "@/lib/deal-doc-data";
import type { KvHinweisDaten } from "@/lib/kv-vorpruefung";
import { dokumentStart } from "./dokument-start";

function ctx(over: Partial<LeadContext> = {}): LeadContext {
  return {
    name: "Viktoria",
    person_name: "Viktoria Muster",
    person_vorname: "Viktoria",
    person_nachname: "Muster",
    move_date: "2026-11-28",
    move_from_address: { line1: "Hauptstr. 1", postcode: "72218", city: "Wildberg" },
    move_to_address: { line1: "", postcode: "71032", city: "Böblingen" },
    floors_from: null,
    floors_to: null,
    elevator_from: null,
    elevator_to: null,
    inventory_notes: null,
    operating_company: { id: "oc", displayName: "Kottke Dienstleistungen" },
    ...over,
  };
}
const daten = (over: Partial<KvHinweisDaten> = {}): KvHinweisDaten => ({
  umzugsgutAnzahl: 10,
  fotosOffen: 0,
  hatAngebot: true,
  festpreisCents: null,
  conversationId: null,
  ...over,
});

describe("dokumentStart (Vorprüfung der neuen Oberfläche)", () => {
  it("Viktoria: ohne Auszugsadresse kein Dokumentdialog, sondern „Es fehlen noch Angaben“", () => {
    const s = dokumentStart("d1", ctx({ move_from_address: null }), daten(), "KV");
    expect(s.art).toBe("angaben");
    if (s.art !== "angaben") return;
    expect(s.pruefung.felder.filter((f) => f.fehlt).map((f) => f.feld)).toEqual(["auszug"]);
  });

  it("vollständig: direkt der Dokumentdialog mit Kundenanschrift", () => {
    const s = dokumentStart("d1", ctx(), daten(), "KV");
    expect(s.art).toBe("bereit");
    if (s.art !== "bereit") return;
    expect(s.deal.kunde.adresse).toBe("Hauptstr. 1, 72218, Wildberg");
  });

  it("ohne Firma: Hinweis; AB ohne Angebot: Kalkulation", () => {
    expect(dokumentStart("d1", ctx({ operating_company: null }), daten(), "KV").art).toBe("firma_fehlt");
    expect(dokumentStart("d1", ctx(), daten({ hatAngebot: false }), "AB").art).toBe("preis_fehlt");
    expect(dokumentStart("d1", ctx(), daten({ hatAngebot: false }), "KV").art).toBe("bereit");
  });

  it("ohne Namen: Name abfragen statt Hinweis auf die alte Akte", () => {
    const s = dokumentStart("d1", ctx({ name: null, person_name: null, person_vorname: null, person_nachname: null }), daten(), "RE");
    expect(s.art).toBe("angaben");
  });

  it("leeres Adress-Objekt zählt als fehlend", () => {
    expect(dokumentStart("d1", ctx({ move_from_address: { line1: " " } }), daten(), "KV").art).toBe("angaben");
  });
});
