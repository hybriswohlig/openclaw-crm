import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  insert: vi.fn(),
  transaction: vi.fn(),
  txExecute: vi.fn(),
  txInsert: vi.fn(),
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
        if (p === "transaction") return mocks.transaction;
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
vi.mock("@/services/inbox-senden", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/inbox-senden")>();
  return {
    ...actual,
    sendeAntwort: mocks.sendeAntwort,
    nachEigenerNachricht: mocks.nachEigenerNachricht,
    istImFenster: mocks.istImFenster,
  };
});
vi.mock("@/services/records", () => ({ updateRecord: mocks.updateRecord }));
vi.mock("@/services/gespraech", () => ({ dbGespraechSpeicher: { gespraeche: mocks.gespraecheLesen } }));

import {
  BewertungFehler,
  BewertungKonfigFehler,
  BewertungVersandFehler,
  bewertungAnfragen,
  nichtsGesendet,
  bewertungsVorschau,
  dbBewertungSpeicher,
  type BewertungRoh,
  type BewertungSpeicher,
} from "./bewertung-anfragen";
import { BEWERTUNGSLINK_PLATZHALTER, STOP_ZEILE_SIE } from "@/lib/reviews/manuell";
import type { GespraechRoh } from "@/services/gespraech";
import {
  BaileysBridgeError,
  BaileysBridgeNotConfiguredError,
  WhatsAppSessionExpiredError,
} from "@/services/inbox-whatsapp";
import { GespraechNichtGefunden, OpenClawAusgehendFehler } from "@/services/inbox-senden";
import { activityEvents, consentLedger, reviewTokens } from "@/db/schema";

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

/**
 * In-Memory-Speicher. `gesperrt` ist ein Mutex wie pg_advisory_xact_lock und
 * rollt Token und Einwilligung bei einem Wurf zurück wie die Transaktion.
 */
function fake(start: {
  roh?: Partial<BewertungRoh>;
  gespraeche?: GespraechRoh[];
  einwilligung?: boolean;
  anrede?: "sie" | "du";
  optionen?: { statusGesendet: string | null; varianteManuell: string | null };
  tokenDa?: boolean;
  kontaktPerson?: string | null;
  personKontakt?: { telefone: string[]; emails: string[] };
  vornamen?: Record<string, string | null>;
  /** Was die Prüfung unter der Sperre sieht (sonst der Stand von `roh`). */
  anspruchStatus?: string | null;
} = {}) {
  const st = {
    tokens: [] as { token: string }[],
    einwilligungen: [] as unknown[],
    sperre: Promise.resolve(),
    inTransaktion: false,
  };
  const speicher: BewertungSpeicher = {
    lesen: vi.fn(async () => roh(start.roh)),
    gespraeche: vi.fn(async () => start.gespraeche ?? [WABA]),
    tokenDa: vi.fn(async () => (start.tokenDa ?? false) || st.tokens.length > 0),
    kontaktPerson: vi.fn(async () => start.kontaktPerson ?? null),
    // Standard: die erste Person hat die Nummer des Gesprächs (Rückfall ohne Person am Kontakt erlaubt).
    personKontakt: vi.fn(async () => start.personKontakt ?? { telefone: [WABA.telefon!], emails: [] }),
    personVorname: vi.fn(async (_ws: string, id: string) => start.vornamen?.[id] ?? null),
    einwilligungDa: vi.fn(async () => (start.einwilligung ?? true) || st.einwilligungen.length > 0),
    anrede: vi.fn(async () => start.anrede ?? "sie"),
    optionen: vi.fn(async () => start.optionen ?? { statusGesendet: "st_sent_wa", varianteManuell: null }),
    anspruch: vi.fn(async () => ({
      tokenDa: (start.tokenDa ?? false) || st.tokens.length > 0,
      statusTitel: start.anspruchStatus !== undefined ? start.anspruchStatus : roh(start.roh).statusTitel,
    })),
    tokenLoeschen: vi.fn(async (_ws: string, _deal: string, token: string) => {
      st.tokens = st.tokens.filter((t) => t.token !== token);
    }),
    tokenAnlegen: vi.fn(async (z) => void st.tokens.push(z)),
    einwilligungSpeichern: vi.fn(async (z) => {
      st.einwilligungen.push(z);
      return "consent_1";
    }),
    ereignis: vi.fn(async () => {}),
    gesperrt: vi.fn(async (_ws, _deal, fn) => {
      const vorher = st.sperre;
      let frei!: () => void;
      st.sperre = new Promise<void>((r) => (frei = r));
      await vorher;
      const stand = { tokens: [...st.tokens], einwilligungen: [...st.einwilligungen] };
      // In der Transaktion nur, was über tx läuft: jeder andere Zugriff wäre eine zweite Verbindung.
      const erlaubt = new Set(["anspruch", "einwilligungSpeichern", "tokenAnlegen"]);
      const tx = new Proxy(speicher, {
        get(t, k) {
          if (typeof k === "string" && !erlaubt.has(k)) throw new Error(`in der Transaktion nicht erlaubt: ${k}`);
          return Reflect.get(t, k);
        },
      });
      st.inTransaktion = true;
      try {
        return await fn(tx);
      } catch (err) {
        st.tokens = stand.tokens;
        st.einwilligungen = stand.einwilligungen;
        throw err;
      } finally {
        st.inTransaktion = false;
        frei();
      }
    }) as BewertungSpeicher["gesperrt"],
  };
  return Object.assign(speicher, { st });
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

  it.each(["complaint_routed", "suppressed"])("Status %s (Beschwerde, abgemeldet) → SPERRE, auch in der Vorschau", async (statusTitel) => {
    const s = fake({ roh: { statusTitel } });
    expect(await fehlerCode(bewertungAnfragen(WS, DEAL, ANFRAGE, s))).toBe("SPERRE");
    expect((await bewertungsVorschau(WS, DEAL, s)).sperre).toBe("SPERRE");
    expect(mocks.sendeAntwort).not.toHaveBeenCalled();
    expect(s.tokenAnlegen).not.toHaveBeenCalled();
  });

  it("Status failed darf erneut", async () => {
    await expect(bewertungAnfragen(WS, DEAL, ANFRAGE, fake({ roh: { statusTitel: "failed" } }))).resolves.toEqual({
      gesendet: true,
      gespraechId: "conv_waba",
    });
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

  it("Ablauf des Fensters beim Senden → FENSTER, Token gelöscht, Einwilligung bleibt", async () => {
    mocks.sendeAntwort.mockRejectedValue(new WhatsAppSessionExpiredError());
    const s = fake({ einwilligung: false });
    expect(await fehlerCode(bewertungAnfragen(WS, DEAL, { ...ANFRAGE, einwilligung: "Am Telefon am 03.11." }, s))).toBe("FENSTER");
    expect(s.tokenAnlegen).toHaveBeenCalledTimes(1);
    const token = vi.mocked(s.tokenAnlegen).mock.calls[0]![0].token;
    expect(s.tokenLoeschen).toHaveBeenCalledWith(WS, DEAL, token);
    expect(s.st.tokens).toEqual([]);
    expect(s.st.einwilligungen).toHaveLength(1);
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
    expect(vi.mocked(s.tokenAnlegen).mock.invocationCallOrder[0]!).toBeLessThan(mocks.sendeAntwort.mock.invocationCallOrder[0]!);

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
      dealRecordId: DEAL,
      personRecordId: "person_1",
      channel: "whatsapp",
      purpose: "review_request",
      exactWording: eintrag,
      sourceConversationId: "conv_waba",
      userId: "usr_1",
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

  it("unbekannter Sendefehler: Token und Einwilligung bleiben, Fehler „Senden unklar“", async () => {
    mocks.sendeAntwort.mockRejectedValue(new Error("insert into inbox_messages failed"));
    const s = fake({ einwilligung: false });
    const err = await bewertungAnfragen(WS, DEAL, { ...ANFRAGE, einwilligung: "Am Telefon am 03.11." }, s).catch((e) => e);
    expect(err).toBeInstanceOf(BewertungVersandFehler);
    expect(err.code).toBe("VERSAND_UNKLAR");
    expect(err.message).toBe("Senden unklar. Bitte im Gespräch prüfen, bevor erneut gesendet wird.");
    expect(s.tokenLoeschen).not.toHaveBeenCalled();
    expect(s.st.tokens).toHaveLength(1);
    expect(s.st.einwilligungen).toHaveLength(1);
    expect(mocks.nachEigenerNachricht).not.toHaveBeenCalled();
    expect(mocks.updateRecord).not.toHaveBeenCalled();
    expect(s.ereignis).not.toHaveBeenCalled();
    // der stehende Token sperrt ein erneutes Senden
    mocks.sendeAntwort.mockClear();
    expect(await fehlerCode(bewertungAnfragen(WS, DEAL, ANFRAGE, s))).toBe("SCHON_GESENDET");
    expect(mocks.sendeAntwort).not.toHaveBeenCalled();
  });

  it("Bridge lehnt ab: NICHT_GESENDET, Token gelöscht, Einwilligung bleibt, neuer Versuch möglich", async () => {
    mocks.sendeAntwort.mockRejectedValueOnce(new BaileysBridgeError(500, "account acc_1 is not connected (status=connecting)"));
    const s = fake({ einwilligung: false, gespraeche: [BAILEYS] });
    const err = await bewertungAnfragen(WS, DEAL, { ...ANFRAGE, einwilligung: "Am Telefon am 03.11." }, s).catch((e) => e);
    expect(err).toBeInstanceOf(BewertungVersandFehler);
    expect(err.code).toBe("NICHT_GESENDET");
    expect(s.st.tokens).toEqual([]);
    expect(s.st.einwilligungen).toHaveLength(1);
    await expect(bewertungAnfragen(WS, DEAL, ANFRAGE, s)).resolves.toEqual({ gesendet: true, gespraechId: "conv_baileys" });
  });

  it("Bridge 504 (nginx) nach möglichem Versand: VERSAND_UNKLAR, Token bleibt", async () => {
    mocks.sendeAntwort.mockRejectedValueOnce(new BaileysBridgeError(504, "bridge returned 504"));
    const s = fake({ gespraeche: [BAILEYS] });
    const err = await bewertungAnfragen(WS, DEAL, ANFRAGE, s).catch((e) => e);
    expect(err).toBeInstanceOf(BewertungVersandFehler);
    expect(err.code).toBe("VERSAND_UNKLAR");
    expect(s.tokenLoeschen).not.toHaveBeenCalled();
    expect(s.st.tokens).toHaveLength(1);
  });

  it("Token lässt sich nach einem Fehler vor dem Versand nicht löschen: Wortlaut wie unklar, kein „neuer Versuch möglich“", async () => {
    mocks.sendeAntwort.mockRejectedValueOnce(new BaileysBridgeError(401, "unauthorized"));
    const s = fake({ gespraeche: [BAILEYS] });
    vi.mocked(s.tokenLoeschen).mockRejectedValueOnce(new Error("DB weg"));
    const err = await bewertungAnfragen(WS, DEAL, ANFRAGE, s).catch((e) => e);
    expect(err).toBeInstanceOf(BewertungVersandFehler);
    expect(err.code).toBe("VERSAND_UNKLAR");
    expect(err.message).toBe("Nicht gesendet, aber die Sperre für diesen Deal bleibt bestehen. Bitte im Gespräch prüfen, bevor erneut gesendet wird.");
    expect(err.message).not.toContain("neuer Versuch");
  });

  it("Fenster abgelaufen, Token lässt sich nicht löschen: ebenfalls Wortlaut wie unklar", async () => {
    mocks.sendeAntwort.mockRejectedValueOnce(new WhatsAppSessionExpiredError());
    const s = fake();
    vi.mocked(s.tokenLoeschen).mockRejectedValueOnce(new Error("DB weg"));
    const err = await bewertungAnfragen(WS, DEAL, ANFRAGE, s).catch((e) => e);
    expect(err).toBeInstanceOf(BewertungVersandFehler);
    expect(err.code).toBe("VERSAND_UNKLAR");
  });

  it("nachEigenerNachricht wirft nach dem Senden: Status, Ereignis und Erfolg trotzdem", async () => {
    mocks.nachEigenerNachricht.mockRejectedValue(new Error("Pause nicht gesetzt"));
    const s = fake();
    await expect(bewertungAnfragen(WS, DEAL, ANFRAGE, s)).resolves.toEqual({ gesendet: true, gespraechId: "conv_waba" });
    expect(mocks.updateRecord).toHaveBeenCalledWith("obj_deals", DEAL, expect.objectContaining({ review_request_status: "st_sent_wa" }), "usr_1");
    expect(s.ereignis).toHaveBeenCalledTimes(1);
  });

  it("Felder scheitern nach dem Senden: Ereignis wird trotzdem geschrieben", async () => {
    mocks.updateRecord.mockRejectedValue(new Error("DB weg"));
    const s = fake();
    await expect(bewertungAnfragen(WS, DEAL, ANFRAGE, s)).resolves.toMatchObject({ gesendet: true });
    expect(s.ereignis).toHaveBeenCalledTimes(1);
  });

  it("gesendet wird erst nach dem Commit, geprüft wird vor der Transaktion", async () => {
    const s = fake();
    let beimSenden: boolean | null = null;
    mocks.sendeAntwort.mockImplementation(async () => {
      beimSenden = s.st.inTransaktion;
      return { message: { id: "msg_1", sentAt: WERKTAG }, dealRecordId: DEAL };
    });
    let beimPruefen: boolean | null = null;
    mocks.isAgentSuppressedStrict.mockImplementation(async () => {
      beimPruefen = s.st.inTransaktion;
      return false;
    });
    await bewertungAnfragen(WS, DEAL, ANFRAGE, s);
    expect(beimSenden).toBe(false);
    expect(beimPruefen).toBe(false);
    expect(s.gesperrt).toHaveBeenCalledTimes(1);
    expect(vi.mocked(s.tokenAnlegen).mock.invocationCallOrder[0]!).toBeLessThan(mocks.sendeAntwort.mock.invocationCallOrder[0]!);
  });

  it("Beschwerde zwischen Prüfung und Sperre → SPERRE, nichts angelegt", async () => {
    const s = fake({ einwilligung: false, anspruchStatus: "complaint_routed" });
    expect(await fehlerCode(bewertungAnfragen(WS, DEAL, { ...ANFRAGE, einwilligung: "Am Telefon" }, s))).toBe("SPERRE");
    expect(s.einwilligungSpeichern).not.toHaveBeenCalled();
    expect(s.tokenAnlegen).not.toHaveBeenCalled();
    expect(mocks.sendeAntwort).not.toHaveBeenCalled();
  });

  it("Status ändert sich zwischen Prüfung und Sperre → SCHON_GESENDET, nichts angelegt", async () => {
    const s = fake({ einwilligung: false, anspruchStatus: "sent_sms" });
    expect(await fehlerCode(bewertungAnfragen(WS, DEAL, { ...ANFRAGE, einwilligung: "Am Telefon" }, s))).toBe("SCHON_GESENDET");
    expect(s.einwilligungSpeichern).not.toHaveBeenCalled();
    expect(s.tokenAnlegen).not.toHaveBeenCalled();
    expect(mocks.sendeAntwort).not.toHaveBeenCalled();
  });
});

describe("nichtsGesendet", () => {
  it.each<[string, unknown]>([
    ["Fenster abgelaufen", new WhatsAppSessionExpiredError()],
    ["Gespräch fehlt", new GespraechNichtGefunden()],
    ["OpenClaw", new OpenClawAusgehendFehler()],
    ["Bridge nicht eingerichtet", new BaileysBridgeNotConfiguredError()],
    ["Bridge 400", new BaileysBridgeError(400, "invalid_body")],
    ["Bridge 401", new BaileysBridgeError(401, "unauthorized")],
    ["Bridge 413", new BaileysBridgeError(413, "Die Datei ist zu groß für die WhatsApp-Bridge (der JSON-Body überschreitet das Limit).")],
    ["Konto nicht verbunden", new BaileysBridgeError(500, "account acc_1 is not connected (status=missing)")],
    ["Graph-API mit Meta-Fehler", new Error("WhatsApp send failed: (#131047) Re-engagement message")],
    ["Graph-API 5xx mit Meta-Fehler", new Error("WhatsApp send failed: (#131000) Something went wrong")],
    ["Graph-API 4xx ohne Meta-Fehler", new Error("WhatsApp send failed: Meta API error 400")],
    ["Gespräch fehlt (Senden)", new Error("Conversation not found")],
    ["Konto fehlt", new Error("Channel account not found")],
    ["kein WhatsApp", new Error("Conversation is not a WhatsApp conversation")],
    ["WABA ohne Zugang", new Error("WhatsApp channel account is missing phone_number_id or access token")],
    ["kein Empfänger", new Error("Cannot determine recipient wa_id")],
    ["WABA statt Baileys", new Error("Channel account is WABA, not Baileys — call sendWhatsAppReply instead")],
    ["fremde Bridge", new Error("Channel account uses bridge 'openclaw', not 'inhouse' — outbound not supported here")],
    ["Gruppe", new Error("Conversation is keyed to a WhatsApp group/channel — CRM replies are not supported here")],
  ])("%s → nichts gesendet", (_n, err) => {
    expect(nichtsGesendet(err)).toBe(true);
  });

  it.each<[string, unknown]>([
    ["Netzfehler beim Abruf", new TypeError("fetch failed")],
    ["Bridge ok ohne ID", new BaileysBridgeError(500, "bridge returned no externalMessageId")],
    ["Bridge 502 (nginx)", new BaileysBridgeError(502, "bridge returned 502")],
    ["Bridge 503", new BaileysBridgeError(503, "bridge returned 503")],
    ["Bridge 504 (nginx)", new BaileysBridgeError(504, "bridge returned 504")],
    ["sendMessage ohne key.id", new BaileysBridgeError(500, "sendMessage returned no key.id")],
    ["anderer Bridge-500", new BaileysBridgeError(500, "Connection Closed")],
    ["Bridge 404", new BaileysBridgeError(404, "not_found")],
    ["Graph-API 5xx ohne Meta-Fehler", new Error("WhatsApp send failed: Meta API error 503")],
    ["Graph-API 500 ohne Meta-Fehler", new Error("WhatsApp send failed: Meta API error 500")],
    ["Speichern nach dem Abruf", new Error("duplicate key value violates unique constraint")],
    ["Fehlerunterklasse mit gleichem Text", Object.assign(new RangeError("Conversation not found"))],
    ["kein Error", "kaputt"],
  ])("%s → unklar", (_n, err) => {
    expect(nichtsGesendet(err)).toBe(false);
  });
});

describe("Doppelt senden", () => {
  it("zwei parallele Aufrufe: genau ein Versand, der zweite SCHON_GESENDET", async () => {
    mocks.sendeAntwort.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { message: { id: "msg_1", sentAt: WERKTAG }, dealRecordId: DEAL };
    });
    const s = fake();
    const ergebnisse = await Promise.allSettled([
      bewertungAnfragen(WS, DEAL, ANFRAGE, s),
      bewertungAnfragen(WS, DEAL, ANFRAGE, s),
    ]);
    expect(mocks.sendeAntwort).toHaveBeenCalledTimes(1);
    expect(ergebnisse.filter((e) => e.status === "fulfilled")).toHaveLength(1);
    const abgelehnt = ergebnisse.find((e) => e.status === "rejected") as PromiseRejectedResult;
    expect(abgelehnt.reason).toBeInstanceOf(BewertungFehler);
    expect(abgelehnt.reason.code).toBe("SCHON_GESENDET");
    expect(s.st.tokens).toHaveLength(1);
  });

  it("der Anspruch (Token) entsteht hinter der Sperre des Deals", async () => {
    const s = fake();
    await bewertungAnfragen(WS, DEAL, ANFRAGE, s);
    expect(s.gesperrt).toHaveBeenCalledWith(WS, DEAL, expect.any(Function));
  });

  it("vorhandener Token → SCHON_GESENDET, auch in der Vorschau", async () => {
    const s = fake({ tokenDa: true });
    expect(await fehlerCode(bewertungAnfragen(WS, DEAL, ANFRAGE, s))).toBe("SCHON_GESENDET");
    expect(mocks.sendeAntwort).not.toHaveBeenCalled();
    expect((await bewertungsVorschau(WS, DEAL, s)).sperre).toBe("SCHON_GESENDET");
  });
});

describe("Empfänger und Abmeldung", () => {
  it("Einwilligung gilt für die Person am Kontakt des Gesprächs", async () => {
    const s = fake({ einwilligung: false, kontaktPerson: "person_kontakt" });
    await bewertungAnfragen(WS, DEAL, { ...ANFRAGE, einwilligung: "Per WhatsApp am 03.11. zugestimmt" }, s);
    expect(s.kontaktPerson).toHaveBeenCalledWith(WS, "conv_waba");
    expect(s.einwilligungDa).toHaveBeenCalledWith(WS, "person_kontakt");
    expect(s.einwilligungSpeichern).toHaveBeenCalledWith(expect.objectContaining({ personRecordId: "person_kontakt" }));
  });

  it("zwei verknüpfte Personen, Kontakt des Gesprächs ist die zweite: Gruß mit ihrem Vornamen", async () => {
    const s = fake({
      einwilligung: false,
      roh: { personId: "person_1", vorname: "Anna" },
      kontaktPerson: "person_2",
      vornamen: { person_1: "Anna", person_2: "Bernd" },
    });
    await bewertungAnfragen(WS, DEAL, { ...ANFRAGE, einwilligung: "Per WhatsApp am 03.11. zugestimmt" }, s);
    const body: string = mocks.sendeAntwort.mock.calls[0]![0].body;
    expect(body.startsWith("Hallo Bernd,")).toBe(true);
    expect(body).not.toContain("Anna");
    expect(s.personVorname).toHaveBeenCalledWith(WS, "person_2");
    expect(s.einwilligungSpeichern).toHaveBeenCalledWith(expect.objectContaining({ personRecordId: "person_2" }));
    expect((await bewertungsVorschau(WS, DEAL, fake({ kontaktPerson: "person_2", vornamen: { person_2: "Bernd" } }))).text.startsWith("Hallo Bernd,")).toBe(true);
  });

  it("Kontaktperson ohne brauchbaren Vornamen: Gruß ohne Namen, nicht der Name einer anderen Person", async () => {
    const s = fake({ kontaktPerson: "person_2", vornamen: { person_2: null } });
    await bewertungAnfragen(WS, DEAL, ANFRAGE, s);
    expect(mocks.sendeAntwort.mock.calls[0]![0].body.startsWith("Guten Tag,")).toBe(true);
  });

  it("ohne Person am Kontakt: erste verknüpfte Person des Deals, wenn ihre Nummer die des Gesprächs ist", async () => {
    // Andere Schreibweise derselben Nummer (WABA-Gespräch: „+49 170 1234567“).
    const s = fake({ einwilligung: false, kontaktPerson: null, personKontakt: { telefone: ["0170 1234567"], emails: [] } });
    await bewertungAnfragen(WS, DEAL, { ...ANFRAGE, einwilligung: "Per WhatsApp am 03.11. zugestimmt" }, s);
    expect(s.personKontakt).toHaveBeenCalledWith(WS, ["person_1"]);
    expect(s.einwilligungDa).toHaveBeenCalledWith(WS, "person_1");
    expect(s.einwilligungSpeichern).toHaveBeenCalledWith(expect.objectContaining({ personRecordId: "person_1" }));
    expect(mocks.sendeAntwort.mock.calls[0]![0].body.startsWith("Hallo Anna,")).toBe(true);
  });

  it("ohne Person am Kontakt und andere Nummer der ersten Person → EMPFAENGER, nichts geschrieben", async () => {
    const s = fake({ einwilligung: true, kontaktPerson: null, personKontakt: { telefone: ["+49 171 9999999"], emails: [] } });
    const p = bewertungAnfragen(WS, DEAL, { ...ANFRAGE, einwilligung: "Per WhatsApp am 03.11. zugestimmt" }, s);
    expect(await fehlerCode(p)).toBe("EMPFAENGER");
    await expect(bewertungAnfragen(WS, DEAL, ANFRAGE, s)).rejects.toThrow(
      "Der WhatsApp-Kontakt ist keiner Person am Deal zugeordnet. Bitte den Kontakt im Posteingang mit der Person verknüpfen."
    );
    // Die Einwilligung der ersten Person gilt nicht für den Empfänger.
    expect(s.einwilligungDa).not.toHaveBeenCalled();
    expect(s.einwilligungSpeichern).not.toHaveBeenCalled();
    expect(s.tokenAnlegen).not.toHaveBeenCalled();
    expect(s.gesperrt).not.toHaveBeenCalled();
    expect(mocks.sendeAntwort).not.toHaveBeenCalled();
  });

  it("ohne Person am Kontakt und erste Person ohne Nummer → EMPFAENGER; Vorschau sperrt, Gruß ohne fremden Namen", async () => {
    const s = fake({ kontaktPerson: null, personKontakt: { telefone: [], emails: ["anna@example.de"] } });
    expect(await fehlerCode(bewertungAnfragen(WS, DEAL, ANFRAGE, s))).toBe("EMPFAENGER");
    const v = await bewertungsVorschau(WS, DEAL, s);
    expect(v.sperre).toBe("EMPFAENGER");
    expect(v.einwilligung).toBe(false);
    expect(v.text.startsWith("Guten Tag,")).toBe(true);
    expect(v.text).not.toContain("Anna");
  });

  it("STOP bleibt vor EMPFAENGER: Abmeldung der ersten Person sperrt mit SPERRE", async () => {
    mocks.isAgentSuppressedStrict.mockImplementation(async (_ws: string, k: { phone?: string }) => k.phone === "+49 171 9999999");
    const s = fake({ kontaktPerson: null, personKontakt: { telefone: ["+49 171 9999999"], emails: [] } });
    expect(await fehlerCode(bewertungAnfragen(WS, DEAL, ANFRAGE, s))).toBe("SPERRE");
  });

  it("Kontaktdaten beider Personen werden geprüft", async () => {
    const s = fake({ kontaktPerson: "person_kontakt" });
    await bewertungAnfragen(WS, DEAL, ANFRAGE, s);
    expect(s.personKontakt).toHaveBeenCalledWith(WS, ["person_kontakt", "person_1"]);
  });

  it.each([
    ["Telefon der Person", { phone: "+49 171 0000000" }],
    ["E-Mail der Person", { email: "anna@example.de" }],
  ])("Abmeldung über %s → SPERRE", async (_n, treffer) => {
    mocks.isAgentSuppressedStrict.mockImplementation(async (_ws: string, k: { phone?: string; email?: string }) =>
      "phone" in treffer ? k.phone === treffer.phone : k.email === treffer.email
    );
    const s = fake({ personKontakt: { telefone: ["+49 171 0000000"], emails: ["anna@example.de"] } });
    expect(await fehlerCode(bewertungAnfragen(WS, DEAL, ANFRAGE, s))).toBe("SPERRE");
    expect(mocks.isAgentSuppressedStrict).toHaveBeenCalledWith(WS, treffer);
    expect(mocks.sendeAntwort).not.toHaveBeenCalled();
  });
});

describe("Konfiguration", () => {
  it("ohne NEXT_PUBLIC_APP_URL kein Versand, klarer Fehler", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    const s = fake();
    const p = bewertungAnfragen(WS, DEAL, ANFRAGE, s);
    await expect(p).rejects.toBeInstanceOf(BewertungKonfigFehler);
    await expect(p).rejects.toThrow("NEXT_PUBLIC_APP_URL fehlt");
    expect(s.tokenAnlegen).not.toHaveBeenCalled();
    expect(mocks.sendeAntwort).not.toHaveBeenCalled();
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

  it("einwilligungDa: purpose review_request, Kanal WhatsApp, nicht widerrufen, Workspace und Person", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ da: true }] });
    expect(await dbBewertungSpeicher.einwilligungDa(WS, "person_1")).toBe(true);
    const q = sqlText(mocks.execute.mock.calls[0]![0]);
    expect(q.sql).toContain("purpose = 'review_request'");
    expect(q.sql).toContain("channel = 'whatsapp'");
    expect(q.sql).toContain("revoked_at IS NULL");
    expect(q.params).toEqual(expect.arrayContaining([WS, "person_1"]));
  });

  describe("einwilligungDa je Kanal", () => {
    type Zeile = { channel: string; purpose: string; revoked: boolean };
    /** Wertet die Bedingungen der Abfrage auf einem kleinen Ledger aus: jede fehlende Bedingung ließe die Zeile durch. */
    function ledger(zeilenImLedger: Zeile[]) {
      mocks.execute.mockImplementation(async (abfrage: SQL) => {
        const q = sqlText(abfrage).sql;
        const passt = (z: Zeile) =>
          (!q.includes("channel = 'whatsapp'") || z.channel === "whatsapp") &&
          (!q.includes("purpose = 'review_request'") || z.purpose === "review_request") &&
          (!q.includes("revoked_at IS NULL") || !z.revoked);
        return { rows: [{ da: zeilenImLedger.some(passt) }] };
      });
    }

    it.each(["email", "sms"])("nur eine %s-Einwilligung → keine Einwilligung für WhatsApp", async (channel) => {
      ledger([{ channel, purpose: "review_request", revoked: false }]);
      expect(await dbBewertungSpeicher.einwilligungDa(WS, "person_1")).toBe(false);
    });

    it("WhatsApp-Einwilligung → Einwilligung", async () => {
      ledger([
        { channel: "email", purpose: "review_request", revoked: false },
        { channel: "whatsapp", purpose: "review_request", revoked: false },
      ]);
      expect(await dbBewertungSpeicher.einwilligungDa(WS, "person_1")).toBe(true);
    });

    it("widerrufene WhatsApp-Einwilligung oder anderer Zweck → keine Einwilligung", async () => {
      ledger([
        { channel: "whatsapp", purpose: "review_request", revoked: true },
        { channel: "whatsapp", purpose: "proactive_followup", revoked: false },
      ]);
      expect(await dbBewertungSpeicher.einwilligungDa(WS, "person_1")).toBe(false);
    });
  });

  it("anspruch: Token und Status in einer Abfrage, Workspace und Deal gefiltert", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ token_da: false, status_titel: "sent_whatsapp" }] });
    expect(await dbBewertungSpeicher.anspruch(WS, DEAL)).toEqual({ tokenDa: false, statusTitel: "sent_whatsapp" });
    const q = sqlText(mocks.execute.mock.calls[0]![0]);
    expect(q.sql).toContain("FROM review_tokens WHERE workspace_id = $1 AND deal_record_id = $2");
    expect(q.sql).toMatch(/s\.id = v\.text_value OR s\.id = v\.referenced_record_id/);
    expect(q.sql).toContain("o.workspace_id");
    expect(q.params).toEqual(expect.arrayContaining([WS, DEAL]));
  });

  it("tokenLoeschen: nur ungeklickter Token dieses Workspace und Deals", async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    await dbBewertungSpeicher.tokenLoeschen(WS, DEAL, "tok_1");
    const q = sqlText(mocks.execute.mock.calls[0]![0]);
    expect(q.sql).toMatch(/workspace_id = \$1 AND deal_record_id = \$2 AND token = \$3 AND clicked_at IS NULL/);
    expect(q.params).toEqual([WS, DEAL, "tok_1"]);
  });

  it("tokenDa: Token dieses Workspace und Deals", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ da: true }] });
    expect(await dbBewertungSpeicher.tokenDa(WS, DEAL)).toBe(true);
    const q = sqlText(mocks.execute.mock.calls[0]![0]);
    expect(q.sql).toMatch(/FROM review_tokens WHERE workspace_id = \$1 AND deal_record_id = \$2/);
    expect(q.params).toEqual([WS, DEAL]);
  });

  it("kontaktPerson: Person am Kontakt des Gesprächs, nur Personen dieses Workspace", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ id: "person_kontakt" }] });
    expect(await dbBewertungSpeicher.kontaktPerson(WS, "conv_waba")).toBe("person_kontakt");
    const q = sqlText(mocks.execute.mock.calls[0]![0]);
    expect(q.sql).toContain("k.crm_record_id");
    expect(q.sql).toContain("po.slug = 'people'");
    expect(q.sql).toContain("c.workspace_id");
    expect(q.params).toEqual(expect.arrayContaining([WS, "conv_waba"]));
  });

  it("personKontakt: Nummern und Adressen, leere Liste ohne Abfrage", async () => {
    expect(await dbBewertungSpeicher.personKontakt(WS, [])).toEqual({ telefone: [], emails: [] });
    expect(mocks.execute).not.toHaveBeenCalled();
    mocks.execute.mockResolvedValue({
      rows: [
        { slug: "phone_numbers", wert: "+49 171 0000000" },
        { slug: "email_addresses", wert: " anna@example.de " },
        { slug: "email_addresses", wert: "" },
      ],
    });
    expect(await dbBewertungSpeicher.personKontakt(WS, ["p1", "p2"])).toEqual({
      telefone: ["+49 171 0000000"],
      emails: ["anna@example.de"],
    });
    const q = sqlText(mocks.execute.mock.calls[0]![0]);
    expect(q.params).toEqual(expect.arrayContaining([WS, "p1", "p2"]));
    expect(q.sql).toContain("po.workspace_id");
  });

  it("gesperrt: Transaktion, erste Anweisung ist pg_advisory_xact_lock je Workspace und Deal; Schreiben über tx", async () => {
    const werte: { table: unknown; values: unknown }[] = [];
    mocks.txExecute.mockResolvedValue({ rows: [] });
    mocks.txInsert.mockImplementation((table: unknown) => ({
      values: (values: unknown) => {
        werte.push({ table, values });
        const p = Promise.resolve() as Promise<void> & { returning?: () => Promise<{ id: string }[]> };
        p.returning = async () => [{ id: "consent_x" }];
        return p;
      },
    }));
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ execute: mocks.txExecute, insert: mocks.txInsert })
    );
    const id = await dbBewertungSpeicher.gesperrt(WS, DEAL, async (tx) => {
      await tx.tokenAnlegen({ token: "tok_1", workspaceId: WS, dealRecordId: DEAL, destinationUrl: GOOGLE });
      return tx.einwilligungSpeichern({
        workspaceId: WS,
        dealRecordId: DEAL,
        personRecordId: "person_1",
        channel: "whatsapp",
        purpose: "review_request",
        exactWording: "Am Telefon",
        sourceConversationId: "conv_waba",
        userId: "usr_1",
      });
    });
    expect(id).toBe("consent_x");
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    const lock = sqlText(mocks.txExecute.mock.calls[0]![0]);
    expect(lock.sql).toBe("select pg_advisory_xact_lock(hashtext('bewertung:' || $1 || ':' || $2))");
    expect(lock.params).toEqual([WS, DEAL]);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(werte.map((w) => w.table)).toEqual([reviewTokens, consentLedger, activityEvents]);
    expect(werte[1]!.values).toEqual({
      workspaceId: WS,
      personRecordId: "person_1",
      channel: "whatsapp",
      purpose: "review_request",
      exactWording: "Am Telefon",
      sourceConversationId: "conv_waba",
    });
    expect(werte[2]!.values).toEqual({
      workspaceId: WS,
      recordId: DEAL,
      objectSlug: "deals",
      eventType: "consent.eingetragen",
      payload: { consentId: "consent_x", purpose: "review_request", channel: "whatsapp", personRecordId: "person_1" },
      actorId: "usr_1",
    });
  });

  it("gesperrt: Wurf in der Transaktion wird weitergereicht (Drizzle rollt zurück)", async () => {
    mocks.txExecute.mockResolvedValue({ rows: [] });
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ execute: mocks.txExecute, insert: mocks.txInsert })
    );
    await expect(
      dbBewertungSpeicher.gesperrt(WS, DEAL, async () => {
        throw new Error("Senden fehlgeschlagen");
      })
    ).rejects.toThrow("Senden fehlgeschlagen");
  });

  it("personVorname: Name der Person dieses Workspace, Anredeform ergibt null", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ text: null, json: { first_name: "Bernd", last_name: "Kurz" } }] });
    expect(await dbBewertungSpeicher.personVorname(WS, "person_2")).toBe("Bernd");
    const q = sqlText(mocks.execute.mock.calls[0]![0]);
    expect(q.sql).toContain("po.workspace_id");
    expect(q.params).toEqual(expect.arrayContaining([WS, "person_2"]));
    mocks.execute.mockResolvedValueOnce({ rows: [{ text: "Herr Kurz", json: null }] });
    expect(await dbBewertungSpeicher.personVorname(WS, "person_2")).toBeNull();
    mocks.execute.mockResolvedValueOnce({ rows: [] });
    expect(await dbBewertungSpeicher.personVorname(WS, "person_x")).toBeNull();
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
