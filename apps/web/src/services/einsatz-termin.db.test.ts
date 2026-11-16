import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { crewTestSchemaAnlegen, wertSetzen } from "./crew/testdb";

/**
 * Regression: `dealTerminLesen` sortierte nach `customer_date_selections.created_at`,
 * die Spalte heißt `selected_at`. Die Abfrage scheiterte immer, der Aufrufer
 * fing den Fehler und der Einsatz fiel still auf das Datum der Kalkulation
 * zurück. Gegen die Wegwerf-Postgres (EINSATZ_TEST_DATABASE_URL).
 */
const url = process.env.EINSATZ_TEST_DATABASE_URL;
const h = vi.hoisted(() => ({ schema: `termin_${Date.now().toString(36)}` }));

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

describe.skipIf(!url)("dealTerminLesen (DB)", { timeout: 20_000 }, () => {
  let sql: postgres.Sql;
  let einsatz: typeof import("./einsatz");

  beforeAll(async () => {
    sql = postgres(url!, { max: 1, onnotice: () => {} });
    await crewTestSchemaAnlegen(sql, h.schema);
    await sql.unsafe(`
      INSERT INTO workspaces VALUES ('w1');
      INSERT INTO objects VALUES ('od', 'w1', 'deals');
      INSERT INTO attributes VALUES ('a_move', 'od', 'move_date');
      INSERT INTO records (id, object_id) VALUES ('d1', 'od'), ('d2', 'od'), ('d3', 'od');
    `);
    await wertSetzen(sql, "d1", "a_move", { datum: "2026-12-01" });
    await wertSetzen(sql, "d2", "a_move", { datum: "2026-12-01" });
    await sql`INSERT INTO customer_date_selections (workspace_id, deal_record_id, selected_date) VALUES ('w1', 'd2', '2026-12-05')`;
    einsatz = await import("./einsatz");
  }, 60_000);

  afterAll(async () => {
    await sql?.unsafe(`DROP SCHEMA ${h.schema} CASCADE`);
    await sql?.end();
  });

  it("Datumswahl im Portal schlägt move_date, ohne Fehler", async () => {
    await expect(einsatz.dealTerminLesen("w1", "d2")).resolves.toBe("2026-12-05");
  });

  it("ohne Wahl move_date, ohne beides null", async () => {
    await expect(einsatz.dealTerminLesen("w1", "d1")).resolves.toBe("2026-12-01");
    await expect(einsatz.dealTerminLesen("w1", "d3")).resolves.toBeNull();
  });

  it("Wahl aus fremdem Workspace zählt nicht", async () => {
    await expect(einsatz.dealTerminLesen("w2", "d2")).resolves.toBeNull();
  });
});
