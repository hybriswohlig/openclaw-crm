import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { dbOrteSpeicher, ortPunkte, type OrtAnfrage } from "./einsatz-geo";

/**
 * Kartenpunkte gegen die Wegwerf-Postgres (EINSATZ_TEST_DATABASE_URL).
 * Google ist gefälscht. Die Karte schreibt `einsatz_orte`, nie `deal_employees`.
 */
const url = process.env.EINSATZ_TEST_DATABASE_URL;

const h = vi.hoisted(() => ({ client: null as null | { end: (o?: { timeout?: number }) => Promise<void> } }));

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.EINSATZ_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 4, onnotice: () => {} });
  h.client = client;
  return { db: drizzle(client, { schema }) };
});
vi.mock("./plan", async (orig) => ({
  ...(await orig<typeof import("./plan")>()),
  ladePlanEintraege: async () => ({ eintraege: [], alle: [], roh: {} }),
}));

afterAll(async () => {
  await h.client?.end({ timeout: 5 });
});

describe.skipIf(!url)("Einsatz-Karte (DB)", { timeout: 20_000 }, () => {
  let sql: postgres.Sql;
  let karte: typeof import("./einsatz-karte");
  const ws = randomUUID();
  const obj = randomUUID();
  const deal = randomUUID();
  const anna = randomUUID();
  const ina = randomUUID();

  beforeAll(async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("fetch nicht gefälscht");
    }));
    sql = postgres(url!, { max: 1, onnotice: () => {} });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Karte', ${`t-${ws}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${obj}, ${ws}, 'deals', 'Deal', 'Deals')`;
    await sql`insert into records (id, object_id) values (${deal}, ${obj})`;
    await sql`insert into employees (id, workspace_id, name, hourly_rate, rate_work_cents, home_plz, home_town) values (${anna}, ${ws}, 'Anna', 20.00, 2000, '70176', 'Stuttgart')`;
    await sql`insert into employees (id, workspace_id, name, hourly_rate, rate_work_cents, active, home_plz, home_town) values (${ina}, ${ws}, 'Ina', 20.00, 2000, false, '73728', 'Esslingen')`;
    await sql`insert into deal_employees (id, deal_record_id, employee_id, role) values (${randomUUID()}, ${deal}, ${anna}, 'helper')`;
    await sql`insert into deal_employees (id, deal_record_id, employee_id, role) values (${randomUUID()}, ${deal}, ${ina}, 'helper')`;
    karte = await import("./einsatz-karte");
  });

  afterAll(async () => {
    if (sql) {
      await sql`delete from workspaces where id = ${ws}`;
      await sql.end({ timeout: 5 });
    }
    vi.unstubAllGlobals();
  });

  const zahl = async () => {
    const [z] = await sql`select count(*)::int as n from deal_employees where deal_record_id = ${deal}`;
    return z!.n as number;
  };

  it("dbOrteSpeicher schreibt, liest und erneuert berechnet_am", async () => {
    await dbOrteSpeicher.schreiben(ws, [{ ortSchluessel: "70173 stuttgart", lat: 48.5, lng: 9.25 }]);
    const [erst] = await dbOrteSpeicher.lesen(ws, ["70173 stuttgart"]);
    expect(erst).toMatchObject({ ortSchluessel: "70173 stuttgart", lat: 48.5, lng: 9.25 });
    expect(await dbOrteSpeicher.lesen(ws, ["gibt es nicht"])).toEqual([]);
    await sql`update einsatz_orte set berechnet_am = '2020-01-01T00:00:00Z', lat = 1, lng = 2 where workspace_id = ${ws} and ort_schluessel = '70173 stuttgart'`;
    await dbOrteSpeicher.schreiben(ws, [{ ortSchluessel: "70173 stuttgart", lat: 48.75, lng: 9.5 }]);
    const [neu] = await dbOrteSpeicher.lesen(ws, ["70173 stuttgart"]);
    expect(neu).toMatchObject({ lat: 48.75, lng: 9.5 });
    expect(neu!.berechnetAm.getTime()).toBeGreaterThan(new Date("2024-01-01").getTime());
  });

  it("ladeEinsatzKarte geocodiert einmal, der zweite Aufruf trifft den Cache, deal_employees bleibt", async () => {
    const vorher = await zahl();
    expect(vorher).toBe(2);
    const abruf = vi.fn(async (u: string) => {
      expect(decodeURIComponent(u)).toContain("70176 Stuttgart");
      expect(decodeURIComponent(u)).not.toContain("Anna");
      expect(decodeURIComponent(u)).not.toContain("Ina");
      return new Response(JSON.stringify({ status: "OK", results: [{ geometry: { location: { lat: 48.5, lng: 9.25 } } }] }));
    });
    const orte = (w: string, anfragen: OrtAnfrage[]) => ortPunkte(w, anfragen, { abruf, speicher: dbOrteSpeicher, schluessel: "test-key" });
    const opt = { orte, routen: async () => null, lead: async () => null };
    const erste = await karte.ladeEinsatzKarte(ws, deal, opt);
    expect(abruf).toHaveBeenCalledTimes(1);
    expect(erste.personen.map((p) => p.employeeId)).toEqual([anna]);
    expect(erste.personen[0]?.punkt).toEqual([9.25, 48.5]);
    expect(await dbOrteSpeicher.lesen(ws, ["73728 esslingen"])).toEqual([]);
    expect(await zahl()).toBe(vorher);

    const zweite = await karte.ladeEinsatzKarte(ws, deal, opt);
    expect(abruf).toHaveBeenCalledTimes(1);
    expect(zweite.personen[0]?.punkt).toEqual([9.25, 48.5]);
    expect(await zahl()).toBe(vorher);
  });
});
