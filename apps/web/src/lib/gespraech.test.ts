import { describe, expect, it } from "vitest";
import {
  anpassungLabel,
  gespraechZusammenfuehren,
  kannSendenAus,
  systemzeilenAus,
  vorauswahlAus,
  type GespraechEintrag,
  type SystemFakten,
} from "./gespraech";

type Nachricht = Extract<GespraechEintrag, { art: "nachricht" }>;
type Anruf = Extract<GespraechEintrag, { art: "anruf" }>;
type System = Extract<GespraechEintrag, { art: "system" }>;

const nachricht = (id: string, zeit: string, over: Partial<Nachricht> = {}): Nachricht => ({
  art: "nachricht",
  id,
  zeit,
  richtung: "inbound",
  kanal: "whatsapp",
  gespraechId: "c_wa",
  von: "Familie Weber",
  text: id,
  status: "received",
  anhaenge: [],
  ...over,
});
const anruf = (id: string, zeit: string): Anruf => ({ art: "anruf", id, zeit, dauerSek: 240, zusammenfassung: "Termin besprochen" });
const system = (id: string, zeit: string): System => ({ art: "system", id, zeit, text: id, betont: null });

const LEER: SystemFakten = {
  erstelltAm: "2026-11-01T09:00:00.000Z",
  firma: null,
  quelle: null,
  fotoanalyse: null,
  sperrungen: [],
  versand: [],
  geoeffnet: null,
  zahlungen: [],
  kundenereignisse: [],
};
// Freitag, 06.11.2026, 10:00 in Berlin
const JETZT = new Date("2026-11-06T09:00:00.000Z");

describe("gespraechZusammenfuehren", () => {
  it("WhatsApp, E-Mail und Anruf aufsteigend nach Zeit", () => {
    const out = gespraechZusammenfuehren({
      nachrichten: [
        nachricht("wa2", "2026-11-03T10:00:00.000Z"),
        nachricht("mail1", "2026-11-02T08:00:00.000Z", { kanal: "email", gespraechId: "c_mail" }),
        nachricht("wa1", "2026-11-01T12:00:00.000Z"),
      ],
      anrufe: [anruf("call1", "2026-11-02T15:30:00.000Z")],
      system: [system("lead", "2026-11-01T09:00:00.000Z")],
    });
    expect(out.map((e) => e.id)).toEqual(["lead", "wa1", "mail1", "call1", "wa2"]);
  });

  it("gleiche Zeit: Systemzeile vor Nachricht", () => {
    const t = "2026-11-03T10:00:00.000Z";
    const out = gespraechZusammenfuehren({
      nachrichten: [nachricht("n", t)],
      anrufe: [],
      system: [system("s", t)],
    });
    expect(out.map((e) => e.id)).toEqual(["s", "n"]);
  });

  it("Tagesdatum ohne Uhrzeit sortiert als Mitternacht UTC", () => {
    const out = gespraechZusammenfuehren({
      nachrichten: [nachricht("n", "2026-11-04T23:30:00.000Z")],
      anrufe: [],
      system: [system("s", "2026-11-05")],
    });
    expect(out.map((e) => e.id)).toEqual(["n", "s"]);
  });
});

describe("systemzeilenAus", () => {
  it("Lead angelegt mit Firma und Quelle, betont Neue Anfrage", () => {
    const [z] = systemzeilenAus({ ...LEER, firma: "Kottke", quelle: "Kleinanzeigen" }, JETZT);
    expect(z).toEqual({
      art: "system",
      id: "sys:lead",
      zeit: "2026-11-01T09:00:00.000Z",
      text: "Lead angelegt · Kottke · Quelle Kleinanzeigen · Neue Anfrage",
      betont: "Neue Anfrage",
    });
  });

  it("Lead angelegt ohne Firma und Quelle", () => {
    expect(systemzeilenAus(LEER, JETZT).map((z) => z.text)).toEqual(["Lead angelegt · Neue Anfrage"]);
  });

  it("Fotoanalyse fertig mit Volumen", () => {
    const zeilen = systemzeilenAus(
      { ...LEER, fotoanalyse: { am: "2026-11-02T10:00:00.000Z", teile: 31, volumenCbm: 38 } },
      JETZT
    );
    expect(zeilen[1]).toEqual({
      art: "system",
      id: "sys:fotoanalyse",
      zeit: "2026-11-02T10:00:00.000Z",
      text: "Fotoanalyse fertig · Möbelliste 31 Teile · 38 m³",
      betont: "38 m³",
    });
  });

  it("Fotoanalyse ohne Volumen, ein Teil, Volumen mit Komma", () => {
    const ohne = systemzeilenAus({ ...LEER, fotoanalyse: { am: "2026-11-02T10:00:00.000Z", teile: 1, volumenCbm: null } }, JETZT);
    expect(ohne[1]).toMatchObject({ text: "Fotoanalyse fertig · Möbelliste 1 Teil", betont: null });
    const komma = systemzeilenAus({ ...LEER, fotoanalyse: { am: "2026-11-02T10:00:00.000Z", teile: 4, volumenCbm: 12.46 } }, JETZT);
    expect(komma[1]).toMatchObject({ text: "Fotoanalyse fertig · Möbelliste 4 Teile · 12,5 m³", betont: "12,5 m³" });
  });

  it("Kalkulation geprüft mit erster Anpassung, betont KV und Betrag", () => {
    const zeilen = systemzeilenAus(
      {
        ...LEER,
        sperrungen: [
          {
            am: "2026-11-03T08:00:00.000Z",
            von: "Dario",
            version: 2,
            betragCent: 248000,
            ersteAnpassung: { key: "Wandschrank", grund: "eingespieltes Team" },
            anpassungen: 1,
          },
        ],
      },
      JETZT
    );
    expect(zeilen[1]).toEqual({
      art: "system",
      id: "sys:sperrung:2",
      zeit: "2026-11-03T08:00:00.000Z",
      text: "Kalkulation geprüft von Dario · Wandschrank: eingespieltes Team · KV v2 · 2.480 €",
      betont: "KV v2 · 2.480 €",
    });
  });

  it("Kalkulation: mehrere Anpassungen mit +N weitere, Label aus dem Schlüssel; ohne Anpassung entfällt der Teil", () => {
    const zeilen = systemzeilenAus(
      {
        ...LEER,
        sperrungen: [
          { am: "2026-11-03T08:00:00.000Z", von: "Dario", version: 1, betragCent: 199050, ersteAnpassung: { key: "team", grund: "drei Leute reichen" }, anpassungen: 3 },
          { am: "2026-11-04T08:00:00.000Z", von: null, version: 2, betragCent: null, ersteAnpassung: null, anpassungen: 0 },
        ],
      },
      JETZT
    );
    expect(zeilen[1].text).toBe("Kalkulation geprüft von Dario · Team: drei Leute reichen · +2 weitere · KV v1 · 1.990,50 €");
    expect(zeilen[1].betont).toBe("KV v1 · 1.990,50 €");
    expect(zeilen[2].text).toBe("Kalkulation geprüft · KV v2");
    expect(zeilen[2].betont).toBe("KV v2");
  });

  it("KV gesendet je Kanal", () => {
    const zeilen = systemzeilenAus(
      {
        ...LEER,
        versand: [
          { am: "2026-11-03T09:00:00.000Z", version: 2, kanal: "whatsapp" },
          { am: "2026-11-04T09:00:00.000Z", version: 3, kanal: "email" },
          { am: "2026-11-05T09:00:00.000Z", version: 4, kanal: "" },
        ],
      },
      JETZT
    );
    expect(zeilen.slice(1)).toEqual([
      { art: "system", id: "sys:versand:2", zeit: "2026-11-03T09:00:00.000Z", text: "KV v2 gesendet · WhatsApp", betont: null },
      { art: "system", id: "sys:versand:3", zeit: "2026-11-04T09:00:00.000Z", text: "KV v3 gesendet · E-Mail", betont: null },
      { art: "system", id: "sys:versand:4", zeit: "2026-11-05T09:00:00.000Z", text: "KV v4 gesendet", betont: null },
    ]);
  });

  it("Link geöffnet: heute mit Uhrzeit, sonst Wochentag und Datum (Berlin)", () => {
    const heute = systemzeilenAus({ ...LEER, geoeffnet: { anzahl: 3, zuletzt: "2026-11-06T07:12:00.000Z" } }, JETZT);
    expect(heute[1]).toEqual({
      art: "system",
      id: "sys:geoeffnet",
      zeit: "2026-11-06T07:12:00.000Z",
      text: "Kunde hat den Link geöffnet · 3× · zuletzt heute 08:12",
      betont: null,
    });
    // 02.11.2026 23:30 UTC ist in Berlin schon Dienstag, der 03.11.
    const frueher = systemzeilenAus({ ...LEER, geoeffnet: { anzahl: 1, zuletzt: "2026-11-02T23:30:00.000Z" } }, JETZT);
    expect(frueher[1].text).toBe("Kunde hat den Link geöffnet · 1× · zuletzt Di 03.11.");
    const nie = systemzeilenAus({ ...LEER, geoeffnet: { anzahl: 0, zuletzt: "2026-11-02T23:30:00.000Z" } }, JETZT);
    expect(nie).toHaveLength(1);
  });

  it("Zahlung erfasst mit und ohne Zahlungsart", () => {
    const zeilen = systemzeilenAus(
      {
        ...LEER,
        zahlungen: [
          { id: "pay_a", am: "2026-11-05T10:00:00.000Z", betragCent: 50000, art: "bank_transfer" },
          { id: "pay_b", am: "2026-11-05T11:00:00.000Z", betragCent: 12550, art: null },
          { id: "pay_c", am: "2026-11-05T12:00:00.000Z", betragCent: 1000, art: "Scheck" },
          { id: "pay_d", am: "2026-11-05T13:00:00.000Z", betragCent: 2000, art: "bar" },
          { id: "pay_e", am: "2026-11-05T14:00:00.000Z", betragCent: 3000, art: "  " },
        ],
      },
      JETZT
    );
    expect(zeilen.slice(1).map((z) => [z.id, z.text, z.betont])).toEqual([
      ["sys:zahlung:pay_a", "Zahlung erfasst · 500 € · Überweisung", null],
      ["sys:zahlung:pay_b", "Zahlung erfasst · 125,50 €", null],
      ["sys:zahlung:pay_c", "Zahlung erfasst · 10 € · Scheck", null],
      ["sys:zahlung:pay_d", "Zahlung erfasst · 20 € · Bar", null],
      ["sys:zahlung:pay_e", "Zahlung erfasst · 30 €", null],
    ]);
  });

  it("IDs der Zahlungs- und Kundenzeilen bleiben stabil, wenn eine rückdatierte Zeile dazukommt", () => {
    const zahlung = { id: "pay_spaet", am: "2026-11-05T10:00:00.000Z", betragCent: 50000, art: "cash" };
    const ereignis = { id: "ev_spaet", am: "2026-11-05T10:00:00.000Z", typ: "customer.kva_signed", payload: {} };
    const vorher = systemzeilenAus({ ...LEER, zahlungen: [zahlung], kundenereignisse: [ereignis] }, JETZT);
    const nachher = systemzeilenAus(
      {
        ...LEER,
        zahlungen: [{ id: "pay_frueh", am: "2026-10-01", betragCent: 10000, art: null }, zahlung],
        kundenereignisse: [{ id: "ev_frueh", am: "2026-10-01T10:00:00.000Z", typ: "customer.kva_confirmed", payload: {} }, ereignis],
      },
      JETZT
    );
    const id = (zeilen: typeof vorher, text: string) => zeilen.find((z) => z.text === text)?.id;
    expect(id(vorher, "Zahlung erfasst · 500 € · Bar")).toBe("sys:zahlung:pay_spaet");
    expect(id(nachher, "Zahlung erfasst · 500 € · Bar")).toBe("sys:zahlung:pay_spaet");
    expect(id(vorher, "Kunde hat unterschrieben")).toBe("sys:kunde:ev_spaet");
    expect(id(nachher, "Kunde hat unterschrieben")).toBe("sys:kunde:ev_spaet");
  });

  it("Kundenereignisse mit exaktem Text, unbekannte Typen fallen weg", () => {
    const zeilen = systemzeilenAus(
      {
        ...LEER,
        kundenereignisse: [
          { id: "ev_0", am: "2026-11-04T10:00:00.000Z", typ: "customer.kva_confirmed", payload: { confirmedTotalCents: 248000 } },
          { id: "ev_1", am: "2026-11-04T10:05:00.000Z", typ: "customer.kva_signed", payload: {} },
          { id: "ev_2", am: "2026-11-04T10:10:00.000Z", typ: "customer.date_selected", payload: { selectedDate: "2026-11-20" } },
          { id: "ev_3", am: "2026-11-05T10:00:00.000Z", typ: "customer.marked_paid", payload: { amountCents: 50000, variant: "deposit" } },
          { id: "ev_4", am: "2026-11-05T11:00:00.000Z", typ: "customer.marked_paid", payload: {} },
          { id: "ev_5", am: "2026-11-05T12:00:00.000Z", typ: "customer.date_selected", payload: null },
          { id: "ev_6", am: "2026-11-05T13:00:00.000Z", typ: "customer.something", payload: {} },
        ],
      },
      JETZT
    );
    expect(zeilen.slice(1).map((z) => [z.id, z.zeit, z.text, z.betont])).toEqual([
      ["sys:kunde:ev_0", "2026-11-04T10:00:00.000Z", "Kunde hat angenommen", null],
      ["sys:kunde:ev_1", "2026-11-04T10:05:00.000Z", "Kunde hat unterschrieben", null],
      ["sys:kunde:ev_2", "2026-11-04T10:10:00.000Z", "Kunde hat einen Termin gewählt · Fr 20.11.", null],
      ["sys:kunde:ev_3", "2026-11-05T10:00:00.000Z", "Kunde meldet bezahlt · 500 €", null],
      ["sys:kunde:ev_4", "2026-11-05T11:00:00.000Z", "Kunde meldet bezahlt", null],
      ["sys:kunde:ev_5", "2026-11-05T12:00:00.000Z", "Kunde hat einen Termin gewählt", null],
    ]);
  });

  it("keine Gedankenstriche in den Texten", () => {
    const zeilen = systemzeilenAus(
      {
        erstelltAm: "2026-11-01T09:00:00.000Z",
        firma: "Kottke",
        quelle: "Kleinanzeigen",
        fotoanalyse: { am: "2026-11-02T10:00:00.000Z", teile: 31, volumenCbm: 38 },
        sperrungen: [{ am: "2026-11-03T08:00:00.000Z", von: "Dario", version: 2, betragCent: 248000, ersteAnpassung: { key: "marge", grund: "Stammkunde" }, anpassungen: 2 }],
        versand: [{ am: "2026-11-03T09:00:00.000Z", version: 2, kanal: "whatsapp" }],
        geoeffnet: { anzahl: 3, zuletzt: "2026-11-06T07:12:00.000Z" },
        zahlungen: [{ id: "pay_1", am: "2026-11-05", betragCent: 50000, art: "cash" }],
        kundenereignisse: [{ id: "ev_1", am: "2026-11-04T10:00:00.000Z", typ: "customer.kva_confirmed", payload: {} }],
      },
      JETZT
    );
    expect(zeilen).toHaveLength(7);
    for (const z of zeilen) expect(z.text).not.toMatch(/[–—]/);
    expect(zeilen.find((z) => z.id === "sys:zahlung:pay_1")?.text).toBe("Zahlung erfasst · 500 € · Bar");
  });
});

describe("anpassungLabel", () => {
  it("bekannte Schlüssel deutsch, eigene Schlüssel unverändert", () => {
    expect(anpassungLabel("volumen")).toBe("Volumen");
    expect(anpassungLabel("beladen.etage")).toBe("Etage Beladen");
    expect(anpassungLabel("halteverbot.entladen")).toBe("Halteverbot Entladen");
    expect(anpassungLabel("personal.arbeit")).toBe("Arbeit");
    expect(anpassungLabel("marge")).toBe("Marge");
    expect(anpassungLabel("Wandschrank")).toBe("Wandschrank");
  });
});

describe("kannSendenAus", () => {
  const basis = { direkt: true, kanal: "whatsapp" as const, waPhoneNumberId: null, bridge: null };
  it("nur direkt und WABA, Baileys inhouse oder E-Mail", () => {
    expect(kannSendenAus({ ...basis, waPhoneNumberId: "pn_1" })).toBe(true);
    expect(kannSendenAus({ ...basis, bridge: "inhouse" })).toBe(true);
    expect(kannSendenAus({ ...basis, bridge: "openclaw" })).toBe(false);
    expect(kannSendenAus({ ...basis, bridge: null })).toBe(false);
    expect(kannSendenAus({ ...basis, kanal: "email" })).toBe(true);
    expect(kannSendenAus({ ...basis, kanal: "sms" })).toBe(false);
    expect(kannSendenAus({ ...basis, direkt: false, waPhoneNumberId: "pn_1" })).toBe(false);
    expect(kannSendenAus({ ...basis, direkt: false, kanal: "email" })).toBe(false);
  });
});

describe("vorauswahlAus", () => {
  const k = (gespraechId: string, kannSenden: boolean) => ({ gespraechId, kannSenden });
  it("sendefähiges Gespräch der letzten eingehenden Nachricht", () => {
    const v = vorauswahlAus(
      [k("c_wa", true), k("c_mail", true)],
      [
        nachricht("a", "2026-11-03T10:00:00.000Z", { gespraechId: "c_mail" }),
        nachricht("b", "2026-11-02T10:00:00.000Z", { gespraechId: "c_wa" }),
        nachricht("c", "2026-11-04T10:00:00.000Z", { gespraechId: "c_wa", richtung: "outbound", von: null }),
      ]
    );
    expect(v).toBe("c_mail");
  });

  it("nie ein nicht sendefähiges Gespräch, auch wenn dort die letzte Kundennachricht liegt", () => {
    const v = vorauswahlAus(
      [k("c_wa", true), k("c_fremd", false)],
      [
        nachricht("a", "2026-11-05T10:00:00.000Z", { gespraechId: "c_fremd" }),
        nachricht("b", "2026-11-02T10:00:00.000Z", { gespraechId: "c_wa" }),
      ]
    );
    expect(v).toBe("c_wa");
  });

  it("ohne eingehende Nachricht: sendefähiges Gespräch mit der letzten Nachricht, sonst das erste sendefähige", () => {
    expect(
      vorauswahlAus(
        [k("c_wa", true), k("c_mail", true)],
        [
          nachricht("a", "2026-11-03T10:00:00.000Z", { gespraechId: "c_wa", richtung: "outbound", von: null }),
          nachricht("b", "2026-11-04T10:00:00.000Z", { gespraechId: "c_mail", richtung: "outbound", von: null }),
        ]
      )
    ).toBe("c_mail");
    expect(vorauswahlAus([k("c_fremd", false), k("c_wa", true)], [])).toBe("c_wa");
  });

  it("kein sendefähiges Gespräch → null", () => {
    expect(vorauswahlAus([], [])).toBeNull();
    expect(vorauswahlAus([k("c_fremd", false)], [nachricht("a", "2026-11-05T10:00:00.000Z", { gespraechId: "c_fremd" })])).toBeNull();
  });
});
