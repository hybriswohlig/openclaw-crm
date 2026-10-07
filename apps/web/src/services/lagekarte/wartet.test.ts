import { describe, expect, it } from "vitest";
import { wartetAuf, type ThreadSignal } from "./wartet";

const jetzt = new Date("2026-10-08T09:00:00+02:00");
const h = (stunden: number) => new Date(jetzt.getTime() - stunden * 3600_000);
const t = (p: Partial<ThreadSignal>): ThreadSignal => ({ id: "t1", kanal: "whatsapp", status: "open", lane: "lead", letzteEingehend: null, letzteAusgehend: null, ersteEingehendNachAusgehend: null, ungelesen: 0, ...p });

describe("wartetAuf", () => {
  it("WhatsApp: Kunde zuletzt → Antwort ausstehend seit erster offener Kundennachricht", () => {
    const r = wartetAuf({ status: "kontakt", angelegtAm: h(100), jetzt, threads: [t({ letzteAusgehend: h(5), letzteEingehend: h(1), ersteEingehendNachAusgehend: h(3) })] });
    expect(r.wartet).toEqual({ art: "antwort", seit: h(3).toISOString(), chatId: "t1" });
  });
  it("WhatsApp beantwortet → wartet nicht", () => {
    expect(wartetAuf({ status: "kontakt", angelegtAm: h(100), jetzt, threads: [t({ letzteAusgehend: h(1), letzteEingehend: h(2) })] }).wartet).toBeNull();
  });
  it("WhatsApp ohne ausgehend: seit = letzteEingehend, wenn keine erste gesetzt ist", () => {
    const r = wartetAuf({ status: "kontakt", angelegtAm: h(100), jetzt, threads: [t({ letzteEingehend: h(4) })] });
    expect(r.wartet).toEqual({ art: "antwort", seit: h(4).toISOString(), chatId: "t1" });
  });
  it("E-Mail mit Kunde zuletzt wartet NIE (Gmail-Antworten unsichtbar), zählt nur ungelesen", () => {
    const r = wartetAuf({ status: "kontakt", angelegtAm: h(100), jetzt, threads: [t({ kanal: "email", letzteEingehend: h(2), ungelesen: 2 })] });
    expect(r.wartet).toBeNull();
    expect(r.emailUngelesen).toBe(2);
  });
  it("E-Mail-Ungelesen zählt nur, wenn der Kunde zuletzt schrieb, und nur in relevanten Threads", () => {
    const r = wartetAuf({
      status: "kontakt",
      angelegtAm: h(100),
      jetzt,
      threads: [
        t({ id: "a", kanal: "email", letzteEingehend: h(2), ungelesen: 2 }),
        t({ id: "b", kanal: "email", letzteEingehend: h(5), letzteAusgehend: h(1), ungelesen: 4 }),
        t({ id: "c", kanal: "email", status: "resolved", letzteEingehend: h(2), ungelesen: 8 }),
        t({ id: "d", kanal: "email", lane: "spam", letzteEingehend: h(2), ungelesen: 16 }),
        t({ id: "e", kanal: "whatsapp", letzteEingehend: h(2), ungelesen: 32 }),
      ],
    });
    expect(r.emailUngelesen).toBe(2);
  });
  it("SMS zählt nie", () => {
    expect(wartetAuf({ status: "kontakt", angelegtAm: h(100), jetzt, threads: [t({ kanal: "sms", letzteEingehend: h(2) })] }).wartet).toBeNull();
  });
  it("erledigte oder Spam-Threads zählen nicht", () => {
    expect(wartetAuf({ status: "kontakt", angelegtAm: h(100), jetzt, threads: [t({ status: "resolved", letzteEingehend: h(2) })] }).wartet).toBeNull();
    expect(wartetAuf({ status: "kontakt", angelegtAm: h(100), jetzt, threads: [t({ lane: "spam", letzteEingehend: h(2) })] }).wartet).toBeNull();
  });
  it("neue Anfrage ohne Antwort, jünger als 7 Tage → neu_pruefen", () => {
    const r = wartetAuf({ status: "neu", angelegtAm: h(30), jetzt, threads: [t({ kanal: "email", letzteEingehend: h(30) })] });
    expect(r.wartet).toEqual({ art: "neu_pruefen", seit: h(30).toISOString(), chatId: "t1" });
    expect(r.veraltet).toBe(false);
  });
  it("neue Anfrage ohne Thread → neu_pruefen ohne chatId", () => {
    const r = wartetAuf({ status: "neu", angelegtAm: h(30), jetzt, threads: [] });
    expect(r.wartet).toEqual({ art: "neu_pruefen", seit: h(30).toISOString(), chatId: null });
  });
  it("neu_pruefen zeigt auf den neuesten relevanten Thread", () => {
    const r = wartetAuf({
      status: "neu",
      angelegtAm: h(30),
      jetzt,
      threads: [t({ id: "alt", kanal: "email", letzteEingehend: h(20) }), t({ id: "neu", kanal: "sms", letzteEingehend: h(2) }), t({ id: "erledigt", status: "resolved", letzteEingehend: h(1) })],
    });
    expect(r.wartet?.chatId).toBe("neu");
  });
  it("genau 7 Tage alt ist noch neu_pruefen, darüber veraltet", () => {
    const grenze = wartetAuf({ status: "neu", angelegtAm: h(24 * 7), jetzt, threads: [] });
    expect(grenze.wartet?.art).toBe("neu_pruefen");
    expect(grenze.veraltet).toBe(false);
    const darueber = wartetAuf({ status: "neu", angelegtAm: h(24 * 7 + 1), jetzt, threads: [] });
    expect(darueber.wartet).toBeNull();
    expect(darueber.veraltet).toBe(true);
  });
  it("neue Anfrage älter als 7 Tage → veraltet statt wartend", () => {
    const r = wartetAuf({ status: "neu", angelegtAm: h(24 * 8), jetzt, threads: [] });
    expect(r.wartet).toBeNull();
    expect(r.veraltet).toBe(true);
  });
  it("alte neue Anfrage mit offener WhatsApp-Frage: wartet auf Antwort und ist trotzdem veraltet", () => {
    const r = wartetAuf({ status: "neu", angelegtAm: h(24 * 8), jetzt, threads: [t({ letzteEingehend: h(3) })] });
    expect(r.wartet?.art).toBe("antwort");
    expect(r.veraltet).toBe(true);
  });
  it("neue Anfrage mit irgendeiner Antwort → nicht neu_pruefen, nicht veraltet", () => {
    const r = wartetAuf({ status: "neu", angelegtAm: h(30), jetzt, threads: [t({ kanal: "email", letzteAusgehend: h(20), letzteEingehend: h(30) })] });
    expect(r.wartet).toBeNull();
    expect(r.veraltet).toBe(false);
  });
  it("auch ein erledigter Thread mit ausgehender Nachricht zählt als Antwort", () => {
    const r = wartetAuf({ status: "neu", angelegtAm: h(24 * 8), jetzt, threads: [t({ status: "resolved", letzteAusgehend: h(20) })] });
    expect(r.wartet).toBeNull();
    expect(r.veraltet).toBe(false);
  });
  it("verloren wartet nie, zählt aber ungelesene E-Mails", () => {
    expect(wartetAuf({ status: "verloren", angelegtAm: h(30), jetzt, threads: [t({ letzteEingehend: h(1) })] }).wartet).toBeNull();
    const r = wartetAuf({ status: "verloren", angelegtAm: h(30), jetzt, threads: [t({ kanal: "email", letzteEingehend: h(1), ungelesen: 3 })] });
    expect(r).toEqual({ wartet: null, veraltet: false, emailUngelesen: 3 });
  });
  it("mehrere wartende WhatsApp-Threads: ältestes Warten gewinnt", () => {
    const r = wartetAuf({ status: "kontakt", angelegtAm: h(100), jetzt, threads: [t({ id: "a", letzteEingehend: h(1), ersteEingehendNachAusgehend: h(1) }), t({ id: "b", letzteEingehend: h(2), ersteEingehendNachAusgehend: h(6) })] });
    expect(r.wartet?.chatId).toBe("b");
  });
});
