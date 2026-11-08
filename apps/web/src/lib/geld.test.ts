import { describe, expect, it } from "vitest";
import {
  kasseEintraege,
  kasseZaehler,
  offenAus,
  rechnungZaehlt,
  tagesabschlussAus,
  ZAHLUNGSREGEL_STANDARD,
  type KasseDealRoh,
  type RechnungKurz,
  type TagesabschlussRoh,
} from "./geld";

const HEUTE = "2026-11-08";

const rechnung = (r: Partial<RechnungKurz> = {}): RechnungKurz => ({
  id: "inv",
  nummer: null,
  status: "gestellt",
  bruttoCent: null,
  rechnungstag: "2026-06-01",
  faelligAm: "2026-06-01",
  abweichungGrund: null,
  erinnerung: null,
  ...r,
});

function deal(d: Partial<KasseDealRoh> & { rechnung: RechnungKurz | null }): KasseDealRoh {
  const offen = offenAus({
    rechnung: d.rechnung ? { status: d.rechnung.status, bruttoCent: d.rechnung.bruttoCent } : null,
    annahmeCent: null,
    festpreis: d.offen ? null : "1200",
    istStunden: false,
    zahlungen: [],
  });
  return {
    dealId: "d",
    name: "Familie Alt",
    nummer: null,
    firmaId: "f",
    firmaName: "Kottke",
    kategorie: "done_unpaid",
    termin: null,
    durchgefuehrtAm: null,
    offen,
    meldungen: [],
    anzahlungCent: null,
    regel: ZAHLUNGSREGEL_STANDARD,
    kanalFehlt: false,
    ...d,
  };
}

describe("Fix-Welle I3: Altrechnungen aus dem Backfill", () => {
  it("rechnungZaehlt: alt nur mit Betrag und nicht in einer Endstufe", () => {
    expect(rechnungZaehlt(rechnung(), "done_unpaid")).toBe(true);
    expect(rechnungZaehlt(rechnung({ herkunft: "alt" }), "done_unpaid")).toBe(false);
    expect(rechnungZaehlt(rechnung({ herkunft: "alt", bruttoCent: 120000 }), "done_unpaid")).toBe(true);
    for (const k of ["paid", "lost", "kein_lead"]) {
      expect(rechnungZaehlt(rechnung({ herkunft: "alt", bruttoCent: 120000 }), k)).toBe(false);
    }
    expect(rechnungZaehlt(rechnung({ status: "storniert" }), "done_unpaid")).toBe(false);
    expect(rechnungZaehlt(null, "done_unpaid")).toBe(false);
  });

  it("Kasse: alter bezahlter Deal ohne gebuchte Zahlungen gilt als erledigt, alter Stunden-KV ohne Betrag fehlt", () => {
    const a = kasseEintraege(
      [
        deal({ dealId: "bezahlt", kategorie: "paid", rechnung: rechnung({ herkunft: "alt", bruttoCent: 120000 }) }),
        deal({
          dealId: "stunden",
          rechnung: rechnung({ herkunft: "alt" }),
          offen: { gesamtCent: null, bezahltCent: 0, restCent: null, quelle: "stunden" },
        }),
        deal({ dealId: "alt_mit_betrag", rechnung: rechnung({ herkunft: "alt", bruttoCent: 120000 }) }),
        deal({ dealId: "neu", rechnung: rechnung({ herkunft: "crm", bruttoCent: 120000 }) }),
      ],
      HEUTE,
      "2026-11-08T10:00:00Z"
    );
    expect(a.schlangen.offen.map((z) => z.dealId)).toEqual(["alt_mit_betrag", "neu"]);
    expect(a.summen.offen.unbekannt).toBe(0);
    expect(kasseZaehler(a)).toBe(2);
  });
});

describe("Fix-Welle I2: Tagesabschluss bei mehrtägigen Umzügen", () => {
  const roh = (r: Partial<TagesabschlussRoh>): TagesabschlussRoh => ({
    dealId: "d",
    name: "Familie Lang",
    nummer: null,
    kategorie: "booked",
    letzterTermintag: null,
    fertigAm: null,
    rechnung: null,
    restCent: null,
    barBeiTeam: [],
    ...r,
  });

  it("„fertig“ vor dem letzten Tag zählt nicht, am letzten Tag schon", () => {
    expect(tagesabschlussAus(roh({ letzterTermintag: "2026-11-09", fertigAm: "2026-11-08T14:00:00Z" }), HEUTE)).toBeNull();
    const karte = tagesabschlussAus(roh({ letzterTermintag: HEUTE, fertigAm: "2026-11-08T14:00:00Z" }), HEUTE);
    expect(karte?.hinweis).toBe("Team meldet fertig 15:00");
    expect(karte?.letzterTermintag).toBe(HEUTE);
    expect(tagesabschlussAus(roh({ letzterTermintag: "2026-11-07" }), HEUTE)?.hinweis).toBe("Termin war 07.11.2026");
  });
});
