import { beforeAll, describe, expect, it, vi } from "vitest";
import type { LagekarteAntwort, LeadPunkt } from "@/lib/lagekarte/typen";
import type { LagekarteRoh, WertRoh } from "./laden";

// Nur Zusammenbau testen, nie verbinden (index.ts importiert laden.ts und damit db).
vi.stubEnv("DATABASE_URL", "postgres://test:test@127.0.0.1:9/test");

const JETZT = new Date("2026-10-08T10:00:00+02:00");
const vor = (stunden: number) => new Date(JETZT.getTime() - stunden * 3600_000);

function wert(recordId: string, slug: WertRoh["slug"], teil: Partial<WertRoh>): WertRoh {
  return { recordId, slug, textValue: null, dateValue: null, jsonValue: null, referencedRecordId: null, ...teil };
}

function thread(
  id: string,
  dealRecordId: string,
  teil: Partial<LagekarteRoh["threads"][number]>,
): LagekarteRoh["threads"][number] {
  return {
    id,
    dealRecordId,
    status: "open",
    lane: "lead",
    unreadCount: 0,
    lastMessageAt: null,
    lastMessagePreview: null,
    createdAt: vor(24 * 30),
    kanal: "whatsapp",
    kontoName: "Konto",
    kontoFirmaId: null,
    telefon: null,
    ...teil,
  };
}

/**
 * Drei Deals, die die Fallen der Verdrahtung abdecken:
 * - immo: ImmoScout-Payload mit client.zip (Berlin) ≠ from.zip (Böblingen), Festpreis-String, Zahlungen in Euro.
 * - kva: aktive KV-Annahme (Cent) mit Stufe „Durchgeführt“, Abholadresse als reiner String.
 * - zwei: deals.value in Euro, drei Threads (Reihenfolge, Telefon) und eine fehlgeschlagene Sendung
 *   nach der Kundennachricht. Das Aggregat kommt so, wie laden.ts es liefert (Ruling 15): failed zählt
 *   nicht als letzteAusgehend, nur als letzteNachricht.
 */
const ROH: LagekarteRoh = {
  stufen: [
    { id: "st-neu", titel: "Neu", farbe: "#999999", kategorie: "open_new", aktiv: true, reihenfolge: 1 },
    { id: "st-kontakt", titel: "Kontakt", farbe: "#999999", kategorie: "open_engaged", aktiv: true, reihenfolge: 2 },
    { id: "st-durch", titel: "Durchgeführt", farbe: "#999999", kategorie: "done_unpaid", aktiv: true, reihenfolge: 5 },
  ],
  firmen: [],
  deals: [
    { id: "immo", createdAt: vor(24 * 3) },
    { id: "kva", createdAt: vor(24 * 20) },
    { id: "zwei", createdAt: vor(24 * 10) },
  ],
  werte: [
    wert("immo", "name", { textValue: "Immo Test" }),
    wert("immo", "stage", { textValue: "st-neu" }),
    wert("immo", "moving_lead_payload", {
      jsonValue: {
        client: { zip: "10115", city: "Berlin" },
        from: { zip: "71032", city: "Böblingen", street: "Teststraße 1" },
        to: { zip: "70173", city: "Stuttgart" },
      },
    }),
    wert("kva", "name", { textValue: "KV Test" }),
    wert("kva", "stage", { textValue: "st-durch" }),
    wert("kva", "move_from_address", { jsonValue: "Hauptstraße 5, 72202 Nagold" }),
    // Wird von der Annahme überstimmt (Rangfolge der Wertregel).
    wert("kva", "value", { jsonValue: { amount: 999, currency: "EUR" } }),
    wert("zwei", "name", { textValue: "Zwei Threads" }),
    wert("zwei", "stage", { textValue: "st-kontakt" }),
    wert("zwei", "move_from_address", { jsonValue: { line1: "Marktplatz 1", postcode: "73728", city: "Esslingen" } }),
    wert("zwei", "value", { jsonValue: { amount: 980.5, currency: "EUR" } }),
  ],
  nummern: [{ dealRecordId: "kva", dealNumber: "D-0042" }],
  annahmen: [{ dealRecordId: "kva", confirmedTotalCents: 124_950, signedAt: vor(24 * 15), quotationDocumentId: null }],
  angebote: [
    {
      id: "q-immo",
      dealRecordId: "immo",
      fixedPrice: "1890.00",
      isVariable: false,
      selectedPackageOptionId: null,
      createdAt: vor(24 * 2),
      updatedAt: vor(24 * 2),
    },
  ],
  positionen: [],
  optionen: [],
  dokumente: [],
  links: [],
  zahlungen: [
    { dealRecordId: "immo", amount: "450.50", taxTreatment: "regelbesteuert" },
    // Kaution zählt nicht.
    { dealRecordId: "immo", amount: "300.00", taxTreatment: "nicht_steuerbar" },
    { dealRecordId: "kva", amount: "100.25", taxTreatment: null },
  ],
  rechner: [],
  threads: [
    thread("t-alt", "zwei", { telefon: "+49 711 1111", lastMessageAt: vor(24 * 5) }),
    thread("t-fehl", "zwei", { telefon: "+49 711 2222", lastMessageAt: vor(1) }),
    thread("t-mail", "zwei", { kanal: "email", lastMessageAt: vor(0.5) }),
  ],
  aggregate: [
    {
      conversationId: "t-alt",
      letzteEingehend: vor(24 * 6),
      letzteAusgehend: vor(24 * 5),
      ersteEingehendNachAusgehend: null,
      letzteNachricht: vor(24 * 5),
    },
    {
      // Kunde schrieb vor 3 h und 2 h; die Antwort vor 1 h schlug fehl (nur letzteNachricht).
      conversationId: "t-fehl",
      letzteEingehend: vor(2),
      letzteAusgehend: vor(24),
      ersteEingehendNachAusgehend: vor(3),
      letzteNachricht: vor(1),
    },
    {
      conversationId: "t-mail",
      letzteEingehend: null,
      letzteAusgehend: vor(0.5),
      ersteEingehendNachAusgehend: null,
      letzteNachricht: vor(0.5),
    },
  ],
  entwurfDeals: [],
};

let antwort: LagekarteAntwort;
let lead: (id: string) => LeadPunkt;

beforeAll(async () => {
  const { baueLagekarte } = await import("./index");
  antwort = baueLagekarte(ROH, JETZT);
  lead = (id) => {
    const l = antwort.leads.find((x) => x.id === id);
    if (!l) throw new Error(`Lead ${id} fehlt`);
    return l;
  };
});

describe("baueLagekarte: Verdrahtung der Rohdaten (I-5)", () => {
  it("ImmoScout: Ort ist from.zip, nie client.zip; Ziel aus to.zip", () => {
    const l = lead("immo");
    expect(l.ort).toMatchObject({ plz: "71032", kreisAgs: "08115", quelle: "immoscout" });
    expect(l.ziel).toMatchObject({ plz: "70173", kreisAgs: "08111", quelle: "zieladresse" });
  });

  it("Festpreis-String in Euro wird zu Cent, Zahlungen in Euro ohne Kaution", () => {
    const l = lead("immo");
    expect(l.status).toBe("angebot");
    expect(l.wert).toEqual({ cent: 189_000, art: "angebot" });
    expect(l.bezahltCent).toBe(45_050);
  });

  it("KV-Annahme in Cent mit Stufe „Durchgeführt“: erledigt mit offener Zahlung, kein Auftrag", () => {
    const l = lead("kva");
    expect(l.status).toBe("erledigt");
    expect(l.zahlungOffen).toBe(true);
    expect(l.statusHinweis).toBeNull();
    expect(l.wert).toEqual({ cent: 124_950, art: "bestaetigt" });
    expect(l.bezahltCent).toBe(10_025);
    expect(l.kv.angenommenAm).toBe(new Date(JETZT.getTime() - 15 * 24 * 3600_000).toISOString());
    expect(l.nummer).toBe("D-0042");
    expect(antwort.missionen.some((m) => m.leadId === "kva" && m.art === "zahlung_offen")).toBe(true);
  });

  it("Abholadresse als reiner String gilt als Freitext", () => {
    expect(lead("kva").ort).toMatchObject({ plz: "72202", kreisAgs: "08235", quelle: "freitext" });
  });

  it("deals.value.amount ist Euro", () => {
    expect(lead("zwei").wert).toEqual({ cent: 98_050, art: "schaetzung" });
    expect(lead("zwei").ort).toMatchObject({ plz: "73728", quelle: "abholadresse" });
  });

  it("Chats: neueste Aktivität zuerst; Telefon vom neuesten Thread, der eine Nummer hat", () => {
    const l = lead("zwei");
    expect(l.chats.map((c) => c.id)).toEqual(["t-mail", "t-fehl", "t-alt"]);
    expect(l.telefon).toBe("+49 711 2222");
  });

  it("fehlgeschlagene Antwort nach der Kundennachricht: Lead wartet weiter seit der ersten offenen Nachricht", () => {
    const l = lead("zwei");
    expect(l.wartet).toEqual({ art: "antwort", seit: new Date(JETZT.getTime() - 3 * 3600_000).toISOString(), chatId: "t-fehl" });
    const fehl = l.chats.find((c) => c.id === "t-fehl");
    expect(fehl?.kundeZuletzt).toBe(true);
    // Die fehlgeschlagene Sendung bleibt als letzte Aktivität sichtbar.
    expect(fehl?.letzteNachrichtAm).toBe(new Date(JETZT.getTime() - 3600_000).toISOString());
    expect(antwort.kennzahlen.wartet.gesamt).toBe(1);
  });
});
