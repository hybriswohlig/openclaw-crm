import { describe, expect, it } from "vitest";
import { buildDealDataForDocs, formatLocation, type LeadContext } from "./deal-doc-data";
import { kvVorpruefung } from "./kv-vorpruefung";

/**
 * Ursache „Kostenvoranschlag fehlgeschlagen, Viktoria: skill exited with code 2.
 * stderr tail: Kundenanschrift fehlt.“ (10.11.), nachgebaut ohne Produktionsdaten.
 *
 * Lage wie bei Viktoria nach Plan 15: Person verknüpft, Firma Kottke, Kalkulation
 * gesperrt, aber im Lead keine Auszugsadresse (die Kalkulation rechnete mit einer
 * Chat-Adresse, die nie ins Lead übernommen wurde).
 */
function viktoria(over: Partial<LeadContext> = {}): LeadContext {
  return {
    name: "Viktoria",
    person_name: "Viktoria Muster",
    person_vorname: "Viktoria",
    person_nachname: "Muster",
    move_date: "2026-11-28",
    move_from_address: null,
    move_to_address: null,
    floors_from: null,
    floors_to: null,
    elevator_from: null,
    elevator_to: null,
    inventory_notes: null,
    operating_company: { id: "oc-kottke", displayName: "Kottke Dienstleistungen" },
    ...over,
  };
}

describe("Ursache: Kundenanschrift fehlt", () => {
  it("die Kundenanschrift im VPS-Auftrag kommt nur aus move_from_address des Leads", () => {
    const deal = buildDealDataForDocs("deal-v", viktoria());
    // Der Dokumentdialog der neuen Oberfläche prüfte nur „deal !== null“ (Firma + Name) …
    expect(deal).not.toBeNull();
    // … und schickte den Job ohne Anschrift los: daran bricht die Vorlage ab.
    expect(deal!.kunde.adresse).toBeUndefined();
    expect(deal!.auftrag.strecke_von).toBeUndefined();
    // Die Vorprüfung der alten Oberfläche hätte das abgefangen.
    const p = kvVorpruefung({ ctx: viktoria(), daten: null, documentType: "KV" });
    expect(p.bereit).toBe(false);
    expect(p.felder.find((f) => f.feld === "auszug")?.fehlt).toBe(true);
  });

  it("eine Adresse der verknüpften Person zählt für die VPS-Vorlage nicht", () => {
    // LeadContext kennt die Personen-Adresse gar nicht: nur der Lead zählt.
    const deal = buildDealDataForDocs("deal-v", viktoria());
    expect(Object.keys(deal!.kunde)).not.toContain("location");
  });

  it("leere Adress-Objekte gelten als fehlend, nicht als leere Anschrift", () => {
    expect(formatLocation({ line1: "", postcode: "", city: "" })).toBe("—");
    const deal = buildDealDataForDocs("deal-v", viktoria({ move_from_address: { line1: "" } }));
    expect(deal!.kunde.adresse).toBeUndefined();
  });

  it("mit Auszugsadresse im Lead geht die Anschrift mit", () => {
    const deal = buildDealDataForDocs(
      "deal-v",
      viktoria({ move_from_address: { line1: "Hauptstr. 1", postcode: "72218", city: "Wildberg" } })
    );
    expect(deal!.kunde.adresse).toBe("Hauptstr. 1, 72218, Wildberg");
  });
});
