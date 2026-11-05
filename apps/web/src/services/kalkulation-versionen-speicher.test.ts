import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insertReturning: vi.fn(),
  txReturning: vi.fn(),
  txSet: vi.fn(),
  angebotAusVersionSchreiben: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    insert: () => ({ values: () => ({ returning: mocks.insertReturning }) }),
    transaction: async (f: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        update: () => ({
          set: (s: unknown) => {
            mocks.txSet(s);
            return { where: () => ({ returning: mocks.txReturning }) };
          },
        }),
      };
      return f(tx);
    },
  },
}));
vi.mock("./quotations", () => ({ angebotAusVersionSchreiben: mocks.angebotAusVersionSchreiben }));
vi.mock("./financial", () => ({ resolveDealOperatingCompany: vi.fn() }));

import { dbVersionsSpeicher, istEntwurfKonflikt } from "./kalkulation-versionen-speicher";
import { EntwurfExistiertError, VersionsFehler } from "./kalkulation-versionen";

const pgFehler = (constraint: string) => Object.assign(new Error("duplicate key"), { code: "23505", constraint_name: constraint });

beforeEach(() => vi.clearAllMocks());

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

  it("sperrenUndAngebot: schon gesperrt (0 Zeilen) → UNGUELTIG, keine Quotation geschrieben", async () => {
    mocks.txReturning.mockResolvedValueOnce([]);
    const fehler = await dbVersionsSpeicher.sperrenUndAngebot("ws", "deal1", "id_v2", {} as never, [], null).catch((e: unknown) => e);
    expect(fehler).toBeInstanceOf(VersionsFehler);
    expect(fehler).toMatchObject({ code: "UNGUELTIG", message: "Version ist bereits gesperrt." });
    expect(mocks.angebotAusVersionSchreiben).not.toHaveBeenCalled();
  });
});
