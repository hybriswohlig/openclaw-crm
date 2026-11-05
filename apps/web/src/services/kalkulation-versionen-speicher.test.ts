import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insertReturning: vi.fn(),
  txReturning: vi.fn(),
  txSet: vi.fn(),
  txStatus: vi.fn(),
  txAnnahme: vi.fn(),
  txExecute: vi.fn(),
  reihenfolge: [] as string[],
  updateSet: vi.fn(),
  updateReturning: vi.fn(),
  angebotAusVersionSchreiben: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    insert: () => ({ values: () => ({ returning: mocks.insertReturning }) }),
    update: () => ({
      set: (s: unknown) => {
        mocks.updateSet(s);
        return { where: () => ({ returning: mocks.updateReturning }) };
      },
    }),
    transaction: async (f: (tx: unknown) => Promise<unknown>) => {
      const { kvaConfirmations } = await import("@/db/schema/customer-portal");
      const tx = {
        execute: async (q: unknown) => {
          mocks.reihenfolge.push("sperre");
          return mocks.txExecute(q);
        },
        update: () => ({
          set: (s: unknown) => {
            mocks.reihenfolge.push("version");
            mocks.txSet(s);
            return { where: () => ({ returning: mocks.txReturning }) };
          },
        }),
        select: () => ({
          from: (tabelle: unknown) => ({
            where: () => ({
              limit: async () => {
                if (tabelle === kvaConfirmations) {
                  mocks.reihenfolge.push("annahme");
                  return mocks.txAnnahme();
                }
                return mocks.txStatus();
              },
            }),
          }),
        }),
      };
      return f(tx);
    },
  },
}));
vi.mock("./quotations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./quotations")>()),
  angebotAusVersionSchreiben: (...a: unknown[]) => {
    mocks.reihenfolge.push("angebot");
    return mocks.angebotAusVersionSchreiben(...a);
  },
}));
vi.mock("./financial", () => ({ resolveDealOperatingCompany: vi.fn() }));

import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { dbVersionsSpeicher, istEntwurfKonflikt } from "./kalkulation-versionen-speicher";
import { EntwurfExistiertError, VersionsFehler } from "./kalkulation-versionen";
import { AngebotAngenommenError } from "./kva-annahme";

const pgFehler = (constraint: string) => Object.assign(new Error("duplicate key"), { code: "23505", constraint_name: constraint });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reihenfolge.length = 0;
  mocks.txAnnahme.mockResolvedValue([]);
  mocks.txExecute.mockResolvedValue([]);
});

describe("istEntwurfKonflikt", () => {
  it("erkennt 23505 auf dem Teil-Index, auch in cause verpackt; andere Verletzungen nicht", () => {
    expect(istEntwurfKonflikt(pgFehler("deal_calculation_versions_ein_entwurf"))).toBe(true);
    expect(istEntwurfKonflikt(Object.assign(new Error("Failed query"), { cause: pgFehler("deal_calculation_versions_ein_entwurf") }))).toBe(true);
    expect(istEntwurfKonflikt(pgFehler("quotations_deal_record_id_unique"))).toBe(false);
    expect(istEntwurfKonflikt(Object.assign(new Error("x"), { code: "23503", constraint_name: "deal_calculation_versions_ein_entwurf" }))).toBe(false);
  });
});

describe("dbVersionsSpeicher", () => {
  const zeile = { workspaceId: "ws", dealRecordId: "deal1", version: 2 } as never;

  it("anlegen: Unique-Verletzung des Entwurfs-Index → EntwurfExistiertError, sonst Fehler unverändert", async () => {
    mocks.insertReturning.mockRejectedValueOnce(pgFehler("deal_calculation_versions_ein_entwurf"));
    await expect(dbVersionsSpeicher.anlegen(zeile)).rejects.toBeInstanceOf(EntwurfExistiertError);
    const anderer = pgFehler("irgendwas");
    mocks.insertReturning.mockRejectedValueOnce(anderer);
    await expect(dbVersionsSpeicher.anlegen(zeile)).rejects.toBe(anderer);
  });

  it("sperrenUndAngebot: Version gesperrt mit Cent-Summe, Quotation in derselben Transaktion", async () => {
    mocks.txReturning.mockResolvedValueOnce([{ id: "id_v2", status: "gesperrt" }]);
    const kvItems = [{ description: "Umzug", quantity: 1, unitRate: 1340 }, { description: "Halteverbot", quantity: 2, unitRate: 75.5 }];
    const r = await dbVersionsSpeicher.sperrenUndAngebot("ws", "deal1", "id_v2", { fixedPrice: "1491" } as never, kvItems, "usr_1");
    expect(r.version).toMatchObject({ id: "id_v2", status: "gesperrt" });
    expect(mocks.txSet).toHaveBeenCalledWith(expect.objectContaining({ status: "gesperrt", kvItems, priceCents: 149100, lockedBy: "usr_1" }));
    expect(mocks.angebotAusVersionSchreiben).toHaveBeenCalledWith(expect.anything(), "deal1", { fixedPrice: "1491" }, "id_v2");
  });

  it("sperrenUndAngebot: zuerst Sperre des Angebots je Deal, dann Annahme in der Transaktion, dann schreiben (Review 2)", async () => {
    mocks.txReturning.mockResolvedValueOnce([{ id: "id_v2", status: "gesperrt" }]);
    await dbVersionsSpeicher.sperrenUndAngebot("ws", "deal1", "id_v2", {} as never, [], "usr_1");
    expect(mocks.reihenfolge).toEqual(["sperre", "annahme", "version", "angebot"]);
    const q = new PgDialect().sqlToQuery(mocks.txExecute.mock.calls[0][0] as SQL);
    expect(q.sql).toBe("select pg_advisory_xact_lock(hashtext('angebot:' || $1::text))");
    expect(q.params).toEqual(["deal1"]);
  });

  it("sperrenUndAngebot: Kunde hat während der Neuberechnung angenommen → AngebotAngenommenError, nichts geschrieben", async () => {
    mocks.txAnnahme.mockResolvedValueOnce([{ id: "kva_1" }]);
    const fehler = await dbVersionsSpeicher.sperrenUndAngebot("ws", "deal1", "id_v2", {} as never, [], "usr_1", { uebersteuerungen: 0 }).catch((e: unknown) => e);
    expect(fehler).toBeInstanceOf(AngebotAngenommenError);
    expect(mocks.txSet).not.toHaveBeenCalled();
    expect(mocks.angebotAusVersionSchreiben).not.toHaveBeenCalled();
    expect(mocks.reihenfolge).toEqual(["sperre", "annahme"]);
  });

  it("sperrenUndAngebot mit Schnappschuss: schreibt den gerechneten Stand mit, error null", async () => {
    mocks.txReturning.mockResolvedValueOnce([{ id: "id_v2", status: "gesperrt" }]);
    const schnappschuss = {
      referenceDate: "2026-11-05", rechnerRequest: { heute: "2026-11-05" }, rechnerResult: { preis: { festpreis: 1490 } },
      inputs: [], costLines: [], margin: null, packagePrices: [], tariff: null,
    };
    await dbVersionsSpeicher.sperrenUndAngebot("ws", "deal1", "id_v2", {} as never, [], "usr_1", { uebersteuerungen: 0, schnappschuss } as never);
    expect(mocks.txSet).toHaveBeenCalledWith(expect.objectContaining({ ...schnappschuss, error: null, status: "gesperrt", priceCents: 0 }));
  });

  it("anhaengen: atomar in SQL (overrides || neu::jsonb), nur am Entwurf; gesperrt → UNGUELTIG", async () => {
    const u = { id: "u1", art: "marge", key: "marge", wert: 45 } as never;
    mocks.updateReturning.mockResolvedValueOnce([{ id: "id_v2", overrides: [u] }]);
    const r = await dbVersionsSpeicher.anhaengen("id_v2", u);
    expect(r.overrides).toEqual([u]);
    const set = mocks.updateSet.mock.calls[0][0] as { overrides: SQL };
    const q = new PgDialect().sqlToQuery(set.overrides);
    expect(q.sql).toBe('"deal_calculation_versions"."overrides" || $1::jsonb');
    expect(JSON.parse(q.params[0] as string)).toEqual([u]);
    mocks.updateReturning.mockResolvedValueOnce([]);
    await expect(dbVersionsSpeicher.anhaengen("id_v2", u)).rejects.toMatchObject({ code: "UNGUELTIG" });
  });

  it("aktualisieren überschreibt die Übersteuerungen nie", async () => {
    mocks.updateReturning.mockResolvedValueOnce([{ id: "id_v2" }]);
    await dbVersionsSpeicher.aktualisieren("id_v2", { overrides: [], error: null, status: "gesperrt" } as never);
    const set = mocks.updateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(set).not.toHaveProperty("overrides");
    expect(set).not.toHaveProperty("status");
    expect(set).toHaveProperty("error", null);
  });

  it("sperrenUndAngebot: Liste hat sich geändert (Entwurf, andere Anzahl) → UNGUELTIG \"gerade geändert\", keine Quotation", async () => {
    mocks.txReturning.mockResolvedValueOnce([]);
    mocks.txStatus.mockResolvedValueOnce([{ status: "entwurf" }]);
    await expect(
      dbVersionsSpeicher.sperrenUndAngebot("ws", "deal1", "id_v2", {} as never, [], null, { uebersteuerungen: 2 })
    ).rejects.toMatchObject({ code: "UNGUELTIG", message: "Die Kalkulation wurde gerade geändert. Bitte erneut sperren." });
    expect(mocks.angebotAusVersionSchreiben).not.toHaveBeenCalled();
  });

  it("sperrenUndAngebot: schon gesperrt (0 Zeilen) → UNGUELTIG, keine Quotation geschrieben", async () => {
    mocks.txReturning.mockResolvedValueOnce([]);
    mocks.txStatus.mockResolvedValueOnce([{ status: "gesperrt" }]);
    const fehler = await dbVersionsSpeicher.sperrenUndAngebot("ws", "deal1", "id_v2", {} as never, [], null).catch((e: unknown) => e);
    expect(fehler).toBeInstanceOf(VersionsFehler);
    expect(fehler).toMatchObject({ code: "UNGUELTIG", message: "Version ist bereits gesperrt." });
    expect(mocks.angebotAusVersionSchreiben).not.toHaveBeenCalled();
  });
});
