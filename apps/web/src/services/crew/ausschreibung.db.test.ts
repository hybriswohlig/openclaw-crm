import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { crewTestSchemaAnlegen, wertSetzen } from "./testdb";

/** Ausschreibung lesen gegen die Wegwerf-Postgres; Schreiben geht über updateRecord (hier Attrappe). */
const url = process.env.EINSATZ_TEST_DATABASE_URL;
const h = vi.hoisted(() => ({ schema: `crew_aus_${Date.now().toString(36)}`, update: vi.fn() }));

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.EINSATZ_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", {
    max: 2,
    onnotice: () => {},
    connection: { search_path: h.schema },
  });
  return { db: drizzle(client, { schema }) };
});
vi.mock("@/services/records", () => ({ updateRecord: h.update }));

describe("ausschreibungEingabe", () => {
  it("nur leute 1..50 oder null und ausschreiben boolean; leer oder falsch → null", async () => {
    const { ausschreibungEingabe: e } = await import("./ausschreibung");
    expect(e({ leute: 4 })).toEqual({ leute: 4 });
    expect(e({ leute: null, ausschreiben: false })).toEqual({ leute: null, ausschreiben: false });
    for (const b of [null, [], {}, { leute: 0 }, { leute: 51 }, { leute: 2.5 }, { leute: "3" }, { ausschreiben: "ja" }, { andere: 1 }]) {
      expect(e(b), JSON.stringify(b)).toBeNull();
    }
  });
});

describe.skipIf(!url)("Crew-Ausschreibung (DB)", { timeout: 20_000 }, () => {
  let sql: postgres.Sql;
  let mod: typeof import("./ausschreibung");

  beforeAll(async () => {
    sql = postgres(url!, { max: 1, onnotice: () => {} });
    await crewTestSchemaAnlegen(sql, h.schema);
    await sql.unsafe(`
      INSERT INTO workspaces VALUES ('w1'), ('w2');
      INSERT INTO objects VALUES ('od', 'w1', 'deals'), ('oa', 'w1', 'auftraege'), ('oa2', 'w2', 'auftraege');
      INSERT INTO attributes VALUES ('a_deal', 'oa', 'deal'), ('a_wc', 'oa', 'worker_count'), ('a_aus', 'oa', 'crew_ausschreiben'), ('a2_deal', 'oa2', 'deal');
      INSERT INTO records (id, object_id) VALUES ('d1', 'od'), ('d2', 'od'), ('d3', 'od'), ('au1', 'oa'), ('au2', 'oa'), ('fremd', 'oa2');
      INSERT INTO deal_calculation_versions (workspace_id, deal_record_id, status, version, rechner_result) VALUES
        ('w1', 'd1', 'gesperrt', 1, '{"team":{"groesse":4}}'), ('w1', 'd2', 'entwurf', 1, '{"team":{"groesse":3}}');
    `);
    await wertSetzen(sql, "au1", "a_deal", { ref: "d1" });
    await wertSetzen(sql, "au2", "a_deal", { ref: "d2" });
    await wertSetzen(sql, "au2", "a_wc", { zahl: 2 });
    await wertSetzen(sql, "au2", "a_aus", { ja: false });
    // Auftrag eines anderen Workspace, der auf d3 zeigt: darf nie gefunden werden.
    await wertSetzen(sql, "fremd", "a2_deal", { ref: "d3" });
    mod = await import("./ausschreibung");
  }, 60_000);

  afterAll(async () => {
    await sql?.unsafe(`DROP SCHEMA ${h.schema} CASCADE`);
    await sql?.end();
  });

  beforeEach(() => h.update.mockReset().mockResolvedValue({}));

  it("liest Zahl am Auftrag, Kalkulation und Ausschreiben (leer = ja)", async () => {
    expect(await mod.crewAusschreibungLesen("w1", "d1")).toEqual({ auftragId: "au1", leute: null, ausKalkulation: 4, ausschreiben: true });
    expect(await mod.crewAusschreibungLesen("w1", "d2")).toEqual({ auftragId: "au2", leute: 2, ausKalkulation: 3, ausschreiben: false });
    expect(await mod.crewAusschreibungLesen("w1", "d3")).toEqual({ auftragId: null, leute: null, ausKalkulation: null, ausschreiben: true });
  });

  it("schreibt worker_count und crew_ausschreiben (ja = leer) am richtigen Auftrag", async () => {
    const r = await mod.crewAusschreibungSetzen("w1", "d1", { leute: 5, ausschreiben: true }, "u1");
    expect(r.ok).toBe(true);
    expect(h.update).toHaveBeenCalledWith("oa", "au1", { worker_count: 5, crew_ausschreiben: null }, "u1");
    await mod.crewAusschreibungSetzen("w1", "d2", { ausschreiben: false }, "u1");
    expect(h.update).toHaveBeenLastCalledWith("oa", "au2", { crew_ausschreiben: false }, "u1");
    await mod.crewAusschreibungSetzen("w1", "d2", { leute: null }, "u1");
    expect(h.update).toHaveBeenLastCalledWith("oa", "au2", { worker_count: null }, "u1");
  });

  it("ohne Auftrag im Workspace: KEIN_AUFTRAG, nichts geschrieben", async () => {
    expect(await mod.crewAusschreibungSetzen("w1", "d3", { leute: 3 }, "u1")).toEqual({ ok: false, code: "KEIN_AUFTRAG" });
    expect(await mod.crewAusschreibungSetzen("w2", "d1", { leute: 3 }, "u1")).toEqual({ ok: false, code: "KEIN_AUFTRAG" });
    expect(h.update).not.toHaveBeenCalled();
  });
});
