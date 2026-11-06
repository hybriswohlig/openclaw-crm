import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getPersonMessages: vi.fn(),
  listCallsForRecord: vi.fn(),
  listPayments: vi.fn(),
  istImFenster: vi.fn(),
}));

// Nur `db.execute` ist erlaubt; jeder andere Zugriff (update, insert, …) lässt den Test scheitern.
vi.mock("@/db", () => ({
  db: new Proxy(
    {},
    {
      get(_t, p) {
        if (p === "execute") return mocks.execute;
        if (p === "then" || typeof p === "symbol") return undefined;
        throw new Error(`@/db im Test (${String(p)})`);
      },
    }
  ),
}));
vi.mock("@/services/inbox", () => ({ getPersonMessages: mocks.getPersonMessages }));
vi.mock("@/services/phone-calls", () => ({ listCallsForRecord: mocks.listCallsForRecord }));
vi.mock("@/services/financial", () => ({ listPayments: mocks.listPayments }));
vi.mock("@/services/inbox-senden", () => ({ istImFenster: mocks.istImFenster }));

import {
  dbGespraechSpeicher,
  dealGespraeche,
  ersteAnpassungAus,
  ladeEinzelgespraech,
  ladeGespraech,
  type AnrufRoh,
  type GespraechRoh,
  type GespraechSpeicher,
} from "./gespraech";
import type { PersonTimelineMessage } from "@/services/inbox";
import type { SystemFakten } from "@/lib/gespraech";

const WS = "ws_1";
const DEAL = "deal_1";

const dialekt = new PgDialect();
const gerendert = (call: unknown[]) => {
  const q = dialekt.sqlToQuery(call[0] as SQL);
  return { text: q.sql.replace(/\s+/g, " ").trim(), params: q.params };
};

const FAKTEN: SystemFakten = {
  erstelltAm: "2026-11-01T08:00:00.000Z",
  firma: "Kottke",
  quelle: "Kleinanzeigen",
  fotoanalyse: null,
  sperrungen: [],
  versand: [],
  geoeffnet: null,
  zahlungen: [],
  kundenereignisse: [],
};

const roh = (over: Partial<GespraechRoh> & { id: string }): GespraechRoh => ({
  dealRecordId: DEAL,
  kanal: "whatsapp",
  name: "Kottke WhatsApp",
  kontoId: "acc_wa",
  waPhoneNumberId: "pn_1",
  bridge: null,
  telefon: "+4915100000001",
  kundeName: "Familie Weber",
  ...over,
});

const msg = (over: Partial<PersonTimelineMessage> & { id: string; conversationId: string }): PersonTimelineMessage => ({
  direction: "inbound",
  body: over.id,
  sentAt: new Date("2026-11-02T10:00:00.000Z"),
  createdAt: new Date("2026-11-02T10:00:01.000Z"),
  channelType: "whatsapp",
  isKleinanzeigen: false,
  status: "received",
  attachments: [],
  ...over,
});

function speicher(teile: {
  gespraeche?: GespraechRoh[];
  einzel?: GespraechRoh | null;
  nachrichten?: PersonTimelineMessage[];
  anrufe?: AnrufRoh[];
  fakten?: SystemFakten;
  imFenster?: boolean | null;
}): GespraechSpeicher {
  return {
    gespraeche: vi.fn(async () => teile.gespraeche ?? []),
    einzelgespraech: vi.fn(async () => teile.einzel ?? null),
    nachrichten: vi.fn(async (_ws: string, ids: string[]) => (teile.nachrichten ?? []).filter((m) => ids.includes(m.conversationId))),
    anrufe: vi.fn(async () => teile.anrufe ?? []),
    fakten: vi.fn(async () => teile.fakten ?? FAKTEN),
    imFenster: vi.fn(async () => teile.imFenster ?? null),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockResolvedValue([]);
});

describe("dealGespraeche", () => {
  it("direkt über deal_record_id, indirekt über verknüpfte Personen, sendefähig wie im Gespräch; nur lesen, Workspace gefiltert", async () => {
    mocks.execute.mockResolvedValueOnce([
      { id: "c_wa", deal_record_id: DEAL, channel_type: "whatsapp", name: "WA", konto_id: "acc_wa", wa_phone_number_id: "pn", bridge: null, telefon: null, kunde_name: null },
      { id: "c_fremd", deal_record_id: "deal_2", channel_type: "whatsapp", name: "WA", konto_id: "acc_wa", wa_phone_number_id: "pn", bridge: null, telefon: null, kunde_name: null },
      { id: "c_leer", deal_record_id: null, channel_type: "email", name: "Mail", konto_id: "acc_mail", wa_phone_number_id: null, bridge: null, telefon: null, kunde_name: null },
      { id: "c_bridge", deal_record_id: DEAL, channel_type: "whatsapp", name: "WA", konto_id: "acc_b", wa_phone_number_id: null, bridge: "evolution", telefon: null, kunde_name: null },
    ]);
    const out = await dealGespraeche(WS, DEAL);
    expect(out).toEqual([
      { id: "c_wa", dealRecordId: DEAL, direkt: true, kannSenden: true },
      { id: "c_fremd", dealRecordId: "deal_2", direkt: false, kannSenden: false },
      { id: "c_leer", dealRecordId: null, direkt: false, kannSenden: false },
      // Direkt, aber ein Kanal, über den das CRM nicht senden kann.
      { id: "c_bridge", dealRecordId: DEAL, direkt: true, kannSenden: false },
    ]);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const { text, params } = gerendert(mocks.execute.mock.calls[0]);
    expect(text.toLowerCase()).not.toMatch(/\b(update|insert|delete)\b/);
    expect(text).toContain("c.workspace_id = $1");
    expect(text).toContain("ic.workspace_id = $");
    expect(text).toContain("c.deal_record_id = $");
    expect(text).toContain("ic.crm_record_id IN (SELECT rv.referenced_record_id FROM record_values rv WHERE rv.record_id = $");
    expect(params.filter((p) => p === WS)).toHaveLength(2);
    expect(params.filter((p) => p === DEAL)).toHaveLength(2);
  });
});

describe("ladeGespraech", () => {
  it("führt WhatsApp, E-Mail und Anruf nach Zeit zusammen; Vorauswahl = Gespräch der letzten Kundennachricht", async () => {
    const s = speicher({
      gespraeche: [
        roh({ id: "c_wa" }),
        roh({ id: "c_mail", kanal: "email", name: "Kottke Mail", kontoId: "acc_mail", waPhoneNumberId: null, telefon: null }),
      ],
      nachrichten: [
        msg({ id: "wa1", conversationId: "c_wa", sentAt: new Date("2026-11-02T09:00:00.000Z"), attachments: [{ id: "att1", fileName: "sofa.jpg", mimeType: "image/jpeg", fileSize: 10 }] }),
        msg({ id: "wa2", conversationId: "c_wa", direction: "outbound", status: "read", sentAt: new Date("2026-11-04T09:00:00.000Z") }),
        msg({ id: "mail1", conversationId: "c_mail", channelType: "email", sentAt: new Date("2026-11-03T09:00:00.000Z") }),
        msg({ id: "ohneZeit", conversationId: "c_mail", channelType: "email", sentAt: null, createdAt: new Date("2026-11-05T09:00:00.000Z") }),
      ],
      anrufe: [
        {
          id: "call1",
          startedAt: new Date("2026-11-02T15:00:00.000Z"),
          durationSeconds: 240,
          summary: "Termin besprochen",
          lineLabel: "Festnetz",
          answeredBy: "Dario",
          callerE164: "+4915500000201",
          callerRaw: "01550 0000201",
          transcript: "Kunde: Guten Tag, ich ziehe im Dezember um.",
        },
        {
          id: "call2",
          startedAt: new Date("2026-11-02T16:00:00.000Z"),
          durationSeconds: null,
          summary: null,
          lineLabel: null,
          answeredBy: null,
          callerE164: null,
          callerRaw: "anonym",
          transcript: "   ",
        },
      ],
      imFenster: true,
    });
    const out = await ladeGespraech(WS, DEAL, s);

    expect(out.eintraege.map((e) => e.id)).toEqual(["sys:lead", "wa1", "call1", "call2", "mail1", "wa2", "ohneZeit"]);
    expect(out.eintraege[1]).toEqual({
      art: "nachricht",
      id: "wa1",
      zeit: "2026-11-02T09:00:00.000Z",
      richtung: "inbound",
      kanal: "whatsapp",
      gespraechId: "c_wa",
      von: "Familie Weber",
      text: "wa1",
      status: "received",
      anhaenge: [{ id: "att1", name: "sofa.jpg", mime: "image/jpeg" }],
    });
    // Leitung, „angenommen von“ und Nummer kommen mit; das Transkript selbst nicht, nur ob es eines gibt.
    expect(out.eintraege[2]).toEqual({
      art: "anruf",
      id: "call1",
      zeit: "2026-11-02T15:00:00.000Z",
      dauerSek: 240,
      zusammenfassung: "Termin besprochen",
      leitung: "Festnetz",
      angenommenVon: "Dario",
      nummer: "+4915500000201",
      hatTranskript: true,
    });
    expect(out.eintraege[3]).toEqual({
      art: "anruf",
      id: "call2",
      zeit: "2026-11-02T16:00:00.000Z",
      dauerSek: null,
      zusammenfassung: null,
      leitung: null,
      angenommenVon: null,
      nummer: "anonym",
      hatTranskript: false,
    });
    expect(out.eintraege.find((e) => e.id === "wa2")).toMatchObject({ richtung: "outbound", von: null, status: "read" });
    expect(out.eintraege.find((e) => e.id === "ohneZeit")).toMatchObject({ zeit: "2026-11-05T09:00:00.000Z" });
    expect(out.eintraege[0]).toMatchObject({ art: "system", text: "Lead angelegt · Kottke · Quelle Kleinanzeigen · Neue Anfrage" });

    // letzte eingehende: ohneZeit (05.11.) im E-Mail-Gespräch
    expect(out.vorauswahl).toBe("c_mail");
    expect(out.kanaele).toEqual([
      { gespraechId: "c_mail", kanal: "email", name: "Kottke Mail", kontoId: "acc_mail", istWaba: false, telefon: null, kundeName: "Familie Weber", direkt: true, kannSenden: true, imFenster: null },
      { gespraechId: "c_wa", kanal: "whatsapp", name: "Kottke WhatsApp", kontoId: "acc_wa", istWaba: true, telefon: "+4915100000001", kundeName: "Familie Weber", direkt: true, kannSenden: true, imFenster: true },
    ]);
    expect(s.imFenster).toHaveBeenCalledTimes(1);
    expect(s.imFenster).toHaveBeenCalledWith("c_wa");
    expect(s.nachrichten).toHaveBeenCalledWith(WS, ["c_wa", "c_mail"]);
    expect(s.anrufe).toHaveBeenCalledWith(WS, DEAL);
  });

  it("indirekt gefundenes Gespräch eines anderen Deals: direkt false, kannSenden false, nie Vorauswahl", async () => {
    const s = speicher({
      gespraeche: [
        roh({ id: "c_wa", waPhoneNumberId: null, bridge: "inhouse" }),
        roh({ id: "c_fremd", dealRecordId: "deal_2", kontoId: "acc_wa2" }),
        roh({ id: "c_leer", dealRecordId: null, kanal: "email", waPhoneNumberId: null }),
      ],
      nachrichten: [
        msg({ id: "eigen", conversationId: "c_wa", sentAt: new Date("2026-11-02T09:00:00.000Z") }),
        msg({ id: "fremd", conversationId: "c_fremd", sentAt: new Date("2026-11-05T09:00:00.000Z") }),
        msg({ id: "leer", conversationId: "c_leer", channelType: "email", sentAt: new Date("2026-11-06T09:00:00.000Z") }),
      ],
    });
    const out = await ladeGespraech(WS, DEAL, s);
    expect(out.eintraege.map((e) => e.id)).toEqual(["sys:lead", "eigen", "fremd", "leer"]);
    expect(out.kanaele.map((k) => [k.gespraechId, k.direkt, k.kannSenden])).toEqual([
      ["c_wa", true, true],
      ["c_leer", false, false],
      ["c_fremd", false, false],
    ]);
    expect(out.vorauswahl).toBe("c_wa");
  });

  it("nur indirekte Gespräche: keine Vorauswahl", async () => {
    const s = speicher({
      gespraeche: [roh({ id: "c_fremd", dealRecordId: "deal_2" })],
      nachrichten: [msg({ id: "fremd", conversationId: "c_fremd" })],
    });
    const out = await ladeGespraech(WS, DEAL, s);
    expect(out.kanaele).toHaveLength(1);
    expect(out.kanaele[0]).toMatchObject({ direkt: false, kannSenden: false });
    expect(out.vorauswahl).toBeNull();
  });

  it("Deal ohne Gespräch: nur Systemzeilen, kanaele leer, Vorauswahl null", async () => {
    const s = speicher({ fakten: { ...FAKTEN, versand: [{ am: "2026-11-03T09:00:00.000Z", version: 1, kanal: "email" }] } });
    const out = await ladeGespraech(WS, DEAL, s);
    expect(out.kanaele).toEqual([]);
    expect(out.vorauswahl).toBeNull();
    expect(out.eintraege.map((e) => e.art)).toEqual(["system", "system"]);
    expect(s.nachrichten).not.toHaveBeenCalled();
  });
});

describe("ladeEinzelgespraech", () => {
  it("Gespräch ohne Deal: nur seine Nachrichten, ein Kanal, gilt als direkt (WABA sendet, Fenster abgefragt)", async () => {
    const s = speicher({
      einzel: roh({ id: "c_info", dealRecordId: null, kundeName: "Herr Unbekannt" }),
      anrufe: [{ id: "call1", startedAt: new Date("2026-11-04T08:00:00.000Z"), durationSeconds: 60, summary: null, lineLabel: null, answeredBy: null, callerE164: null, callerRaw: null, transcript: null }],
      imFenster: false,
    });
    // Der Speicher liefert auch eine fremde Nachricht: sie darf nie erscheinen.
    (s.nachrichten as ReturnType<typeof vi.fn>).mockImplementation(async () => [
      msg({ id: "m1", conversationId: "c_info", sentAt: new Date("2026-11-04T09:00:00.000Z") }),
      msg({ id: "m2", conversationId: "c_info", direction: "outbound", status: "delivered", sentAt: new Date("2026-11-04T10:00:00.000Z") }),
      msg({ id: "fremd", conversationId: "c_anders" }),
    ]);
    const out = await ladeEinzelgespraech(WS, "c_info", s);
    expect(out).not.toBeNull();
    expect(out!.eintraege.map((e) => e.id)).toEqual(["m1", "m2"]);
    expect(out!.eintraege[0]).toEqual({
      art: "nachricht",
      id: "m1",
      zeit: "2026-11-04T09:00:00.000Z",
      richtung: "inbound",
      kanal: "whatsapp",
      gespraechId: "c_info",
      von: "Herr Unbekannt",
      text: "m1",
      status: "received",
      anhaenge: [],
    });
    expect(out!.eintraege[1]).toMatchObject({ richtung: "outbound", von: null, status: "delivered" });
    expect(out!.kanaele).toEqual([
      { gespraechId: "c_info", kanal: "whatsapp", name: "Kottke WhatsApp", kontoId: "acc_wa", istWaba: true, telefon: "+4915100000001", kundeName: "Herr Unbekannt", direkt: true, kannSenden: true, imFenster: false },
    ]);
    expect(out!.vorauswahl).toBe("c_info");
    expect(s.einzelgespraech).toHaveBeenCalledWith(WS, "c_info");
    expect(s.nachrichten).toHaveBeenCalledWith(WS, ["c_info"]);
    expect(s.imFenster).toHaveBeenCalledWith("c_info");
    // Anrufe und Systemzeilen hängen am Deal: nie gelesen.
    expect(s.anrufe).not.toHaveBeenCalled();
    expect(s.fakten).not.toHaveBeenCalled();
    expect(s.gespraeche).not.toHaveBeenCalled();
  });

  it("kannSenden nach denselben Regeln: E-Mail ja (kein Fenster), Baileys inhouse ja, andere Bridge und SMS nein", async () => {
    const fall = async (over: Partial<GespraechRoh>) => {
      const s = speicher({ einzel: roh({ id: "c", dealRecordId: null, ...over }) });
      const out = await ladeEinzelgespraech(WS, "c", s);
      return { k: out!.kanaele[0], fenster: (s.imFenster as ReturnType<typeof vi.fn>).mock.calls.length, vorauswahl: out!.vorauswahl };
    };
    const mail = await fall({ kanal: "email", waPhoneNumberId: null });
    expect(mail.k).toMatchObject({ kanal: "email", istWaba: false, kannSenden: true, imFenster: null, direkt: true });
    expect(mail.fenster).toBe(0);
    expect(mail.vorauswahl).toBe("c");
    expect((await fall({ waPhoneNumberId: null, bridge: "inhouse" })).k).toMatchObject({ istWaba: false, kannSenden: true, imFenster: null });
    const openclaw = await fall({ waPhoneNumberId: null, bridge: "openclaw" });
    expect(openclaw.k).toMatchObject({ kannSenden: false, imFenster: null });
    expect(openclaw.vorauswahl).toBeNull();
    expect((await fall({ kanal: "sms", waPhoneNumberId: null })).k).toMatchObject({ kanal: "sms", kannSenden: false });
  });

  it("Gespräch an einem Deal: trotzdem nur dieses Gespräch, direkt true", async () => {
    const s = speicher({ einzel: roh({ id: "c_wa", dealRecordId: "deal_9" }) });
    const out = await ladeEinzelgespraech(WS, "c_wa", s);
    expect(out!.kanaele.map((k) => [k.gespraechId, k.direkt, k.kannSenden])).toEqual([["c_wa", true, true]]);
    expect(out!.eintraege).toEqual([]);
  });

  it("unbekannt oder fremder Workspace → null, sonst nichts gelesen", async () => {
    const s = speicher({ einzel: null });
    expect(await ladeEinzelgespraech(WS, "c_fremd", s)).toBeNull();
    expect(s.nachrichten).not.toHaveBeenCalled();
    expect(s.imFenster).not.toHaveBeenCalled();
  });
});

describe("dbGespraechSpeicher.einzelgespraech", () => {
  it("liest genau ein Gespräch, gefiltert auf Workspace und ID, nur lesen", async () => {
    mocks.execute.mockResolvedValueOnce([
      { id: "c_1", deal_record_id: null, channel_type: "email", name: "Kottke Mail", konto_id: "acc_mail", wa_phone_number_id: null, bridge: null, telefon: null, kunde_name: "Herr X" },
    ]);
    expect(await dbGespraechSpeicher.einzelgespraech(WS, "c_1")).toEqual({
      id: "c_1",
      dealRecordId: null,
      kanal: "email",
      name: "Kottke Mail",
      kontoId: "acc_mail",
      waPhoneNumberId: null,
      bridge: null,
      telefon: null,
      kundeName: "Herr X",
    });
    const { text, params } = gerendert(mocks.execute.mock.calls[0]);
    expect(text.toLowerCase()).not.toMatch(/\b(update|insert|delete)\b/);
    expect(text).toContain("c.workspace_id = $1 AND c.id = $2");
    expect(params).toEqual([WS, "c_1"]);
  });

  it("keine Zeile → null", async () => {
    mocks.execute.mockResolvedValueOnce([]);
    expect(await dbGespraechSpeicher.einzelgespraech(WS, "c_x")).toBeNull();
  });
});

describe("ersteAnpassungAus", () => {
  const u = (art: string, key: string, wert: unknown, grund: string) => ({ id: `${art}:${key}:${grund}`, art, key, wert, grund, rechnerwert: null, autor: { userId: null, quelle: "mensch" }, zeit: "", fotoRef: null });
  it("erste wirksame Übersteuerung; Zeitposten mit Bezeichnung; Aufgehobene zählen nicht", () => {
    expect(
      ersteAnpassungAus([
        u("zeitposten", "zp_1", { bezeichnung: "Wandschrank", minuten: 90 }, "eingespieltes Team"),
        u("eingabe", "team", 3, "drei Leute"),
        u("marge", "marge", 40, "Stammkunde"),
        u("marge", "marge", null, "zurück"),
      ])
    ).toEqual({ ersteAnpassung: { key: "Wandschrank", grund: "eingespieltes Team" }, anpassungen: 2 });
  });
  it("leer, kaputt oder kein Array → keine Anpassung", () => {
    expect(ersteAnpassungAus([])).toEqual({ ersteAnpassung: null, anpassungen: 0 });
    expect(ersteAnpassungAus(null)).toEqual({ ersteAnpassung: null, anpassungen: 0 });
    expect(ersteAnpassungAus([{ foo: 1 }, "x"])).toEqual({ ersteAnpassung: null, anpassungen: 0 });
  });
});

describe("dbGespraechSpeicher.fakten", () => {
  it("liest Deal, Fotoanalyse, Versionen, Link und Kundenereignisse je Workspace und Deal", async () => {
    mocks.execute.mockImplementation(async (q: SQL) => {
      const text = dialekt.sqlToQuery(q).sql;
      if (text.includes("FROM records r")) return [{ erstellt_am: "2026-11-01 08:00:00", quelle: "Kleinanzeigen", firma: "Kottke" }];
      if (text.includes("fotos_erledigt")) return [{ foto_am: "2026-11-02 10:00:00.123", teile: "31", volumen: "38.20" }];
      if (text.includes("deal_calculation_versions")) {
        return [
          {
            version: 1,
            status: "gesperrt",
            price_cents: 199000,
            locked_at: "2026-11-02 12:00:00",
            gesperrt_von: "Dario",
            sent_at: null,
            sent_via: null,
            overrides: [],
          },
          {
            version: 2,
            status: "gesperrt",
            price_cents: 248000,
            locked_at: "2026-11-03 08:00:00",
            gesperrt_von: "Dario",
            sent_at: "2026-11-03 09:00:00",
            sent_via: "whatsapp",
            overrides: JSON.stringify([{ id: "o1", art: "zeitposten", key: "zp", wert: { bezeichnung: "Wandschrank", minuten: 60 }, grund: "eingespieltes Team" }]),
          },
          { version: 3, status: "entwurf", price_cents: 250000, locked_at: null, gesperrt_von: null, sent_at: null, sent_via: null, overrides: [] },
        ];
      }
      if (text.includes("customer_status_links")) return [{ view_count: 3, last_viewed_at: "2026-11-06 07:12:00" }];
      if (text.includes("activity_events")) {
        return [
          { id: "ev_1", event_type: "customer.kva_confirmed", payload: { confirmationId: "k1" }, created_at: "2026-11-04 10:00:00" },
          { id: "ev_2", event_type: "customer.marked_paid", payload: JSON.stringify({ amountCents: 50000 }), created_at: "2026-11-05 10:00:00" },
        ];
      }
      throw new Error(`unerwartete Abfrage: ${text}`);
    });
    mocks.listPayments.mockResolvedValue([
      { id: "pay_1", date: "2026-11-05", amount: "500.00", paymentMethod: "bank_transfer", createdAt: new Date("2026-11-05T11:00:00.000Z") },
      { id: "pay_2", date: "2026-10-30", amount: "125.50", paymentMethod: null, createdAt: new Date("2026-11-05T11:05:00.000Z") },
    ]);

    const f = await dbGespraechSpeicher.fakten(WS, DEAL);
    expect(f).toEqual({
      erstelltAm: "2026-11-01T08:00:00.000Z",
      firma: "Kottke",
      quelle: "Kleinanzeigen",
      fotoanalyse: { am: "2026-11-02T10:00:00.123Z", teile: 31, volumenCbm: 38.2 },
      sperrungen: [
        { am: "2026-11-02T12:00:00.000Z", von: "Dario", version: 1, betragCent: 199000, ersteAnpassung: null, anpassungen: 0 },
        { am: "2026-11-03T08:00:00.000Z", von: "Dario", version: 2, betragCent: 248000, ersteAnpassung: { key: "Wandschrank", grund: "eingespieltes Team" }, anpassungen: 1 },
      ],
      versand: [{ am: "2026-11-03T09:00:00.000Z", version: 2, kanal: "whatsapp" }],
      geoeffnet: { anzahl: 3, zuletzt: "2026-11-06T07:12:00.000Z" },
      zahlungen: [
        { id: "pay_1", am: "2026-11-05T11:00:00.000Z", betragCent: 50000, art: "bank_transfer" },
        { id: "pay_2", am: "2026-10-30", betragCent: 12550, art: null },
      ],
      kundenereignisse: [
        { id: "ev_1", am: "2026-11-04T10:00:00.000Z", typ: "customer.kva_confirmed", payload: { confirmationId: "k1" } },
        { id: "ev_2", am: "2026-11-05T10:00:00.000Z", typ: "customer.marked_paid", payload: { amountCents: 50000 } },
      ],
    });
    expect(mocks.listPayments).toHaveBeenCalledWith(DEAL);
    expect(mocks.execute).toHaveBeenCalledTimes(5);
    for (const call of mocks.execute.mock.calls) {
      const { text, params } = gerendert(call);
      expect(text.toLowerCase()).not.toMatch(/\b(update|insert|delete)\b/);
      expect(params).toContain(WS);
      expect(params).toContain(DEAL);
    }
  });

  it("Deal ohne alles: nur erstelltAm, sonst leer", async () => {
    mocks.execute.mockImplementation(async (q: SQL) => {
      const text = dialekt.sqlToQuery(q).sql;
      if (text.includes("FROM records r")) return [{ erstellt_am: "2026-11-01 08:00:00", quelle: null, firma: null }];
      if (text.includes("fotos_erledigt")) return [{ foto_am: null, teile: "0", volumen: null }];
      return [];
    });
    mocks.listPayments.mockResolvedValue([]);
    expect(await dbGespraechSpeicher.fakten(WS, DEAL)).toEqual({
      erstelltAm: "2026-11-01T08:00:00.000Z",
      firma: null,
      quelle: null,
      fotoanalyse: null,
      sperrungen: [],
      versand: [],
      geoeffnet: null,
      zahlungen: [],
      kundenereignisse: [],
    });
  });
});
