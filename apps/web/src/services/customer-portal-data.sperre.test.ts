import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";

/**
 * Plan 5a, Entscheidung 5: jeder Schreiber am Angebot nimmt zuerst die Sperre
 * des Angebots (`angebotSperren`) und prüft die Annahme darunter erneut.
 * Mitschnitt aller Abfragen einer Fake-DB; die Sperre wird als SQL geprüft.
 */
const m = vi.hoisted(() => ({
  log: [] as string[],
  /** Zeilen je Tabelle; `tx:<tabelle>` gilt nur innerhalb der Transaktion. */
  rows: {} as Record<string, unknown[]>,
  emitEvent: vi.fn(),
}));

vi.mock("@/db", async () => {
  const { getTableName: name } = await import("drizzle-orm");
  const { PgDialect: Dialekt } = await import("drizzle-orm/pg-core");
  const dialekt = new Dialekt();
  const tab = (t: unknown) => name(t as Parameters<typeof name>[0]);
  function kette(wer: string, art: string, tabelle?: string) {
    let t = tabelle;
    const ergebnis = () => {
      if (art === "select") {
        m.log.push(`${wer} select ${t}`);
        return m.rows[`${wer}:${t}`] ?? m.rows[t!] ?? [];
      }
      m.log.push(`${wer} ${art} ${t}`);
      return art === "insert" ? [{ id: "neu" }] : [];
    };
    const p: unknown = new Proxy(() => {}, {
      get(_z, prop) {
        if (prop === "then") return (res: (v: unknown) => void, rej: (e: unknown) => void) => Promise.resolve().then(ergebnis).then(res, rej);
        return (...args: unknown[]) => {
          if (prop === "from") t = tab(args[0]);
          return p;
        };
      },
    });
    return p;
  }
  function executor(wer: string) {
    return {
      select: () => kette(wer, "select"),
      insert: (t: unknown) => kette(wer, "insert", tab(t)),
      update: (t: unknown) => kette(wer, "update", tab(t)),
      delete: (t: unknown) => kette(wer, "delete", tab(t)),
      execute: async (q: SQL) => {
        const { sql, params } = dialekt.sqlToQuery(q);
        m.log.push(`${wer} execute ${sql} [${params.join(",")}]`);
        return [];
      },
    };
  }
  return {
    db: {
      ...executor("db"),
      transaction: async (f: (tx: unknown) => Promise<unknown>) => {
        m.log.push("BEGIN");
        try {
          const r = await f(executor("tx"));
          m.log.push("COMMIT");
          return r;
        } catch (e) {
          m.log.push("ROLLBACK");
          throw e;
        }
      },
    },
  };
});
vi.mock("./activity-events", () => ({ emitEvent: m.emitEvent }));

import {
  ensureDefaultPackageSelection,
  replaceDateOffers,
  replaceDealPackageOptions,
  selectDateOffer,
  selectDealPackageOptionForToken,
  selectPackageForToken,
} from "./customer-portal-data";
import { AngebotAngenommenError } from "./kva-annahme";
import { angebotSperren } from "./quotations";

const DEAL = "deal-1";
const TOKEN = "A".repeat(32);
const SPERRE = `tx execute select pg_advisory_xact_lock(hashtext('angebot:' || $1::text)) [${DEAL}]`;
const ctx = { ipAddress: "203.0.113.5", userAgent: "test" };

const link = { id: "l1", workspaceId: "ws", dealRecordId: DEAL, token: TOKEN, revokedAt: null, expiresAt: null };
const option = { id: "o1", dealRecordId: DEAL, catalogueSlug: "komfort", displayName: "Komfort", priceCents: 120000, isRecommended: true, sortOrder: 0 };

/** Ab BEGIN: zuerst die Sperre, dann die Annahme, Schreiben erst danach und vor COMMIT. */
function pruefeReihenfolge(schreibt: RegExp) {
  const begin = m.log.indexOf("BEGIN");
  expect(begin).toBeGreaterThanOrEqual(0);
  expect(m.log[begin + 1]).toBe(SPERRE);
  expect(m.log[begin + 2]).toBe("tx select kva_confirmations");
  const commit = m.log.indexOf("COMMIT");
  const schreiben = m.log.map((z, i) => [z, i] as const).filter(([z]) => /^(db|tx) (insert|update|delete) /.test(z));
  expect(schreiben.length).toBeGreaterThan(0);
  for (const [z, i] of schreiben) {
    expect(z.startsWith("tx ")).toBe(true);
    expect(i).toBeGreaterThan(begin + 2);
    expect(i).toBeLessThan(commit);
  }
  expect(schreiben.some(([z]) => schreibt.test(z))).toBe(true);
}

/** Annahme erscheint erst unter der Sperre: nichts wird geschrieben. */
function annahmeUnterSperre() {
  m.rows["tx:kva_confirmations"] = [{ id: "annahme" }];
}
const nichtsGeschrieben = () => expect(m.log.filter((z) => / (insert|update|delete) /.test(z))).toEqual([]);

beforeEach(() => {
  m.log.length = 0;
  for (const k of Object.keys(m.rows)) delete m.rows[k];
  m.emitEvent.mockReset();
  m.rows.customer_status_links = [link];
  m.rows.kva_confirmations = [];
});

describe("Sperre des Angebots in allen Schreibern", () => {
  it("die Sperre ist dieselbe wie beim Sperren einer Version", async () => {
    m.log.length = 0;
    const { db } = await import("@/db");
    await db.transaction((tx) => angebotSperren(tx, DEAL));
    expect(m.log[1]).toBe(SPERRE);
  });

  it("ensureDefaultPackageSelection: vorab ohne Sperre, geschrieben nur unter ihr", async () => {
    m.rows.quotation_package_options = [option];
    m.rows.quotations = [{ id: "q1", selectedPackageOptionId: null, isVariable: false, fixedPrice: null }];
    await ensureDefaultPackageSelection(DEAL);
    pruefeReihenfolge(/^tx update quotations$/);
  });

  it("ensureDefaultPackageSelection: nichts zu tun, keine Transaktion", async () => {
    await ensureDefaultPackageSelection(DEAL);
    expect(m.log).not.toContain("BEGIN");
  });

  it("ensureDefaultPackageSelection: Annahme unter der Sperre, nichts geschrieben", async () => {
    m.rows.quotation_package_options = [option];
    m.rows.quotations = [{ id: "q1", selectedPackageOptionId: null, isVariable: false, fixedPrice: null }];
    annahmeUnterSperre();
    await ensureDefaultPackageSelection(DEAL);
    expect(m.log).toContain(SPERRE);
    nichtsGeschrieben();
  });

  it("replaceDealPackageOptions", async () => {
    m.rows.quotations = [{ id: "q1", selectedPackageSlug: null }];
    m.rows.quotation_package_options = [option];
    const r = await replaceDealPackageOptions({
      workspaceId: "ws",
      dealRecordId: DEAL,
      createdBy: null,
      options: [{ catalogueSlug: "komfort", displayName: "Komfort", shortDescription: null, priceCents: 120000, includedItems: [], note: null, isRecommended: true }],
    });
    expect(r).toEqual({ count: 1 });
    pruefeReihenfolge(/^tx delete quotation_package_options$/);
    // Ereignis erst nach dem Commit.
    expect(m.emitEvent).toHaveBeenCalledOnce();
  });

  it("replaceDealPackageOptions: Annahme unter der Sperre → KVA_ACCEPTED, Rollback", async () => {
    annahmeUnterSperre();
    await expect(
      replaceDealPackageOptions({ workspaceId: "ws", dealRecordId: DEAL, createdBy: null, options: [] })
    ).rejects.toBeInstanceOf(AngebotAngenommenError);
    expect(m.log).toContain("ROLLBACK");
    nichtsGeschrieben();
    expect(m.emitEvent).not.toHaveBeenCalled();
  });

  it("selectDealPackageOptionForToken", async () => {
    m.rows.quotation_package_options = [option];
    m.rows.quotations = [{ id: "q1" }];
    expect(await selectDealPackageOptionForToken(TOKEN, { optionId: "o1" }, ctx)).toEqual({ ok: true });
    pruefeReihenfolge(/^tx update quotations$/);
  });

  it("selectDealPackageOptionForToken: Annahme unter der Sperre → already_accepted", async () => {
    m.rows.quotation_package_options = [option];
    annahmeUnterSperre();
    expect(await selectDealPackageOptionForToken(TOKEN, { optionId: "o1" }, ctx)).toEqual({ ok: false, reason: "already_accepted" });
    nichtsGeschrieben();
  });

  it("selectPackageForToken", async () => {
    m.rows.objects = [{ id: "obj" }];
    m.rows.attributes = [{ id: "a-oc", slug: "operating_company", type: "record_reference" }];
    m.rows.record_values = [{ attributeId: "a-oc", referencedRecordId: "oc1" }];
    m.rows.offer_packages = [{ slug: "komfort", displayName: "Komfort", priceFromCents: 99000, priceFixedFlag: true }];
    m.rows.quotation_package_options = [];
    // Noch kein Angebot: der Klick legt es an.
    m.rows.quotations = [];
    expect(await selectPackageForToken(TOKEN, { slug: "komfort" }, ctx)).toEqual({ ok: true });
    pruefeReihenfolge(/^tx insert quotations$/);
  });

  it("selectPackageForToken: Annahme unter der Sperre → already_accepted", async () => {
    m.rows.objects = [{ id: "obj" }];
    m.rows.attributes = [{ id: "a-oc", slug: "operating_company", type: "record_reference" }];
    m.rows.record_values = [{ attributeId: "a-oc", referencedRecordId: "oc1" }];
    m.rows.offer_packages = [{ slug: "komfort", displayName: "Komfort", priceFromCents: 99000, priceFixedFlag: true }];
    annahmeUnterSperre();
    expect(await selectPackageForToken(TOKEN, { slug: "komfort" }, ctx)).toEqual({ ok: false, reason: "already_accepted" });
    nichtsGeschrieben();
  });

  it("replaceDateOffers", async () => {
    m.rows.customer_date_selections = [{ selectedDate: "2026-12-01" }];
    const r = await replaceDateOffers({
      workspaceId: "ws",
      dealRecordId: DEAL,
      createdBy: null,
      offers: [{ date: "2026-12-02", slots: [], note: null, isRecommended: true }],
    });
    expect(r).toEqual({ count: 1 });
    pruefeReihenfolge(/^tx delete customer_date_selections$/);
  });

  it("replaceDateOffers: Annahme unter der Sperre → KVA_ACCEPTED", async () => {
    annahmeUnterSperre();
    await expect(
      replaceDateOffers({ workspaceId: "ws", dealRecordId: DEAL, createdBy: null, offers: [] })
    ).rejects.toBeInstanceOf(AngebotAngenommenError);
    nichtsGeschrieben();
  });

  it("selectDateOffer: Auswahl und Termin am Deal unter der Sperre", async () => {
    m.rows.quotation_date_offers = [{ id: "d1", offerDate: "2026-12-02", slots: [{ label: "Vormittag", startTime: "08:00", endTime: "12:00" }] }];
    m.rows.objects = [{ id: "obj" }];
    m.rows.attributes = [{ id: "a-md", slug: "move_date", type: "date" }];
    expect(await selectDateOffer(TOKEN, { dateOfferId: "d1", slotIndex: 0 }, ctx)).toEqual({ ok: true });
    pruefeReihenfolge(/^tx insert record_values$/);
    expect(m.log).toContain("tx insert customer_date_selections");
  });

  it("selectDateOffer: Annahme unter der Sperre → already_accepted", async () => {
    m.rows.quotation_date_offers = [{ id: "d1", offerDate: "2026-12-02", slots: [{ label: "Vormittag" }] }];
    annahmeUnterSperre();
    expect(await selectDateOffer(TOKEN, { dateOfferId: "d1", slotIndex: 0 }, ctx)).toEqual({ ok: false, reason: "already_accepted" });
    nichtsGeschrieben();
  });
});
