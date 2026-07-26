import { describe, it, expect } from "vitest";
import {
  buildDealDataForDocs,
  resolveCustomerNameForDocs,
  stripLeadTitleDecorations,
  type LeadContext,
} from "./deal-doc-data";

function baseCtx(over: Partial<LeadContext> = {}): LeadContext {
  return {
    name: null,
    person_name: null,
    person_vorname: null,
    person_nachname: null,
    move_date: "2026-08-01",
    move_from_address: { line1: "Hauptstr. 1", postcode: "72250", city: "Freudenstadt" },
    move_to_address: { line1: "Nebengasse 2", postcode: "70173", city: "Stuttgart" },
    floors_from: 2,
    floors_to: 0,
    elevator_from: null,
    elevator_to: null,
    inventory_notes: null,
    operating_company: { id: "oc1", displayName: "Kottke Dienstleistungen" },
    ...over,
  };
}

describe("stripLeadTitleDecorations", () => {
  it("strips city-route suffix from computeLeadName titles", () => {
    expect(stripLeadTitleDecorations("Kyra Hiker — Freudenstadt → Stuttgart")).toBe(
      "Kyra Hiker"
    );
  });

  it("strips date suffix", () => {
    expect(stripLeadTitleDecorations("Kyra Hiker — 01.08.2026")).toBe("Kyra Hiker");
  });

  it("leaves a plain name alone", () => {
    expect(stripLeadTitleDecorations("Kyra Hiker")).toBe("Kyra Hiker");
  });
});

describe("resolveCustomerNameForDocs", () => {
  it("prefers structured person name over lead title", () => {
    const r = resolveCustomerNameForDocs(
      baseCtx({
        name: "Kyra Hiker Freudenstadt",
        person_name: "Kyra Hiker",
        person_vorname: "Kyra",
        person_nachname: "Hiker",
      })
    );
    expect(r).toEqual({ vorname: "Kyra", nachname: "Hiker" });
  });

  it("uses person full name when structured parts are missing", () => {
    const r = resolveCustomerNameForDocs(
      baseCtx({
        name: "Kyra Hiker — Freudenstadt → Stuttgart",
        person_name: "Kyra Hiker",
      })
    );
    expect(r).toEqual({ vorname: "Kyra", nachname: "Hiker" });
  });

  it("falls back to cleaned lead title when no person is linked", () => {
    const r = resolveCustomerNameForDocs(
      baseCtx({
        name: "Kyra Hiker — Freudenstadt → Stuttgart",
      })
    );
    expect(r).toEqual({ vorname: "Kyra", nachname: "Hiker" });
  });

  it("does not invent a name when nothing is available", () => {
    expect(resolveCustomerNameForDocs(baseCtx())).toBeNull();
  });
});

describe("buildDealDataForDocs", () => {
  it("puts the person name into kunde, not the lead title", () => {
    const data = buildDealDataForDocs(
      "deal-1",
      baseCtx({
        name: "Kyra Hiker Freudenstadt",
        person_name: "Kyra Hiker",
        person_vorname: "Kyra",
        person_nachname: "Hiker",
      })
    );
    expect(data?.kunde).toEqual({
      vorname: "Kyra",
      nachname: "Hiker",
      adresse: "Hauptstr. 1, 72250, Freudenstadt",
    });
  });

  it("returns null without firma or customer name", () => {
    expect(
      buildDealDataForDocs("deal-1", baseCtx({ operating_company: null, name: "X" }))
    ).toBeNull();
    expect(
      buildDealDataForDocs(
        "deal-1",
        baseCtx({ name: null, person_name: null, operating_company: { id: "oc1", displayName: "Kottke" } })
      )
    ).toBeNull();
  });
});
