import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  insert: vi.fn(),
  getDealStageCategory: vi.fn(),
  isAgentSuppressedStrict: vi.fn(),
  sendeAntwort: vi.fn(),
  nachEigenerNachricht: vi.fn(),
  istImFenster: vi.fn(),
  updateRecord: vi.fn(),
  gespraecheLesen: vi.fn(),
  ladeGespeicherteAnrede: vi.fn(),
}));

// Nur `db.execute` und `db.insert` sind erlaubt (dbBewertungSpeicher); alles andere lässt den Test scheitern.
vi.mock("@/db", () => ({
  db: new Proxy(
    {},
    {
      get(_t, p) {
        if (p === "execute") return mocks.execute;
        if (p === "insert") return mocks.insert;
        if (p === "then" || typeof p === "symbol") return undefined;
        throw new Error(`@/db im Test (${String(p)})`);
      },
    }
  ),
}));
vi.mock("@/services/agent/agent-gate", () => ({
  getDealStageCategory: mocks.getDealStageCategory,
  isAgentSuppressedStrict: mocks.isAgentSuppressedStrict,
}));
vi.mock("@/services/agent/agent-suppress", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/agent/agent-suppress")>();
  return { ...actual, ladeGespeicherteAnrede: mocks.ladeGespeicherteAnrede };
});
vi.mock("@/services/inbox-senden", () => ({
  sendeAntwort: mocks.sendeAntwort,
  nachEigenerNachricht: mocks.nachEigenerNachricht,
  istImFenster: mocks.istImFenster,
}));
vi.mock("@/services/records", () => ({ updateRecord: mocks.updateRecord }));
vi.mock("@/services/gespraech", () => ({ dbGespraechSpeicher: { gespraeche: mocks.gespraecheLesen } }));

import {
  BewertungFehler,
  bewertungAnfragen,
  bewertungsVorschau,
  dbBewertungSpeicher,
  type BewertungRoh,
  type BewertungSpeicher,
} from "./bewertung-anfragen";
import { BEWERTUNGSLINK_PLATZHALTER, STOP_ZEILE_SIE } from "@/lib/reviews/manuell";
import type { GespraechRoh } from "@/services/gespraech";
import { WhatsAppSessionExpiredError } from "@/services/inbox-whatsapp";

const WS = "ws_1";
const DEAL = "deal_1";
const APP = "https://crm.example.de";
const GOOGLE = "https://g.page/r/kottke/review";
// Di 10.11.2026, 11:00 Berlin: außerhalb der Ruhezeit
const WERKTAG = new Date("2026-11-10T10:00:00Z");

const WABA: GespraechRoh = {
  id: "conv_waba",
  dealRecordId: DEAL,
  kanal: "whatsapp",
  name: "Kottke WhatsApp",
  kontoId: "acc_1",
  waPhoneNumberId: "pn_1",
  bridge: null,
  telefon: "+49 170 1234567",
  kundeName: "Anna Berger",
};
const BAILEYS: GespraechRoh = { ...WABA, id: "conv_baileys", name: "Kottke Handy", waPhoneNumberId: null, bridge: "inhouse" };

function roh(teil: Partial<BewertungRoh> = {}): BewertungRoh {
  return {
    objectId: "obj_deals",
    statusTitel: "not_due",
    nichtKontaktieren: false,
    versuche: 0,
    markeTitel: "kottke",
    firmaName: "Kottke Umzüge",
    googleUrl: GOOGLE,
    personId: "person_1",
    vorname: "Anna",
    leistung: "move",
    ...teil,
  };
}

function fake(start: {
  roh?: Partial<BewertungRoh>;
  gespraeche?: GespraechRoh[];
  einwilligung?: boolean;
  anrede?: "sie" | "du";
  optionen?: { statusGesendet: string | null; varianteManuell: string | null };
} = {}) {
  const speicher: BewertungSpeicher = {
    lesen: vi.fn(async () => roh(start.roh)),
    gespraeche: vi.fn(async () => start.gespraeche ?? [WABA]),
    einwilligungDa: vi.fn(async () => start.einwilligung ?? true),
    anrede: vi.fn(async () => start.anrede ?? "sie"),
    optionen: vi.fn(async () => start.optionen ?? { statusGesendet: "st_sent_wa", varianteManuell: null }),
    tokenAnlegen: vi.fn(async () => {}),
    tokenLoeschen: vi.fn(async () => {}),
    einwilligungSpeichern: vi.fn(async () => "consent_1"),
    ereignis: vi.fn(async () => {}),
  };
  return speicher;
}

async function fehlerCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof BewertungFehler) return err.code;
    throw err;
  }
  throw new Error("kein Fehler geworfen");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(WERKTAG);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP);
  vi.stubEnv("REVIEWS_GBP_URL_KOTTKE", "");
  vi.stubEnv("REVIEWS_GBP_URL_CEYLAN", "");
  mocks.getDealStageCategory.mockResolvedValue({ statusId: "s", title: "Durchgeführt", category: "done_unpaid", isTerminal: false });
  mocks.isAgentSuppressedStrict.mockResolvedValue(false);
  mocks.istImFenster.mockResolvedValue(true);
  mocks.sendeAntwort.mockResolvedValue({
    message: { id: "msg_1", sentAt: new Date("2026-11-10T10:00:05Z") },
    dealRecordId: DEAL,
  });
  mocks.nachEigenerNachricht.mockResolvedValue(undefined);
  mocks.updateRecord.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const ANFRAGE = { userId: "usr_1" };

describe("Sperren je Fehlercode", () => {
  it.each(["open_new", "quoted", "booked", "lost", null])("Stufe %s → STUFE", async (category) => {
    mocks.getDealStageCategory.mockResolvedValue({ statusId: null, title: null, category, isTerminal: false });
    const s = fake();
    expect(await fehlerCode(bewertungAnfragen(WS, DEAL, ANFRAGE, s))).toBe("STUFE");
    expect(mocks.sendeAntwort).not.toHaveBeenCalled();
    expect(s.tokenAnlegen).not.toHaveBeenCalled();
  });

  it("Bezahlt ist erlaubt", async () => {
    mocks.getDealStageCategory.mockResolvedValue({ statusId: "s", title: "Bezahlt", category: "paid", isTerminal: true });
    await expect(bewertungAnfragen(WS, DEAL, ANFRAGE, fake())).resolves.toEqual({ gesendet: true, gespraechId: "conv_waba" });
  });

  it.each(["sent_sms", "sent_whatsapp", "clicked", "review_left"])("Status %s → SCHON_GESENDET", async (statusTitel) => {
    const s = fake({ roh: { statusTitel } });
    expect(await fehlerCode(bewertungAnfragen(WS, DEAL, ANFRAGE, s))).toBe("SCHON_GESENDET");
    expect(mocks.sendeAntwort).not.toHaveBeenCalled();
  });

  it("do_not_contact_review → SPERRE", async () => {
    const s = fake({ roh: { nichtKontaktieren: true } });
    expect(await fehlerCode(bewertungAnfragen(WS, DEAL, ANFRAGE, s))).toBe("SPERRE");
  });

  it("isAgentSuppressedStrict (STOP) → SPERRE, geprüft mit der Nummer des Gesprächs", async () => {
    mocks.isAgentSuppressedStrict.mockResolvedValue(true);
    expect(await fehlerCode(bewertungAnfragen(WS, DEAL, ANFRAGE, fake()))).toBe("SPERRE");
    expect(mocks.isAgentSuppressedStrict).toHaveBeenCalledWith(WS, { phone: WABA.telefon });
    expect(mocks.sendeAntwort).not.toHaveBeenCalled();
  });

  it("keine Einwilligung im Ledger und kein Eintrag → EINWILLIGUNG", async () => {
    const s = fake({ einwilligung: false });
    expect(await fehlerCode(bewertungAnfragen(WS, DEAL, ANFRAGE, s))).toBe("EINWILLIGUNG");
    expect(await fehlerCode(bewertungAnfragen(WS, DEAL, { ...ANFRAGE, einwilligung: "   " }, s))).toBe("EINWILLIGUNG");
    expect(s.einwilligungSpeichern).not.toHaveBeenCalled();
    expect(mocks.sendeAntwort).not.toHaveBeenCalled();
  });

  it("ohne verknüpfte Person kann keine Einwilligung gespeichert werden → EINWILLIGUNG", async () => {
    const s = fake({ einwilligung: false, roh: { personId: null } });
    expect(await fehlerCode(bewertungAnfragen(WS, DEAL, { ...ANFRAGE, einwilligung: "Am 03.11. am Telefon zugestimmt" }, s))).toBe(
      "EINWILLIGUNG"
    );
    expect(s.einwilligungSpeichern).not.toHaveBeenCalled();
  });

  it("nur indirekt verknüpftes WhatsApp-Gespräch → KEIN_KANAL", async () => {
    const s = fake({ gespraeche: [{ ...WABA, dealRecordId: "deal_anders" }, { ...BAILEYS, dealRecordId: null }] });
    expect(await fehlerCode(bewertungAnfragen(WS, DEAL, ANFRAGE, s))).toBe("KEIN_KANAL");
  });

  it("nur E-Mail oder OpenClaw direkt verknüpft → KEIN_KANAL", async () => {
    const email: GespraechRoh = { ...WABA, id: "conv_mail", kanal: "email", waPhoneNumberId: null };
    const openclaw: GespraechRoh = { ...WABA, id: "conv_oc", waPhoneNumberId: null, bridge: "openclaw" };
    expect(await fehlerCode(bewertungAnfragen(WS, DEAL, ANFRAGE, fake({ gespraeche: [email, openclaw] })))).toBe("KEIN_KANAL");
    expect(await fehlerCode(bewertungAnfragen(WS, DEAL, ANFRAGE, fake({ gespraeche: [] })))).toBe("KEIN_KANAL");
  });

  it("WABA außerhalb des 24-h-Fensters → FENSTER", async () => {
    mocks.istImFenster.mockResolvedValue(false);
    expect(await fehlerCode(bewertungAnfragen(WS, DEAL, ANFRAGE, fake()))).toBe("FENSTER");
    expect(mocks.istImFenster).toHaveBeenCalledWith("conv_waba");
  });

  it("Baileys kennt kein Fenster", async () => {
    mocks.istImFenster.mockResolvedValue(null);
    await expect(bewertungAnfragen(WS, DEAL, ANFRAGE, fake({ gespraeche: [BAILEYS] }))).resolves.toEqual({
      gesendet: true,
      gespraechId: "conv_baileys",
    });
    expect(mocks.istImFenster).not.toHaveBeenCalled();
  });

  it("Ablauf des Fensters beim Senden → FENSTER, Token wieder entfernt", async () => {
    mocks.sendeAntwort.mockRejectedValue(new WhatsAppSessionExpiredError());
    const s = fake();
    expect(await fehlerCode(bewertungAnfragen(WS, DEAL, ANFRAGE, s))).toBe("FENSTER");
    expect(s.tokenLoeschen).toHaveBeenCalledTimes(1);
    expect(s.ereignis).not.toHaveBeenCalled();
    expect(mocks.updateRecord).not.toHaveBeenCalled();
  });

  it.each([
    ["Sonntag", "2026-11-08T11:00:00Z"],
    ["abends", "2026-11-10T18:30:00Z"],
    ["früh", "2026-11-10T07:00:00Z"],
  ])("Ruhezeit (%s) → RUHEZEIT", async (_n, zeit) => {
    vi.setSystemTime(new Date(zeit));
    expect(await fehlerCode(bewertungAnfragen(WS, DEAL, ANFRAGE, fake()))).toBe("RUHEZEIT");
  });

  it("kein Google-Link an der Firma und keine Umgebungsvariable → KEIN_LINK", async () => {
    expect(await fehlerCode(bewertungAnfragen(WS, DEAL, ANFRAGE, fake({ roh: { googleUrl: null } })))).toBe("KEIN_LINK");
  });

  it("ungültiger Google-Link → KEIN_LINK", async () => {
    expect(await fehlerCode(bewertungAnfragen(WS, DEAL, ANFRAGE, fake({ roh: { googleUrl: "kein link" } })))).toBe("KEIN_LINK");
  });

  it("Marke weder aus brand noch aus der Firma → KEIN_LINK", async () => {
    const s = fake({ roh: { markeTitel: null, firmaName: "Andere GmbH" } });
    expect(await fehlerCode(bewertungAnfragen(WS, DEAL, ANFRAGE, s))).toBe("KEIN_LINK");
  });

  it("Umgebungsvariable als Rückfall für den Link", async () => {
    vi.stubEnv("REVIEWS_GBP_URL_KOTTKE", "https://g.page/r/env/review");
    const s = fake({ roh: { googleUrl: null } });
    await bewertungAnfragen(WS, DEAL, ANFRAGE, s);
    expect(s.tokenAnlegen).toHaveBeenCalledWith(expect.objectContaining({ destinationUrl: "https://g.page/r/env/review" }));
  });

  it("geänderter Text ohne Link → TEXT", async () => {
    const text = `Hallo Anna,\nbitte bewerten Sie uns.\n${STOP_ZEILE_SIE}`;
    expect(await fehlerCode(bewertungAnfragen(WS, DEAL, { ...ANFRAGE, text }, fake()))).toBe("TEXT");
    expect(mocks.sendeAntwort).not.toHaveBeenCalled();
  });

  it("geänderter Text ohne STOP-Zeile → TEXT", async () => {
    const text = `Hallo Anna,\nbitte bewerten Sie uns:\n${BEWERTUNGSLINK_PLATZHALTER}\nDanke!`;
    expect(await fehlerCode(bewertungAnfragen(WS, DEAL, { ...ANFRAGE, text }, fake()))).toBe("TEXT");
  });
});

describe("Erfolg", () => {
  it("Token, Link im Text, Senden, Vermerk, Felder, Ereignis", async () => {
    const s = fake();
    const res = await bewertungAnfragen(WS, DEAL, ANFRAGE, s);
    expect(res).toEqual({ gesendet: true, gespraechId: "conv_waba" });

    // Token in review_tokens
    expect(s.tokenAnlegen).toHaveBeenCalledTimes(1);
    const tokenZeile = vi.mocked(s.tokenAnlegen).mock.calls[0]![0];
    expect(tokenZeile).toEqual({ token: expect.stringMatching(/^[a-z2-7]{16}$/), workspaceId: WS, dealRecordId: DEAL, destinationUrl: GOOGLE });

    // Senden über sendeAntwort mit dem echten Link, dann nachEigenerNachricht
    expect(mocks.sendeAntwort).toHaveBeenCalledTimes(1);
    const { body, workspaceId, conversationId } = mocks.sendeAntwort.mock.calls[0]![0];
    expect(workspaceId).toBe(WS);
    expect(conversationId).toBe("conv_waba");
    expect(body).toContain(`\n${APP}/r/${tokenZeile.token}\n`);
    expect(body).not.toContain(BEWERTUNGSLINK_PLATZHALTER);
    expect(body.startsWith("Hallo Anna,")).toBe(true);
    expect(body.split("\n").at(-1)).toBe(STOP_ZEILE_SIE);
    expect(mocks.nachEigenerNachricht).toHaveBeenCalledWith({
      workspaceId: WS,
      conversationId: "conv_waba",
      dealRecordId: DEAL,
      userId: "usr_1",
      sentAt: new Date("2026-11-10T10:00:05Z"),
      deduped: false,
    });
    expect(mocks.sendeAntwort.mock.invocationCallOrder[0]!).toBeLessThan(mocks.nachEigenerNachricht.mock.invocationCallOrder[0]!);
    expect(s.tokenAnlegen.mock.invocationCallOrder[0]!).toBeLessThan(mocks.sendeAntwort.mock.invocationCallOrder[0]!);

    // Felder über updateRecord mit Status-ID aus dem Titel, ohne Variante (keine Option „manuell“)
    expect(mocks.updateRecord).toHaveBeenCalledTimes(1);
    expect(mocks.updateRecord).toHaveBeenCalledWith(
      "obj_deals",
      DEAL,
      {
        review_request_status: "st_sent_wa",
        review_request_sent_at: WERKTAG.toISOString(),
        review_request_attempt_count: 1,
      },
      "usr_1"
    );
    expect(mocks.updateRecord.mock.calls[0]![2]).not.toHaveProperty("review_contact_consent_at");

    // review_events
    expect(s.ereignis).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        dealRecordId: DEAL,
        eventType: "sent_whatsapp",
        channel: "whatsapp",
        meta: expect.objectContaining({ manuell: true, einwilligung: "ledger", token: tokenZeile.token, gespraech_id: "conv_waba" }),
      })
    );
    expect(s.einwilligungSpeichern).not.toHaveBeenCalled();
  });

  it("Variante „manuell“, wenn die Option existiert; Versuche + 1", async () => {
    const s = fake({ roh: { versuche: 2 }, optionen: { statusGesendet: "st_sent_wa", varianteManuell: "opt_manuell" } });
    await bewertungAnfragen(WS, DEAL, ANFRAGE, s);
    expect(mocks.updateRecord.mock.calls[0]![2]).toMatchObject({
      review_request_status: "st_sent_wa",
      review_request_variant: "opt_manuell",
      review_request_attempt_count: 3,
    });
    expect(s.optionen).toHaveBeenCalledWith("obj_deals");
  });

  it("ohne Status-Zeile sent_whatsapp bleibt der Status unverändert", async () => {
    const s = fake({ optionen: { statusGesendet: null, varianteManuell: null } });
    await bewertungAnfragen(WS, DEAL, ANFRAGE, s);
    expect(mocks.updateRecord.mock.calls[0]![2]).not.toHaveProperty("review_request_status");
  });

  it("Einwilligung des Inhabers wird vor dem Senden ins Ledger geschrieben", async () => {
    const s = fake({ einwilligung: false });
    const eintrag = "Am 03.11. am Telefon mündlich zugestimmt, Notiz von Dario";
    await bewertungAnfragen(WS, DEAL, { ...ANFRAGE, einwilligung: `  ${eintrag} ` }, s);
    expect(s.einwilligungSpeichern).toHaveBeenCalledWith({
      workspaceId: WS,
      personRecordId: "person_1",
      channel: "whatsapp",
      purpose: "review_request",
      exactWording: eintrag,
      sourceConversationId: "conv_waba",
    });
    expect(vi.mocked(s.einwilligungSpeichern).mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.sendeAntwort.mock.invocationCallOrder[0]!
    );
    expect(s.ereignis).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ manuell: true, einwilligung: "inhaber_eingetragen", einwilligung_id: "consent_1", einwilligung_von: "usr_1" }),
      })
    );
    expect(mocks.updateRecord.mock.calls[0]![2]).not.toHaveProperty("review_contact_consent_at");
  });

  it("vorhandene Einwilligung: Eintrag des Inhabers wird nicht zusätzlich gespeichert", async () => {
    const s = fake({ einwilligung: true });
    await bewertungAnfragen(WS, DEAL, { ...ANFRAGE, einwilligung: "doppelt" }, s);
    expect(s.einwilligungSpeichern).not.toHaveBeenCalled();
  });

  it("geänderter Text mit Platzhalter und STOP wird mit echtem Link gesendet", async () => {
    const text = `Hallo Anna, hier der Link:\n${BEWERTUNGSLINK_PLATZHALTER}\nAntworten Sie mit STOP, wenn Sie nichts mehr wollen.`;
    const s = fake();
    await bewertungAnfragen(WS, DEAL, { ...ANFRAGE, text }, s);
    const token = vi.mocked(s.tokenAnlegen).mock.calls[0]![0].token;
    expect(mocks.sendeAntwort.mock.calls[0]![0].body).toBe(text.replace(BEWERTUNGSLINK_PLATZHALTER, `${APP}/r/${token}`));
  });

  it("Baileys ohne gespeicherte Zeile (message null) gilt als gesendet", async () => {
    mocks.sendeAntwort.mockResolvedValue({ message: null, dealRecordId: DEAL });
    const s = fake({ gespraeche: [BAILEYS] });
    await expect(bewertungAnfragen(WS, DEAL, ANFRAGE, s)).resolves.toEqual({ gesendet: true, gespraechId: "conv_baileys" });
    expect(mocks.nachEigenerNachricht).toHaveBeenCalledWith(expect.objectContaining({ sentAt: WERKTAG, deduped: false }));
    expect(s.ereignis).toHaveBeenCalledWith(expect.objectContaining({ meta: expect.objectContaining({ message_id: null }) }));
  });

  it("du-Anrede aus dem Gespräch, Marke aus der Firma", async () => {
    const s = fake({ anrede: "du", roh: { markeTitel: null, firmaName: "Ceylan Umzüge GmbH", googleUrl: "https://g.page/r/ceylan" } });
    await bewertungAnfragen(WS, DEAL, ANFRAGE, s);
    const body: string = mocks.sendeAntwort.mock.calls[0]![0].body;
    expect(body).toContain("Ceylan-Team");
    expect(body.split("\n").at(-1)).toBe("Keine Nachrichten mehr? Antworte mit STOP.");
    expect(s.anrede).toHaveBeenCalledWith(WS, DEAL, "conv_waba");
  });

  it("nimmt das neueste direkt verknüpfte WhatsApp-Gespräch", async () => {
    const s = fake({ gespraeche: [WABA, BAILEYS] });
    expect(await bewertungAnfragen(WS, DEAL, ANFRAGE, s)).toEqual({ gesendet: true, gespraechId: "conv_baileys" });
  });

  it("anderer Sendefehler: Token entfernt, Fehler weitergereicht, nichts vermerkt", async () => {
    mocks.sendeAntwort.mockRejectedValue(new Error("Bridge weg"));
    const s = fake();
    await expect(bewertungAnfragen(WS, DEAL, ANFRAGE, s)).rejects.toThrow("Bridge weg");
    expect(s.tokenLoeschen).toHaveBeenCalledWith(WS, DEAL, vi.mocked(s.tokenAnlegen).mock.calls[0]![0].token);
    expect(mocks.nachEigenerNachricht).not.toHaveBeenCalled();
    expect(mocks.updateRecord).not.toHaveBeenCalled();
  });
});

describe("bewertungsVorschau", () => {
  it("Text mit Platzhalter, Kanal, Einwilligung, keine Sperre", async () => {
    const v = await bewertungsVorschau(WS, DEAL, fake());
    expect(v.sperre).toBeNull();
    expect(v.einwilligung).toBe(true);
    expect(v.kanal).toBe("Kottke WhatsApp");
    expect(v.text).toContain(BEWERTUNGSLINK_PLATZHALTER);
    expect(v.text.startsWith("Hallo Anna,")).toBe(true);
  });

  it("schreibt nichts", async () => {
    const s = fake();
    await bewertungsVorschau(WS, DEAL, s);
    expect(s.tokenAnlegen).not.toHaveBeenCalled();
    expect(s.einwilligungSpeichern).not.toHaveBeenCalled();
    expect(s.ereignis).not.toHaveBeenCalled();
    expect(mocks.sendeAntwort).not.toHaveBeenCalled();
    expect(mocks.updateRecord).not.toHaveBeenCalled();
  });

  it("fehlende Einwilligung ist keine Sperre, nur einwilligung: false", async () => {
    const v = await bewertungsVorschau(WS, DEAL, fake({ einwilligung: false }));
    expect(v).toMatchObject({ einwilligung: false, sperre: null });
  });

  it("ohne Person ist die fehlende Einwilligung eine Sperre", async () => {
    const v = await bewertungsVorschau(WS, DEAL, fake({ einwilligung: false, roh: { personId: null } }));
    expect(v.sperre).toBe("EINWILLIGUNG");
  });

  it("nennt die erste Sperre und ohne Kanal kanal null", async () => {
    mocks.getDealStageCategory.mockResolvedValue({ statusId: null, title: null, category: "booked", isTerminal: false });
    expect((await bewertungsVorschau(WS, DEAL, fake())).sperre).toBe("STUFE");
    mocks.getDealStageCategory.mockResolvedValue({ statusId: "s", title: "x", category: "done_unpaid", isTerminal: false });
    const ohne = await bewertungsVorschau(WS, DEAL, fake({ gespraeche: [] }));
    expect(ohne).toMatchObject({ sperre: "KEIN_KANAL", kanal: null });
    expect(ohne.text).toContain(BEWERTUNGSLINK_PLATZHALTER);
  });

  it("Ruhezeit in der Vorschau", async () => {
    vi.setSystemTime(new Date("2026-11-08T11:00:00Z"));
    expect((await bewertungsVorschau(WS, DEAL, fake())).sperre).toBe("RUHEZEIT");
  });
});

describe("dbBewertungSpeicher", () => {
  const dialect = new PgDialect();
  const sqlText = (q: SQL) => dialect.sqlToQuery(q);

  it("lesen: alles auf Workspace und Deal gefiltert, Status über text_value oder referenced_record_id", async () => {
    mocks.execute.mockResolvedValue({
      rows: [
        {
          object_id: "obj_deals",
          status_titel: "not_due",
          nicht_kontaktieren: true,
          versuche: "2",
          marke: "kottke",
          firma: "Kottke Umzüge",
          google_url: GOOGLE,
          person_id: "person_1",
          person_text: null,
          person_json: { first_name: "Anna", last_name: "Berger" },
          service_type: "move",
          mit_entruempelung: "true",
        },
      ],
    });
    const r = await dbBewertungSpeicher.lesen(WS, DEAL);
    expect(r).toEqual({
      objectId: "obj_deals",
      statusTitel: "not_due",
      nichtKontaktieren: true,
      versuche: 2,
      markeTitel: "kottke",
      firmaName: "Kottke Umzüge",
      googleUrl: GOOGLE,
      personId: "person_1",
      vorname: "Anna",
      leistung: "clearance_move",
    });
    const q = sqlText(mocks.execute.mock.calls[0]![0]);
    expect(q.params).toContain(WS);
    expect(q.params).toContain(DEAL);
    expect(q.sql).toContain("o.workspace_id");
    expect(q.sql).toContain("ps.workspace_id");
    expect(q.sql).toMatch(/s\.id = v\.text_value OR s\.id = v\.referenced_record_id/);
  });

  it("lesen: Deal fehlt → null; Vorname mit Anredeform → null", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [] });
    expect(await dbBewertungSpeicher.lesen(WS, DEAL)).toBeNull();
    mocks.execute.mockResolvedValueOnce({
      rows: [{ object_id: "o", person_text: "Frau Berger", service_type: "kitchen_installation" }],
    });
    expect(await dbBewertungSpeicher.lesen(WS, DEAL)).toMatchObject({ vorname: null, leistung: "kitchen_installation", versuche: 0 });
  });

  it("einwilligungDa: purpose review_request, nicht widerrufen, Workspace und Person", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ da: true }] });
    expect(await dbBewertungSpeicher.einwilligungDa(WS, "person_1")).toBe(true);
    const q = sqlText(mocks.execute.mock.calls[0]![0]);
    expect(q.sql).toContain("purpose = 'review_request'");
    expect(q.sql).toContain("revoked_at IS NULL");
    expect(q.params).toEqual(expect.arrayContaining([WS, "person_1"]));
  });

  it("tokenLoeschen: nur ungeklickter Token dieses Workspace und Deals", async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    await dbBewertungSpeicher.tokenLoeschen(WS, DEAL, "tok_1");
    const q = sqlText(mocks.execute.mock.calls[0]![0]);
    expect(q.sql).toMatch(/workspace_id = \$1 AND deal_record_id = \$2 AND token = \$3 AND clicked_at IS NULL/);
    expect(q.params).toEqual([WS, DEAL, "tok_1"]);
  });

  it("gespraeche nutzt die Abfrage der Akte", async () => {
    mocks.gespraecheLesen.mockResolvedValue([WABA]);
    expect(await dbBewertungSpeicher.gespraeche(WS, DEAL)).toEqual([WABA]);
    expect(mocks.gespraecheLesen).toHaveBeenCalledWith(WS, DEAL);
  });

  it("anrede: letzte eingehende Nachricht des Gesprächs, sonst gespeichertes Register", async () => {
    mocks.ladeGespeicherteAnrede.mockResolvedValue({ deal: "du", konversation: null });
    mocks.execute.mockResolvedValueOnce({ rows: [{ body: "Ok danke" }] });
    expect(await dbBewertungSpeicher.anrede(WS, DEAL, "conv_waba")).toBe("du");
    mocks.execute.mockResolvedValueOnce({ rows: [{ body: "Können Sie morgen kommen?" }] });
    expect(await dbBewertungSpeicher.anrede(WS, DEAL, "conv_waba")).toBe("sie");
    const q = sqlText(mocks.execute.mock.calls[0]![0]);
    expect(q.sql).toContain("direction = 'inbound'");
    expect(q.params).toEqual(expect.arrayContaining([WS, "conv_waba"]));
  });
});
