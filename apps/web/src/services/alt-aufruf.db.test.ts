import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Plan 14, Task W: `altAufrufMerken` gegen eine echte Postgres-DB. Höchstens ein Eintrag
 * je Nutzer, Pfad und Minute, record_id null. Läuft nur mit ANNAHME_TEST_DATABASE_URL
 * (Wegwerf-DB, z. B. postgres://postgres@127.0.0.1:54351/p14_annahme).
 */
const url = process.env.ANNAHME_TEST_DATABASE_URL;

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  return { db: drizzle(pg(process.env.ANNAHME_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 4 }), { schema }) };
});

describe.skipIf(!url)("altAufrufMerken (DB, Plan 14)", { timeout: 30_000 }, () => {
  let sql: postgres.Sql;
  let altAufrufMerken: typeof import("./alt-aufruf").altAufrufMerken;
  const ws = randomUUID();
  const t0 = new Date("2026-11-07T10:15:20Z");
  const plus = (s: number) => new Date(t0.getTime() + s * 1000);

  beforeAll(async () => {
    sql = postgres(url!, { max: 2 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Test', ${`t-${ws}`})`;
    ({ altAufrufMerken } = await import("./alt-aufruf"));
  });
  beforeEach(async () => {
    await sql`delete from activity_events where workspace_id = ${ws}`;
  });
  afterAll(async () => {
    await sql`delete from activity_events where workspace_id = ${ws}`;
    await sql`delete from workspaces where id = ${ws}`;
    await sql.end();
  });

  const zeilen = () =>
    sql`select record_id, object_slug, event_type, actor_id, payload, created_at from activity_events where workspace_id = ${ws} order by created_at`;

  it("merkt den ersten Aufruf ohne Datensatz und meldet den zweiten derselben Minute als doppelt", async () => {
    const a = { pfad: "/home", ui: "neu" as const, mitAlt: false };
    expect(await altAufrufMerken(ws, "u1", a, t0)).toBe("gemerkt");
    expect(await altAufrufMerken(ws, "u1", a, plus(30))).toBe("doppelt");
    const z = await zeilen();
    expect(z).toHaveLength(1);
    expect(z[0]).toMatchObject({ record_id: null, object_slug: null, event_type: "alte_seite.aufruf", actor_id: "u1", payload: a });
  });

  it("zählt neu in der nächsten Minute, für einen anderen Pfad und für einen anderen Nutzer", async () => {
    const a = { pfad: "/home", ui: null, mitAlt: false };
    expect(await altAufrufMerken(ws, "u1", a, t0)).toBe("gemerkt");
    expect(await altAufrufMerken(ws, "u1", a, plus(40))).toBe("gemerkt"); // 10:16:00
    expect(await altAufrufMerken(ws, "u1", { ...a, pfad: "/financial" }, t0)).toBe("gemerkt");
    expect(await altAufrufMerken(ws, "u2", a, t0)).toBe("gemerkt");
    expect(await zeilen()).toHaveLength(4);
  });

  it("schreibt bei gleichzeitigen Aufrufen genau einen Eintrag", async () => {
    const a = { pfad: "/operations", ui: "neu" as const, mitAlt: true };
    const ergebnisse = await Promise.all([1, 2, 3, 4].map(() => altAufrufMerken(ws, "u1", a, t0)));
    expect(ergebnisse.filter((e) => e === "gemerkt")).toHaveLength(1);
    expect(await zeilen()).toHaveLength(1);
  });
});
