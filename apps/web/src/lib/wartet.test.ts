import { describe, expect, it } from "vitest";
import { berechenbareDealId, berechneWartet, type WartetEingabe } from "./wartet";

const jetzt = new Date("2026-11-06T09:00:00Z");
const TAG = 24 * 60 * 60 * 1000;
const vor = (tage: number, stunden = 0) => new Date(jetzt.getTime() - tage * TAG - stunden * 60 * 60 * 1000);

function eingabe(teil: Partial<WartetEingabe> = {}): WartetEingabe {
  return {
    stageCategory: "open_engaged",
    erstelltAm: vor(10),
    letzteKundenNachricht: null,
    letzteEigeneNachricht: null,
    kvGesendetAm: null,
    kvZuletztGeoeffnetAm: null,
    angenommenAm: null,
    abErstelltAm: null,
    rechnungErstelltAm: null,
    bezahlt: false,
    jetzt,
    ...teil,
  };
}

describe("berechneWartet", () => {
  it("(1) paid, lost und kein_lead warten auf niemanden, auch wenn der Kunde zuletzt schrieb", () => {
    for (const stageCategory of ["paid", "lost", "kein_lead"] as const) {
      expect(
        berechneWartet(eingabe({ stageCategory, letzteKundenNachricht: vor(1), letzteEigeneNachricht: vor(2) }))
      ).toEqual({ auf: "niemand", seit: null, grund: null });
    }
  });

  it("(2) Kunde schrieb zuletzt: wartet auf uns seit seiner Nachricht", () => {
    expect(
      berechneWartet(eingabe({ letzteKundenNachricht: vor(1), letzteEigeneNachricht: vor(2) }))
    ).toEqual({ auf: "uns", seit: vor(1), grund: "Kunde wartet auf Antwort" });
    // ohne eigene Nachricht
    expect(berechneWartet(eingabe({ stageCategory: "open_new", letzteKundenNachricht: vor(3) }))).toEqual({
      auf: "uns",
      seit: vor(3),
      grund: "Kunde wartet auf Antwort",
    });
  });

  it("(2) geht vor (4): Kunde schreibt zurück, während der KV offen ist", () => {
    expect(
      berechneWartet(
        eingabe({
          stageCategory: "quoted",
          kvGesendetAm: vor(5),
          kvZuletztGeoeffnetAm: vor(4),
          letzteEigeneNachricht: vor(5),
          letzteKundenNachricht: vor(0, 2),
        })
      )
    ).toEqual({ auf: "uns", seit: vor(0, 2), grund: "Kunde wartet auf Antwort" });
  });

  it("(2) greift nicht, wenn unsere Nachricht neuer ist oder gleich alt", () => {
    const r = berechneWartet(eingabe({ letzteKundenNachricht: vor(2), letzteEigeneNachricht: vor(2) }));
    expect(r).toEqual({ auf: "kunde", seit: vor(2), grund: "Wartet auf Kunden" });
  });

  it("(3) open_new ohne eigene Nachricht: wartet auf uns seit Anlage", () => {
    expect(berechneWartet(eingabe({ stageCategory: "open_new", erstelltAm: vor(0, 5) }))).toEqual({
      auf: "uns",
      seit: vor(0, 5),
      grund: "Noch keine Antwort",
    });
  });

  it("(3) open_new mit eigener Nachricht fällt auf (7)", () => {
    expect(berechneWartet(eingabe({ stageCategory: "open_new", letzteEigeneNachricht: vor(1) }))).toEqual({
      auf: "kunde",
      seit: vor(1),
      grund: "Wartet auf Kunden",
    });
  });

  it("(4) quoted, KV geöffnet: wartet auf den Kunden seit dem Versand", () => {
    expect(
      berechneWartet(eingabe({ stageCategory: "quoted", kvGesendetAm: vor(6), kvZuletztGeoeffnetAm: vor(5) }))
    ).toEqual({ auf: "kunde", seit: vor(6), grund: "KV offen" });
  });

  it("(4) KV ungesehen seit 4 Tagen: wartet auf uns, grund nennt 4 Tagen", () => {
    const r = berechneWartet(eingabe({ stageCategory: "quoted", kvGesendetAm: vor(4, 3) }));
    expect(r.auf).toBe("uns");
    expect(r.seit).toEqual(vor(4, 3));
    expect(r.grund).toContain("4 Tagen");
    expect(r.grund).toBe("KV seit 4 Tagen ungesehen");
  });

  it("(4) ungesehen, aber nicht länger als 3 Tage: noch KV offen", () => {
    expect(berechneWartet(eingabe({ stageCategory: "quoted", kvGesendetAm: vor(3) }))).toEqual({
      auf: "kunde",
      seit: vor(3),
      grund: "KV offen",
    });
    // eine Minute über 3 Tage reicht
    const knapp = new Date(vor(3).getTime() - 60_000);
    expect(berechneWartet(eingabe({ stageCategory: "quoted", kvGesendetAm: knapp }))).toEqual({
      auf: "uns",
      seit: knapp,
      grund: "KV seit 3 Tagen ungesehen",
    });
  });

  it("(4) ein Portalbesuch vor dem KV-Versand zählt nicht als geöffnet", () => {
    const r = berechneWartet(
      eingabe({ stageCategory: "quoted", kvGesendetAm: vor(5), kvZuletztGeoeffnetAm: vor(6) })
    );
    expect(r).toEqual({ auf: "uns", seit: vor(5), grund: "KV seit 5 Tagen ungesehen" });
  });

  it("(4) quoted ohne KV-Dokument: KV offen ohne seit", () => {
    expect(berechneWartet(eingabe({ stageCategory: "quoted" }))).toEqual({
      auf: "kunde",
      seit: null,
      grund: "KV offen",
    });
  });

  it("(5) booked ohne AB: wartet auf uns seit der Annahme", () => {
    expect(berechneWartet(eingabe({ stageCategory: "booked", angenommenAm: vor(2) }))).toEqual({
      auf: "uns",
      seit: vor(2),
      grund: "AB fehlt",
    });
  });

  it("(5) booked mit AB fällt auf (7)", () => {
    expect(
      berechneWartet(
        eingabe({ stageCategory: "booked", angenommenAm: vor(2), abErstelltAm: vor(1), letzteEigeneNachricht: vor(1) })
      )
    ).toEqual({ auf: "kunde", seit: vor(1), grund: "Wartet auf Kunden" });
    expect(
      berechneWartet(eingabe({ stageCategory: "booked", angenommenAm: vor(2), abErstelltAm: vor(1) }))
    ).toEqual({ auf: "niemand", seit: null, grund: null });
  });

  it("(6) done_unpaid ohne Rechnung: wartet auf uns seit Annahme, sonst seit Anlage", () => {
    expect(berechneWartet(eingabe({ stageCategory: "done_unpaid", angenommenAm: vor(8) }))).toEqual({
      auf: "uns",
      seit: vor(8),
      grund: "Rechnung fehlt",
    });
    expect(berechneWartet(eingabe({ stageCategory: "done_unpaid" }))).toEqual({
      auf: "uns",
      seit: vor(10),
      grund: "Rechnung fehlt",
    });
  });

  it("(6) done_unpaid mit Rechnung: wartet auf den Kunden seit der Rechnung", () => {
    expect(
      berechneWartet(eingabe({ stageCategory: "done_unpaid", rechnungErstelltAm: vor(1), letzteEigeneNachricht: vor(1) }))
    ).toEqual({ auf: "kunde", seit: vor(1), grund: "Rechnung offen" });
  });

  it("(6) done_unpaid mit Rechnung und voll bezahlt: niemand", () => {
    expect(
      berechneWartet(eingabe({ stageCategory: "done_unpaid", rechnungErstelltAm: vor(3), bezahlt: true }))
    ).toEqual({ auf: "niemand", seit: null, grund: null });
  });

  it("(7) sonst mit eigener Nachricht: wartet auf den Kunden", () => {
    expect(berechneWartet(eingabe({ letzteEigeneNachricht: vor(2), letzteKundenNachricht: vor(3) }))).toEqual({
      auf: "kunde",
      seit: vor(2),
      grund: "Wartet auf Kunden",
    });
  });

  it("(7) sonst ohne eigene Nachricht: niemand, auch ohne Stufe", () => {
    expect(berechneWartet(eingabe())).toEqual({ auf: "niemand", seit: null, grund: null });
    expect(berechneWartet(eingabe({ stageCategory: null }))).toEqual({ auf: "niemand", seit: null, grund: null });
  });

  it("ohne Stufe greift (2) trotzdem", () => {
    expect(berechneWartet(eingabe({ stageCategory: null, letzteKundenNachricht: vor(1) }))).toEqual({
      auf: "uns",
      seit: vor(1),
      grund: "Kunde wartet auf Antwort",
    });
  });
});

describe("berechenbareDealId", () => {
  it("null, undefined und leerer Text ergeben null", () => {
    expect(berechenbareDealId(null)).toBeNull();
    expect(berechenbareDealId(undefined)).toBeNull();
    expect(berechenbareDealId("")).toBeNull();
  });

  it("sonst die Id", () => {
    expect(berechenbareDealId("deal-1")).toBe("deal-1");
  });
});
