import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Modus je Firma gegen eine Wegwerf-Datenbank. Läuft nur mit
 * BEWERTUNG_TEST_DATABASE_URL.
 */
const url = process.env.BEWERTUNG_TEST_DATABASE_URL;

const held = vi.hoisted(() => ({
  client: null as { end: (opts?: { timeout?: number }) => Promise<void> } | null,
}));

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.BEWERTUNG_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 2 });
  held.client = client;
  return { db: drizzle(client, { schema }) };
});

import { bewertungModusSetzen, ladeBewertungModi, ladeBewertungModus, neuesSeit } from "./bewertung-modus";

afterAll(async () => {
  await held.client?.end({ timeout: 5 });
  held.client = null;
});

describe("neuesSeit", () => {
  const t = new Date("2026-11-08T10:00:00Z");
  const alt = new Date("2026-10-01T10:00:00Z");
  it("setzt beim Einschalten, behält zwischen Entwurf und Senden und beim Ausschalten", () => {
    expect(neuesSeit({ modus: "aus", seit: null, hakenPortal: false }, "entwurf", t)).toEqual(t);
    expect(neuesSeit({ modus: "aus", seit: alt, hakenPortal: false }, "senden", t)).toEqual(t);
    expect(neuesSeit({ modus: "entwurf", seit: alt, hakenPortal: false }, "senden", t)).toEqual(alt);
    expect(neuesSeit({ modus: "senden", seit: alt, hakenPortal: false }, "aus", t)).toEqual(alt);
    expect(neuesSeit({ modus: "aus", seit: alt, hakenPortal: false }, "aus", t)).toEqual(alt);
  });
});

describe.skipIf(!url)("bewertungModusSetzen gegen Postgres", () => {
  let sql: postgres.Sql;
  const ws = randomUUID();
  const fremd = randomUUID();
  const ocObj = randomUUID();
  const fremdObj = randomUUID();
  const oc = randomUUID();
  const ocFremd = randomUUID();

  beforeAll(async () => {
    sql = postgres(url!, { max: 1 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Modus', ${`mo-${ws}`}), (${fremd}, 'Fremd', ${`mo-${fremd}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name)
      values (${ocObj}, ${ws}, 'operating_companies', 'Firma', 'Firmen'), (${fremdObj}, ${fremd}, 'operating_companies', 'Firma', 'Firmen')`;
    await sql`insert into records (id, object_id) values (${oc}, ${ocObj}), (${ocFremd}, ${fremdObj})`;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from activity_events where workspace_id in (${ws}, ${fremd})`;
    await sql`delete from company_settings where workspace_id in (${ws}, ${fremd})`;
    await sql`delete from records where object_id in (${ocObj}, ${fremdObj})`;
    await sql`delete from objects where id in (${ocObj}, ${fremdObj})`;
    await sql`delete from workspaces where id in (${ws}, ${fremd})`;
    await sql.end({ timeout: 5 });
  });

  it("ohne Zeile aus, null, false", async () => {
    expect(await ladeBewertungModus(ws, oc)).toEqual({ modus: "aus", seit: null, hakenPortal: false });
    expect((await ladeBewertungModi(ws)).size).toBe(0);
  });

  it("Einschalten setzt seit, Wechsel behält, Aus behält, wieder an setzt neu", async () => {
    const t1 = new Date("2026-11-01T10:00:00Z");
    const t2 = new Date("2026-11-02T10:00:00Z");
    const t3 = new Date("2026-11-03T10:00:00Z");
    await bewertungModusSetzen(ws, oc, { modus: "entwurf" }, "u1", t1);
    expect(await ladeBewertungModus(ws, oc)).toEqual({ modus: "entwurf", seit: t1, hakenPortal: false });
    await bewertungModusSetzen(ws, oc, { modus: "senden" }, "u1", t2);
    expect((await ladeBewertungModus(ws, oc)).seit).toEqual(t1);
    await bewertungModusSetzen(ws, oc, { modus: "aus" }, "u1", t2);
    expect(await ladeBewertungModus(ws, oc)).toEqual({ modus: "aus", seit: t1, hakenPortal: false });
    await bewertungModusSetzen(ws, oc, { modus: "senden" }, "u1", t3);
    expect((await ladeBewertungModus(ws, oc)).seit).toEqual(t3);
    const modi = await ladeBewertungModi(ws);
    expect(modi.get(oc)?.modus).toBe("senden");
  });

  it("Haken allein ändert den Modus nicht und schreibt ein Ereignis", async () => {
    await bewertungModusSetzen(ws, oc, { hakenPortal: true }, "u2");
    expect(await ladeBewertungModus(ws, oc)).toMatchObject({ modus: "senden", hakenPortal: true });
    const ev = await sql<{ actor_id: string; payload: { nachher: { hakenPortal: boolean } } }[]>`
      select actor_id, payload from activity_events where workspace_id = ${ws} and record_id = ${oc}
        and event_type = 'bewertung.modus_geaendert' order by created_at desc limit 1`;
    expect(ev[0]).toMatchObject({ actor_id: "u2", payload: { nachher: { hakenPortal: true } } });
  });

  it("ohne Änderung kein Ereignis", async () => {
    const [{ n: vorher }] = await sql<{ n: number }[]>`select count(*)::int as n from activity_events where record_id = ${oc}`;
    await bewertungModusSetzen(ws, oc, { hakenPortal: true }, "u2");
    const [{ n: nachher }] = await sql<{ n: number }[]>`select count(*)::int as n from activity_events where record_id = ${oc}`;
    expect(nachher).toBe(vorher);
  });

  it("fremde Firma und Unsinn werden abgelehnt", async () => {
    await expect(bewertungModusSetzen(ws, ocFremd, { modus: "senden" }, "u1")).rejects.toMatchObject({ code: "FIRMA" });
    await expect(bewertungModusSetzen(ws, oc, { modus: "immer" as never }, "u1")).rejects.toMatchObject({ code: "EINGABE" });
    expect(await ladeBewertungModus(fremd, ocFremd)).toEqual({ modus: "aus", seit: null, hakenPortal: false });
  });

  it("M2: Senden → Entwurf macht offene Automatik-Zeilen zu Entwürfen, Aus verwirft sie, Hand bleibt", async () => {
    const dObj = randomUUID();
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${dObj}, ${ws}, 'deals', 'Deal', 'Deals')`;
    const [d1, d2, d3] = [randomUUID(), randomUUID(), randomUUID()];
    await sql`insert into records (id, object_id) values (${d1}, ${dObj}), (${d2}, ${dObj}), (${d3}, ${dObj})`;
    await bewertungModusSetzen(ws, oc, { modus: "senden" }, "u1");
    const vm = (d: string, art: string) =>
      sql`insert into review_vormerkungen (id, workspace_id, deal_record_id, operating_company_record_id, art, faellig_ab, frist_bis)
          values (${randomUUID()}, ${ws}, ${d}, ${oc}, ${art}, now(), now() + interval '1 day')`;
    await vm(d1, "auto");
    await vm(d2, "hand");
    await bewertungModusSetzen(ws, oc, { modus: "entwurf" }, "u1");
    const stand = async () =>
      Object.fromEntries(
        (await sql<{ deal_record_id: string; art: string; status: string; sperre: string | null }[]>`
          select deal_record_id, art, status, sperre from review_vormerkungen where workspace_id = ${ws}`).map((r) => [r.deal_record_id, r])
      );
    expect((await stand())[d1]).toMatchObject({ art: "entwurf", status: "offen" });
    await bewertungModusSetzen(ws, oc, { modus: "aus" }, "u1");
    const s = await stand();
    expect(s[d1]).toMatchObject({ status: "verworfen", sperre: "MODUS" });
    expect(s[d2]).toMatchObject({ art: "hand", status: "offen" });
    await sql`delete from review_vormerkungen where workspace_id = ${ws}`;
    await sql`delete from records where object_id = ${dObj}`;
    await sql`delete from objects where id = ${dObj}`;
    void d3;
  });
});
