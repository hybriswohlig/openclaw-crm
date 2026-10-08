import { describe, expect, it } from "vitest";
import { ANTWORT_FENSTER_TAGE, ANTWORT_STATUS, kundeSchriebZuletzt, wartetAuf, zaehltAlsAntwort, type ThreadSignal } from "./wartet";

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
    expect(r).toEqual({ wartet: null, veraltet: false, emailUngelesen: 3, alterOffenerChat: null });
  });
  it("mehrere wartende WhatsApp-Threads: ältestes Warten gewinnt", () => {
    const r = wartetAuf({ status: "kontakt", angelegtAm: h(100), jetzt, threads: [t({ id: "a", letzteEingehend: h(1), ersteEingehendNachAusgehend: h(1) }), t({ id: "b", letzteEingehend: h(2), ersteEingehendNachAusgehend: h(6) })] });
    expect(r.wartet?.chatId).toBe("b");
  });

  describe("Warte-Fenster (Ruling 9): letzte Kundennachricht höchstens 14 Tage alt", () => {
    const TAG_H = 24;
    const fenster = ANTWORT_FENSTER_TAGE * TAG_H;

    it("Fenster ist 14 Tage", () => {
      expect(ANTWORT_FENSTER_TAGE).toBe(14);
    });

    it("genau 14 Tage alte letzte Kundennachricht wartet noch", () => {
      const r = wartetAuf({ status: "kontakt", angelegtAm: h(1000), jetzt, threads: [t({ letzteEingehend: h(fenster), ersteEingehendNachAusgehend: h(fenster) })] });
      expect(r.wartet).toEqual({ art: "antwort", seit: h(fenster).toISOString(), chatId: "t1" });
      expect(r.alterOffenerChat).toBeNull();
    });

    it("eine Millisekunde älter: wartet nicht, sondern alter offener Chat", () => {
      const alt = new Date(jetzt.getTime() - ANTWORT_FENSTER_TAGE * 24 * 3600_000 - 1);
      const r = wartetAuf({ status: "kontakt", angelegtAm: h(1000), jetzt, threads: [t({ letzteEingehend: alt, ersteEingehendNachAusgehend: alt })] });
      expect(r.wartet).toBeNull();
      expect(r.alterOffenerChat).toEqual({ chatId: "t1", seit: alt.toISOString() });
    });

    it("seit bleibt die erste offene Kundennachricht, auch wenn sie älter als 14 Tage ist", () => {
      const r = wartetAuf({
        status: "angebot",
        angelegtAm: h(1000),
        jetzt,
        threads: [t({ letzteAusgehend: h(40 * TAG_H), ersteEingehendNachAusgehend: h(30 * TAG_H), letzteEingehend: h(2 * TAG_H) })],
      });
      expect(r.wartet).toEqual({ art: "antwort", seit: h(30 * TAG_H).toISOString(), chatId: "t1" });
      expect(r.alterOffenerChat).toBeNull();
    });

    it("alter Chat: seit = erste offene Kundennachricht (sonst letzte eingehende)", () => {
      const mitErster = wartetAuf({
        status: "kontakt",
        angelegtAm: h(1000),
        jetzt,
        threads: [t({ letzteAusgehend: h(40 * TAG_H), ersteEingehendNachAusgehend: h(30 * TAG_H), letzteEingehend: h(20 * TAG_H) })],
      });
      expect(mitErster.alterOffenerChat).toEqual({ chatId: "t1", seit: h(30 * TAG_H).toISOString() });
      const ohneErste = wartetAuf({ status: "kontakt", angelegtAm: h(1000), jetzt, threads: [t({ letzteEingehend: h(20 * TAG_H) })] });
      expect(ohneErste.alterOffenerChat).toEqual({ chatId: "t1", seit: h(20 * TAG_H).toISOString() });
    });

    it("mehrere alte Chats: der älteste gewinnt", () => {
      const r = wartetAuf({
        status: "kontakt",
        angelegtAm: h(1000),
        jetzt,
        threads: [
          t({ id: "a", letzteEingehend: h(20 * TAG_H), ersteEingehendNachAusgehend: h(20 * TAG_H) }),
          t({ id: "b", letzteEingehend: h(16 * TAG_H), ersteEingehendNachAusgehend: h(50 * TAG_H) }),
        ],
      });
      expect(r.alterOffenerChat).toEqual({ chatId: "b", seit: h(50 * TAG_H).toISOString() });
    });

    it("frischer und alter Chat am selben Lead: wartet wegen des frischen, der alte ist trotzdem gemeldet", () => {
      const r = wartetAuf({
        status: "kontakt",
        angelegtAm: h(1000),
        jetzt,
        threads: [
          t({ id: "frisch", letzteEingehend: h(3), ersteEingehendNachAusgehend: h(3) }),
          t({ id: "alt", letzteEingehend: h(20 * TAG_H), ersteEingehendNachAusgehend: h(20 * TAG_H) }),
        ],
      });
      expect(r.wartet).toEqual({ art: "antwort", seit: h(3).toISOString(), chatId: "frisch" });
      expect(r.alterOffenerChat).toEqual({ chatId: "alt", seit: h(20 * TAG_H).toISOString() });
    });

    it("nur offene WhatsApp-Lead-Threads mit Kunde zuletzt zählen als alter Chat", () => {
      const alt = h(20 * TAG_H);
      const faelle: Array<Partial<ThreadSignal>> = [
        { kanal: "email", letzteEingehend: alt },
        { kanal: "sms", letzteEingehend: alt },
        { status: "resolved", letzteEingehend: alt },
        { lane: "spam", letzteEingehend: alt },
        { letzteEingehend: alt, letzteAusgehend: h(19 * TAG_H) },
      ];
      for (const f of faelle) {
        const r = wartetAuf({ status: "kontakt", angelegtAm: h(1000), jetzt, threads: [t(f)] });
        expect(r.alterOffenerChat).toBeNull();
        expect(r.wartet).toBeNull();
      }
    });

    describe("verloren (Grok 4): offener WhatsApp-Chat mit Kunde zuletzt wird alter Chat, ohne 14-Tage-Fenster", () => {
      it("frische Kundennachricht nach Verloren: wartet nicht, alter Chat ab erster offener Kundennachricht", () => {
        const r = wartetAuf({
          status: "verloren",
          angelegtAm: h(1000),
          jetzt,
          threads: [t({ letzteAusgehend: h(30 * TAG_H), ersteEingehendNachAusgehend: h(5), letzteEingehend: h(2) })],
        });
        expect(r).toEqual({ wartet: null, veraltet: false, emailUngelesen: 0, alterOffenerChat: { chatId: "t1", seit: h(5).toISOString() } });
      });

      it("auch ältere Kundennachrichten (über 14 Tage) zählen", () => {
        const r = wartetAuf({ status: "verloren", angelegtAm: h(1000), jetzt, threads: [t({ letzteEingehend: h(20 * TAG_H) })] });
        expect(r.wartet).toBeNull();
        expect(r.alterOffenerChat).toEqual({ chatId: "t1", seit: h(20 * TAG_H).toISOString() });
      });

      it("mehrere offene Chats: der älteste gewinnt", () => {
        const r = wartetAuf({
          status: "verloren",
          angelegtAm: h(1000),
          jetzt,
          threads: [
            t({ id: "frisch", letzteEingehend: h(2), ersteEingehendNachAusgehend: h(2) }),
            t({ id: "alt", letzteEingehend: h(20 * TAG_H), ersteEingehendNachAusgehend: h(20 * TAG_H) }),
          ],
        });
        expect(r.alterOffenerChat).toEqual({ chatId: "alt", seit: h(20 * TAG_H).toISOString() });
      });

      it("beantwortete, erledigte, Spam-, E-Mail- und SMS-Threads bleiben außen vor", () => {
        const faelle: Array<Partial<ThreadSignal>> = [
          { letzteEingehend: h(5), letzteAusgehend: h(1) },
          { status: "resolved", letzteEingehend: h(5) },
          { lane: "spam", letzteEingehend: h(5) },
          { kanal: "email", letzteEingehend: h(5) },
          { kanal: "sms", letzteEingehend: h(5) },
        ];
        for (const f of faelle) {
          const r = wartetAuf({ status: "verloren", angelegtAm: h(1000), jetzt, threads: [t(f)] });
          expect(r.alterOffenerChat).toBeNull();
          expect(r.wartet).toBeNull();
        }
      });
    });

    it("neue Anfrage mit altem WhatsApp-Thread: neu_pruefen bleibt, alter Chat wird gemeldet", () => {
      const r = wartetAuf({ status: "neu", angelegtAm: h(30), jetzt, threads: [t({ letzteEingehend: h(20 * TAG_H) })] });
      expect(r.wartet?.art).toBe("neu_pruefen");
      expect(r.alterOffenerChat).toEqual({ chatId: "t1", seit: h(20 * TAG_H).toISOString() });
    });
  });
});

describe("Antwort nur, wenn gesendet (Ruling 15)", () => {
  it("nur sent, delivered und read zählen als Antwort", () => {
    expect([...ANTWORT_STATUS].sort()).toEqual(["delivered", "read", "sent"]);
    for (const status of ["sent", "delivered", "read"]) expect(zaehltAlsAntwort({ direction: "outbound", status })).toBe(true);
    for (const status of ["pending", "failed", "received"]) expect(zaehltAlsAntwort({ direction: "outbound", status })).toBe(false);
    expect(zaehltAlsAntwort({ direction: "inbound", status: "received" })).toBe(false);
  });

  it("kundeSchriebZuletzt (neueste zuerst): fehlgeschlagene oder wartende Sendungen nach der Kundennachricht zählen nicht", () => {
    const ein = { direction: "inbound" as const, status: "received" };
    const aus = (status: string) => ({ direction: "outbound" as const, status });
    expect(kundeSchriebZuletzt([ein, aus("read")])).toBe(true);
    expect(kundeSchriebZuletzt([aus("failed"), ein, aus("read")])).toBe(true);
    expect(kundeSchriebZuletzt([aus("pending"), aus("failed"), ein])).toBe(true);
    expect(kundeSchriebZuletzt([aus("delivered"), ein])).toBe(false);
    expect(kundeSchriebZuletzt([aus("failed"), aus("sent"), ein])).toBe(false);
    expect(kundeSchriebZuletzt([aus("failed")])).toBe(false);
    expect(kundeSchriebZuletzt([])).toBe(false);
  });
});
