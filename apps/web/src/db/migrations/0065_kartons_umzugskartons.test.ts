import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sql = readFileSync(new URL("./0065_kartons_umzugskartons.sql", import.meta.url), "utf8");

describe("Migration 0065 Kartons (Text)", () => {
  it("ändert nur Entwürfe, nichts wird gelöscht", () => {
    expect(sql).not.toMatch(/\b(DROP|DELETE|ALTER)\b/i);
    expect(sql).toMatch(/v\."status" = 'entwurf'/);
  });
  it("steht im Journal als idx 65", () => {
    const journal = JSON.parse(readFileSync(new URL("./meta/_journal.json", import.meta.url), "utf8"));
    expect(journal.entries.find((e: { idx: number }) => e.idx === 65)).toMatchObject({ tag: "0065_kartons_umzugskartons" });
  });
});

/** Gegen die Wegwerf-Postgres (ANNAHME_TEST_DATABASE_URL): eigenes Schema, zweimal laufen. */
const url = process.env.ANNAHME_TEST_DATABASE_URL;

describe.skipIf(!url)("Migration 0065 Kartons (DB)", () => {
  let db: postgres.Sql;
  const schema = `m0065_${Date.now().toString(36)}`;
  const u = (key: string, wert: unknown) => ({ id: key, art: "eingabe", key, wert, grund: "g", rechnerwert: null, autor: { userId: "u", quelle: "mensch" }, zeit: "2026-11-01T10:00:00Z", fotoRef: null });

  beforeAll(async () => {
    db = postgres(url!, { max: 1 });
    await db.unsafe(`CREATE SCHEMA ${schema}`);
    await db.unsafe(`SET search_path TO ${schema}`);
    await db.unsafe(`CREATE TABLE deal_calculation_versions (id text primary key, status text not null, overrides jsonb not null default '[]')`);
    await db`insert into deal_calculation_versions ${db([
      { id: "e1", status: "entwurf", overrides: db.json([u("volumen", 20), u("kartons", 15), { ...u("marge", 40), art: "marge" }]) },
      { id: "g1", status: "gesperrt", overrides: db.json([u("kartons", 15)]) },
      { id: "e2", status: "entwurf", overrides: db.json([u("team", 3)]) },
    ])}`;
  });
  afterAll(async () => {
    await db.unsafe(`DROP SCHEMA ${schema} CASCADE`);
    await db.end();
  });

  it("deutet kartons im Entwurf um, lässt Gesperrtes und Reihenfolge, zweimal idempotent", async () => {
    await db.unsafe(sql);
    await db.unsafe(sql);
    const zeilen = await db<{ id: string; overrides: Array<Record<string, unknown>> }[]>`select id, overrides from deal_calculation_versions order by id`;
    const by = Object.fromEntries(zeilen.map((z) => [z.id, z.overrides]));
    expect(by.e1.map((x) => x.key)).toEqual(["volumen", "umzugskartons", "marge"]);
    expect(by.e1[1]).toMatchObject({ key: "umzugskartons", wert: 15, umgedeutet: "kartons", grund: "g" });
    expect(by.g1[0]).toMatchObject({ key: "kartons" });
    expect(by.g1[0]).not.toHaveProperty("umgedeutet");
    expect(by.e2.map((x) => x.key)).toEqual(["team"]);
  });
});
