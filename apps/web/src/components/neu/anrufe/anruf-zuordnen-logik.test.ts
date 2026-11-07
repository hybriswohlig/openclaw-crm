import { describe, expect, it } from "vitest";
import type { AnrufDialogLage } from "@/lib/handy-links";
import { lageNachKonflikt, zuordnenErgebnis, zuordnenKoerper, zuordnenTitel, ZUORDNEN_TEXT } from "./anruf-zuordnen-logik";

const anna = { id: "p1", name: "Anna" };
const bert = { id: "p2", name: "Bert" };
const l1 = { id: "d1", name: "Umzug 1" };
const l2 = { id: "d2", name: "Umzug 2" };
const leer = { personId: null, lead: null, name: "" };

describe("zuordnenKoerper", () => {
  const personWaehlen: AnrufDialogLage = { art: "person_waehlen", treffer: [anna, bert] };
  it("person_waehlen schickt nur eine personId aus den Treffern", () => {
    expect(zuordnenKoerper(personWaehlen, { ...leer, personId: "p2" }, null)).toEqual({ ok: true, koerper: { personId: "p2" } });
    expect(zuordnenKoerper(personWaehlen, { ...leer, personId: "p9" }, null)).toEqual({ ok: false, text: ZUORDNEN_TEXT.person });
    expect(zuordnenKoerper(personWaehlen, leer, null)).toEqual({ ok: false, text: ZUORDNEN_TEXT.person });
  });

  const leadWaehlen: AnrufDialogLage = { art: "lead_waehlen", person: anna, leads: [l1, l2] };
  it("lead_waehlen schickt dealId oder neuerLead, mit früher gewählter Person", () => {
    expect(zuordnenKoerper(leadWaehlen, { ...leer, lead: "d2" }, null)).toEqual({ ok: true, koerper: { dealId: "d2" } });
    expect(zuordnenKoerper(leadWaehlen, { ...leer, lead: "neu" }, null)).toEqual({ ok: true, koerper: { neuerLead: true } });
    expect(zuordnenKoerper(leadWaehlen, { ...leer, lead: "d2" }, "p1")).toEqual({ ok: true, koerper: { dealId: "d2", personId: "p1" } });
    expect(zuordnenKoerper(leadWaehlen, { ...leer, lead: "d9" }, null)).toEqual({ ok: false, text: ZUORDNEN_TEXT.lead });
    expect(zuordnenKoerper(leadWaehlen, leer, null)).toEqual({ ok: false, text: ZUORDNEN_TEXT.lead });
  });

  it("an_lead bestätigt ohne Wahl", () => {
    expect(zuordnenKoerper({ art: "an_lead", person: anna, lead: l1 }, leer, null)).toEqual({ ok: true, koerper: {} });
  });

  it("neuer_lead ohne Person braucht einen Namen", () => {
    const lage: AnrufDialogLage = { art: "neuer_lead", person: null };
    expect(zuordnenKoerper(lage, { ...leer, name: "  Frau  Muster " }, null)).toEqual({ ok: true, koerper: { name: "Frau Muster" } });
    expect(zuordnenKoerper(lage, { ...leer, name: "0170 123" }, null)).toEqual({ ok: false, text: ZUORDNEN_TEXT.name });
    expect(zuordnenKoerper(lage, leer, null)).toEqual({ ok: false, text: ZUORDNEN_TEXT.name });
  });

  it("neuer_lead mit Person schickt keinen Namen", () => {
    expect(zuordnenKoerper({ art: "neuer_lead", person: anna }, { ...leer, name: "egal" }, null)).toEqual({ ok: true, koerper: {} });
  });

  it("keiner ergibt nie eine Anfrage", () => {
    expect(zuordnenKoerper({ art: "keiner" }, leer, null)).toEqual({ ok: false, text: ZUORDNEN_TEXT.keiner });
  });
});

describe("lageNachKonflikt und zuordnenErgebnis", () => {
  it("409 mit mehreren Leads ersetzt die Lage durch Lead wählen", () => {
    expect(lageNachKonflikt({ karten: [], leads: [l1, l2] }, anna)).toEqual({ art: "lead_waehlen", person: anna, leads: [l1, l2] });
  });
  it("409 mit mehreren Kunden ersetzt die Lage durch Kunde wählen", () => {
    expect(lageNachKonflikt({ karten: [anna, bert], leads: [] }, null)).toEqual({ art: "person_waehlen", treffer: [anna, bert] });
  });
  it("409 ohne Auswahl bleibt bei der Meldung", () => {
    expect(lageNachKonflikt({ karten: [anna], leads: [] }, null)).toBeNull();
    expect(lageNachKonflikt(null, null)).toBeNull();
    expect(lageNachKonflikt({ karten: [{ id: 1 }, "x"], leads: "kaputt" }, null)).toBeNull();
  });

  it("wertet Erfolg, Konflikt und Fehler aus", () => {
    expect(zuordnenErgebnis(200, { data: { dealRecordId: "d1", bereitsDa: false } }, null)).toEqual({
      art: "fertig",
      dealRecordId: "d1",
      bereitsDa: false,
    });
    expect(zuordnenErgebnis(200, { data: {} }, null).art).toBe("fehler");
    expect(
      zuordnenErgebnis(409, { error: { code: "CONFLICT", message: "Es gibt mehrere offene Leads." }, karten: [], leads: [l1, l2] }, anna)
    ).toEqual({ art: "konflikt", text: "Es gibt mehrere offene Leads.", lage: { art: "lead_waehlen", person: anna, leads: [l1, l2] } });
    expect(zuordnenErgebnis(404, null, null)).toEqual({ art: "fehler", text: "Diesen Anruf gibt es nicht mehr." });
    expect(zuordnenErgebnis(400, { error: { message: "Bitte einen Namen eintragen." } }, null)).toEqual({
      art: "fehler",
      text: "Bitte einen Namen eintragen.",
    });
    expect(zuordnenErgebnis(500, {}, null)).toEqual({ art: "fehler", text: "Der Server hat mit Fehler 500 geantwortet." });
    expect(zuordnenErgebnis(0, null, null)).toEqual({ art: "fehler", text: "Keine Verbindung zum Server." });
  });

  it("Titel ohne Gedankenstriche je Lage", () => {
    for (const lage of [
      { art: "person_waehlen", treffer: [anna, bert] },
      { art: "lead_waehlen", person: anna, leads: [l1, l2] },
      { art: "an_lead", person: anna, lead: l1 },
      { art: "neuer_lead", person: null },
      { art: "neuer_lead", person: anna },
    ] as AnrufDialogLage[]) {
      const t = zuordnenTitel(lage);
      expect(`${t.titel} ${t.text}`).not.toMatch(/[–—]/);
    }
  });
});
