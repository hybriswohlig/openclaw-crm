import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

type Ereignis = {
  id: string;
  workspaceId: string;
  recordId: string;
  eventType: string;
  payload: unknown;
  actorId?: string | null;
  createdAt: Date;
};

const mocks = vi.hoisted(() => ({
  store: [] as Ereignis[],
  reihenfolge: [] as string[],
  sperren: new Map<string, Promise<void>>(),
  sperrSchluessel: [] as string[],
  createPayment: vi.fn(),
  resolveDealOperatingCompany: vi.fn(),
  aktualisiereWartet: vi.fn(),
  nachZahlung: vi.fn(),
  maybeNotifyDepositReceived: vi.fn(),
}));

const dialekt = new PgDialect();

/** Filtert den Speicher wie die WHERE-Bedingung: Workspace, Deal, Typ und (falls abgefragt) ID müssen als Parameter vorkommen. */
function filtere(bedingung: SQL): Ereignis[] {
  const q = dialekt.sqlToQuery(bedingung);
  const p = q.params as unknown[];
  const mitId = q.sql.includes('"activity_events"."id" =');
  return mocks.store.filter(
    (e) => p.includes(e.workspaceId) && p.includes(e.recordId) && p.includes(e.eventType) && (!mitId || p.includes(e.id)),
  );
}

function abfrage() {
  return {
    from: () => ({
      where: (bedingung: SQL) => ({
        limit: async (n: number) => filtere(bedingung).slice(0, n),
        then: (ok: (v: Ereignis[]) => unknown, fehl: (e: unknown) => unknown) => Promise.resolve(filtere(bedingung)).then(ok, fehl),
      }),
    }),
  };
}

vi.mock("@/db", () => ({
  db: {
    select: () => abfrage(),
    transaction: async (f: (tx: unknown) => Promise<unknown>) => {
      mocks.reihenfolge.push("begin");
      const offen: Ereignis[] = [];
      const freigaben: (() => void)[] = [];
      const tx = {
        select: () => abfrage(),
        execute: async (q: SQL) => {
          const { sql, params } = dialekt.sqlToQuery(q);
          if (!sql.includes("pg_advisory_xact_lock")) throw new Error(`unerwartet: ${sql}`);
          const schluessel = (params as string[]).join("|");
          mocks.sperrSchluessel.push(sql + " " + schluessel);
          // Echte Sperre: warten, bis die vorige Transaktion mit demselben Schlüssel endet.
          while (mocks.sperren.has(schluessel)) await mocks.sperren.get(schluessel);
          let frei!: () => void;
          mocks.sperren.set(schluessel, new Promise<void>((r) => (frei = r)));
          freigaben.push(() => {
            mocks.sperren.delete(schluessel);
            frei();
          });
          return [];
        },
        insert: () => ({
          values: async (v: Omit<Ereignis, "id" | "createdAt">) => {
            offen.push({ ...v, id: `evt_${Math.random().toString(36).slice(2)}`, createdAt: new Date() });
          },
        }),
      };
      try {
        const r = await f(tx);
        mocks.store.push(...offen);
        mocks.reihenfolge.push("commit");
        return r;
      } finally {
        freigaben.forEach((f) => f());
      }
    },
  },
}));
vi.mock("./financial", () => ({
  createPayment: mocks.createPayment,
  resolveDealOperatingCompany: mocks.resolveDealOperatingCompany,
}));
vi.mock("./wartet", () => ({ aktualisiereWartet: mocks.aktualisiereWartet }));
vi.mock("./nach-zahlung", () => ({ nachZahlung: mocks.nachZahlung }));
vi.mock("./customer-portal-notifications", () => ({ maybeNotifyDepositReceived: mocks.maybeNotifyDepositReceived }));

import {
  bestaetigeZahlungsmeldung,
  ladeZahlungsmeldungen,
  verwerfeZahlungsmeldung,
  ZahlungsmeldungFehler,
} from "./zahlungsmeldungen";
import { berlinDateString } from "@/lib/berlin-date";

const meldung = (id: string, variant: "deposit" | "final", amountCents: number, extra: Partial<Ereignis> = {}): Ereignis => ({
  id,
  workspaceId: "ws_1",
  recordId: "deal_1",
  eventType: "customer.marked_paid",
  payload: { method: "paypal", amountCents, variant, ipAddress: "1.2.3.4", userAgent: "x" },
  createdAt: new Date("2026-11-05T09:00:00Z"),
  ...extra,
});

const fehlerCode = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    if (err instanceof ZahlungsmeldungFehler) return err.code;
    throw err;
  }
  return "kein Fehler";
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.store.length = 0;
  mocks.reihenfolge.length = 0;
  mocks.sperrSchluessel.length = 0;
  mocks.sperren.clear();
  let n = 0;
  mocks.createPayment.mockImplementation(async () => {
    mocks.reihenfolge.push("zahlung");
    // Lässt der zweiten Bestätigung Zeit, sich ohne Sperre dazwischenzuschieben.
    await new Promise((r) => setTimeout(r, 10));
    return { id: `pay_${++n}` };
  });
  mocks.resolveDealOperatingCompany.mockImplementation(async () => {
    mocks.reihenfolge.push("firma");
    return "oc_1";
  });
  mocks.aktualisiereWartet.mockImplementation(async () => void mocks.reihenfolge.push("wartet"));
  mocks.maybeNotifyDepositReceived.mockImplementation(async () => void mocks.reihenfolge.push("benachrichtigung"));
  mocks.nachZahlung.mockImplementation(async () => {
    mocks.reihenfolge.push("nachZahlung");
    return { stufeGesetzt: false };
  });
});

describe("ladeZahlungsmeldungen", () => {
  it("liest nur Ereignisse dieses Deals im Workspace und liefert die offenen", async () => {
    mocks.store.push(
      meldung("e1", "final", 52000),
      meldung("e2", "deposit", 10000, { recordId: "deal_2" }),
      meldung("e3", "deposit", 10000, { workspaceId: "ws_2" }),
    );
    expect(await ladeZahlungsmeldungen("ws_1", "deal_1")).toEqual([
      { eventId: "e1", gemeldetAm: "2026-11-05T09:00:00.000Z", betragCent: 52000, zahlungsart: "paypal", variante: "final" },
    ]);
  });
});

describe("bestaetigeZahlungsmeldung", () => {
  it("schreibt Zahlung und Folgeereignis in einer Transaktion, danach Wartet, Benachrichtigung, nachZahlung", async () => {
    mocks.store.push(meldung("e1", "final", 52050));
    const r = await bestaetigeZahlungsmeldung("ws_1", "deal_1", "e1", "usr_1");
    expect(r).toEqual({ paymentId: "pay_1" });

    expect(mocks.createPayment).toHaveBeenCalledTimes(1);
    const [ws, deal, eingabe, tx] = mocks.createPayment.mock.calls[0];
    expect([ws, deal]).toEqual(["ws_1", "deal_1"]);
    expect(eingabe).toEqual({
      date: berlinDateString(),
      amount: "520.50",
      paymentMethod: "paypal",
      notes: "Kunde meldete „bezahlt“ im Link",
      taxTreatment: "betriebseinnahme",
      operatingCompanyId: "oc_1",
    });
    expect(tx).toBeDefined();
    expect(mocks.resolveDealOperatingCompany).toHaveBeenCalledWith("ws_1", "deal_1");

    const folge = mocks.store.find((e) => e.eventType === "payment.meldung_bestaetigt");
    expect(folge).toMatchObject({
      workspaceId: "ws_1",
      recordId: "deal_1",
      objectSlug: "deals",
      actorId: "usr_1",
      payload: { eventId: "e1", paymentId: "pay_1", variante: "final" },
    });

    expect(mocks.sperrSchluessel).toEqual([
      "select pg_advisory_xact_lock(hashtext('zahlungsmeldung:' || $1::text || ':' || $2::text)) deal_1|final",
    ]);
    expect(mocks.maybeNotifyDepositReceived).toHaveBeenCalledWith({ workspaceId: "ws_1", dealRecordId: "deal_1" });
    expect(mocks.aktualisiereWartet).toHaveBeenCalledWith("ws_1", "deal_1");
    expect(mocks.nachZahlung).toHaveBeenCalledWith("ws_1", "deal_1", "usr_1");
    // Firma vor der Transaktion: unter der Sperre keine zweite Verbindung aus dem Pool.
    expect(mocks.reihenfolge).toEqual(["firma", "begin", "zahlung", "commit", "wartet", "benachrichtigung", "nachZahlung"]);
    expect(await ladeZahlungsmeldungen("ws_1", "deal_1")).toEqual([]);
  });

  it("ohne bekannte Zahlungsart → paymentMethod undefined", async () => {
    mocks.store.push({ ...meldung("e1", "deposit", 20000), payload: { method: "krypto", amountCents: 20000, variant: "deposit" } });
    await bestaetigeZahlungsmeldung("ws_1", "deal_1", "e1", "usr_1");
    expect(mocks.createPayment.mock.calls[0][2].paymentMethod).toBeUndefined();
  });

  it("zwei gleichzeitige Bestätigungen → createPayment einmal, die zweite ERLEDIGT", async () => {
    mocks.store.push(meldung("e1", "final", 52000));
    const [a, b] = await Promise.allSettled([
      bestaetigeZahlungsmeldung("ws_1", "deal_1", "e1", "usr_1"),
      bestaetigeZahlungsmeldung("ws_1", "deal_1", "e1", "usr_2"),
    ]);
    expect(a).toEqual({ status: "fulfilled", value: { paymentId: "pay_1" } });
    expect(b.status).toBe("rejected");
    expect((b as PromiseRejectedResult).reason).toBeInstanceOf(ZahlungsmeldungFehler);
    expect((b as PromiseRejectedResult).reason.code).toBe("ERLEDIGT");
    expect(mocks.createPayment).toHaveBeenCalledTimes(1);
    expect(mocks.store.filter((e) => e.eventType === "payment.meldung_bestaetigt")).toHaveLength(1);
    expect(mocks.maybeNotifyDepositReceived).toHaveBeenCalledTimes(1);
  });

  it("Bestätigen und Verwerfen gleichzeitig → nur eines gewinnt", async () => {
    mocks.store.push(meldung("e1", "final", 52000));
    const [a, b] = await Promise.allSettled([
      bestaetigeZahlungsmeldung("ws_1", "deal_1", "e1", "usr_1"),
      verwerfeZahlungsmeldung("ws_1", "deal_1", "e1", "usr_2"),
    ]);
    // Wer die Sperre zuerst bekommt, gewinnt; der andere bekommt ERLEDIGT.
    const ergebnisse = [a, b];
    expect(ergebnisse.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const verlierer = ergebnisse.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(verlierer.reason.code).toBe("ERLEDIGT");
    const folgen = mocks.store.filter((e) => e.eventType.startsWith("payment.meldung_"));
    expect(folgen).toHaveLength(1);
    expect(mocks.createPayment).toHaveBeenCalledTimes(folgen[0].eventType === "payment.meldung_bestaetigt" ? 1 : 0);
  });

  it("fremde eventId (anderer Deal, anderer Workspace, kein marked_paid, unbekannt) → NICHT_GEFUNDEN, nichts geschrieben", async () => {
    mocks.store.push(
      meldung("e_deal2", "final", 100, { recordId: "deal_2" }),
      meldung("e_ws2", "final", 100, { workspaceId: "ws_2" }),
      { ...meldung("e_typ", "final", 100), eventType: "customer.question" },
    );
    for (const id of ["e_deal2", "e_ws2", "e_typ", "gibt_es_nicht"]) {
      expect(await fehlerCode(bestaetigeZahlungsmeldung("ws_1", "deal_1", id, "usr_1"))).toBe("NICHT_GEFUNDEN");
    }
    expect(mocks.createPayment).not.toHaveBeenCalled();
    expect(mocks.maybeNotifyDepositReceived).not.toHaveBeenCalled();
  });

  it("Meldung ohne gültigen Betrag → NICHT_GEFUNDEN", async () => {
    mocks.store.push({ ...meldung("e1", "final", 1), payload: { variant: "final", amountCents: "abc" } });
    expect(await fehlerCode(bestaetigeZahlungsmeldung("ws_1", "deal_1", "e1", "usr_1"))).toBe("NICHT_GEFUNDEN");
  });

  it("ältere, durch eine neuere Meldung ersetzte Meldung → ERLEDIGT", async () => {
    mocks.store.push(
      meldung("e1", "final", 52000),
      meldung("e2", "final", 52000, { createdAt: new Date("2026-11-05T09:10:00Z") }),
    );
    expect(await fehlerCode(bestaetigeZahlungsmeldung("ws_1", "deal_1", "e1", "usr_1"))).toBe("ERLEDIGT");
    expect(mocks.createPayment).not.toHaveBeenCalled();
  });

  it("Fehler in nachZahlung bricht die Bestätigung nicht", async () => {
    mocks.store.push(meldung("e1", "final", 52000));
    mocks.nachZahlung.mockRejectedValueOnce(new Error("kaputt"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(bestaetigeZahlungsmeldung("ws_1", "deal_1", "e1", "usr_1")).resolves.toEqual({ paymentId: "pay_1" });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("Fehler in aktualisiereWartet nach dem Commit wird geloggt, Bestätigung gilt, Rest läuft weiter", async () => {
    mocks.store.push(meldung("e1", "final", 52000));
    mocks.aktualisiereWartet.mockRejectedValueOnce(new Error("wartet kaputt"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(bestaetigeZahlungsmeldung("ws_1", "deal_1", "e1", "usr_1")).resolves.toEqual({ paymentId: "pay_1" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[wartet]"), expect.any(Error));
    expect(mocks.store.filter((e) => e.eventType === "payment.meldung_bestaetigt")).toHaveLength(1);
    expect(mocks.maybeNotifyDepositReceived).toHaveBeenCalledTimes(1);
    expect(mocks.nachZahlung).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it("Fehler in createPayment → nichts committet, keine Nacharbeit", async () => {
    mocks.store.push(meldung("e1", "final", 52000));
    mocks.createPayment.mockRejectedValueOnce(new Error("db weg"));
    await expect(bestaetigeZahlungsmeldung("ws_1", "deal_1", "e1", "usr_1")).rejects.toThrow("db weg");
    expect(mocks.store.filter((e) => e.eventType === "payment.meldung_bestaetigt")).toHaveLength(0);
    expect(mocks.maybeNotifyDepositReceived).not.toHaveBeenCalled();
    expect(mocks.nachZahlung).not.toHaveBeenCalled();
  });
});

describe("verwerfeZahlungsmeldung", () => {
  it("schreibt payment.meldung_verworfen, keine Zahlung, keine Benachrichtigung", async () => {
    mocks.store.push(meldung("e1", "deposit", 20000));
    await verwerfeZahlungsmeldung("ws_1", "deal_1", "e1", "usr_1");
    expect(mocks.createPayment).not.toHaveBeenCalled();
    expect(mocks.maybeNotifyDepositReceived).not.toHaveBeenCalled();
    expect(mocks.nachZahlung).not.toHaveBeenCalled();
    expect(mocks.store.find((e) => e.eventType === "payment.meldung_verworfen")).toMatchObject({
      workspaceId: "ws_1",
      recordId: "deal_1",
      objectSlug: "deals",
      actorId: "usr_1",
      payload: { eventId: "e1", variante: "deposit" },
    });
    expect(mocks.sperrSchluessel[0]).toContain("deal_1|deposit");
    expect(await ladeZahlungsmeldungen("ws_1", "deal_1")).toEqual([]);
  });

  it("schon verworfen → ERLEDIGT; fremd → NICHT_GEFUNDEN", async () => {
    mocks.store.push(meldung("e1", "deposit", 20000), meldung("e9", "deposit", 1, { recordId: "deal_9" }));
    await verwerfeZahlungsmeldung("ws_1", "deal_1", "e1", "usr_1");
    expect(await fehlerCode(verwerfeZahlungsmeldung("ws_1", "deal_1", "e1", "usr_1"))).toBe("ERLEDIGT");
    expect(await fehlerCode(verwerfeZahlungsmeldung("ws_1", "deal_1", "e9", "usr_1"))).toBe("NICHT_GEFUNDEN");
  });
});
