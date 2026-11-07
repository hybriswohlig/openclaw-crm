import { describe, expect, it } from "vitest";
import { NEUER_LEAD_TEXT } from "@/lib/handy-links";
import { leeresFormular, neuerLeadErgebnis, neuerLeadKoerper, QUELLE_VORGABE } from "./neuer-lead-logik";

const gut = { name: "Frau Muster", telefon: "0170 1234567", email: "", firmaId: "f1", quelle: "Telefon", umzugsdatum: "" };

describe("leeresFormular", () => {
  it("belegt die Firma nur bei genau einer vor, Quelle immer Telefon", () => {
    expect(leeresFormular([{ id: "f1", name: "Kottke" }]).firmaId).toBe("f1");
    expect(leeresFormular([{ id: "f1", name: "Kottke" }, { id: "f2", name: "Ceylan" }]).firmaId).toBe("");
    expect(leeresFormular([]).quelle).toBe(QUELLE_VORGABE);
  });
});

describe("neuerLeadKoerper", () => {
  it("lässt gültige Eingaben durch und hängt die Wahl an", () => {
    expect(neuerLeadKoerper(gut, null)).toEqual({ ok: true, koerper: { ...gut, personWahl: null } });
    expect(neuerLeadKoerper(gut, { art: "bestehend", personId: "p1" })).toEqual({
      ok: true,
      koerper: { ...gut, personWahl: { art: "bestehend", personId: "p1" } },
    });
  });

  it("meldet Pflichtfelder wie die Route", () => {
    expect(neuerLeadKoerper({ ...gut, name: "" }, null)).toEqual({ ok: false, feld: "name", text: NEUER_LEAD_TEXT.name });
    expect(neuerLeadKoerper({ ...gut, telefon: "" }, null)).toEqual({ ok: false, feld: "kontakt", text: NEUER_LEAD_TEXT.kontakt });
    expect(neuerLeadKoerper({ ...gut, firmaId: "" }, null)).toEqual({ ok: false, feld: "firma", text: NEUER_LEAD_TEXT.firma });
    expect(neuerLeadKoerper({ ...gut, quelle: "" }, null)).toEqual({ ok: false, feld: "quelle", text: NEUER_LEAD_TEXT.quelle });
    expect(neuerLeadKoerper({ ...gut, email: "x@" }, null).ok).toBe(false);
  });
});

describe("neuerLeadErgebnis", () => {
  it("201 führt zur Akte", () => {
    expect(neuerLeadErgebnis(201, { data: { ok: true, dealRecordId: "d1", personRecordId: "p1" } })).toEqual({
      art: "fertig",
      dealRecordId: "d1",
    });
  });

  it("409 zeigt die Treffer", () => {
    expect(neuerLeadErgebnis(409, { error: { code: "RUECKFRAGE" }, treffer: [{ id: "p1", name: "Anna" }, { id: 2 }] })).toEqual({
      art: "rueckfrage",
      treffer: [{ id: "p1", name: "Anna" }],
    });
  });

  it("400 mit Feld markiert das Feld", () => {
    expect(neuerLeadErgebnis(400, { error: { code: "UNGUELTIG", feld: "firma", message: NEUER_LEAD_TEXT.firma } })).toEqual({
      art: "feld",
      feld: "firma",
      text: NEUER_LEAD_TEXT.firma,
    });
    expect(neuerLeadErgebnis(400, { error: { feld: "quatsch", message: "x" } })).toEqual({ art: "fehler", text: "x" });
  });

  it("andere Fehler mit Meldung", () => {
    expect(neuerLeadErgebnis(403, {})).toEqual({ art: "fehler", text: "Keine Berechtigung zum Anlegen." });
    expect(neuerLeadErgebnis(0, null)).toEqual({ art: "fehler", text: "Keine Verbindung zum Server." });
    expect(neuerLeadErgebnis(500, { error: { message: "kaputt" } })).toEqual({ art: "fehler", text: "kaputt" });
    expect(neuerLeadErgebnis(201, { data: {} }).art).toBe("fehler");
  });
});
