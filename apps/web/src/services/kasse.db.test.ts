import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * `ladeKasse` gegen eine Wegwerf-Datenbank (Schema aktuell). Läuft nur mit
 * GELD_TEST_DATABASE_URL. Beide Clients werden geschlossen: der Test-Client
 * und der postgres-js-Client hinter dem gemockten `@/db`.
 */
const url = process.env.GELD_TEST_DATABASE_URL;

const held = vi.hoisted(() => ({
  client: null as { end: (opts?: { timeout?: number }) => Promise<void> } | null,
}));

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.GELD_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 1 });
  held.client = client;
  return { db: drizzle(client, { schema }) };
});

import { ladeKasse } from "./kasse";

async function clientSchliessen(): Promise<void> {
  const client = held.client;
  held.client = null;
  await client?.end({ timeout: 5 });
}

afterAll(async () => {
  await clientSchliessen();
});

describe.skipIf(!url)("ladeKasse gegen Postgres", () => {
  let sql: postgres.Sql | undefined;
  const ws = randomUUID();
  const obj = randomUUID();
  const deal = randomUUID();
  const invoice = randomUUID();
  const payment = randomUUID();

  beforeAll(async () => {
    sql = postgres(url!, { max: 1 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Kasse Test', ${`k-${ws}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${obj}, ${ws}, 'deals', 'Deal', 'Deals')`;
    await sql`insert into records (id, object_id) values (${deal}, ${obj})`;
    await sql`
      insert into deal_invoices (id, workspace_id, deal_record_id, herkunft, status, brutto_cent, rechnungstag, faellig_am, nummer)
      values (${invoice}, ${ws}, ${deal}, 'crm', 'gestellt', 150000, '2026-10-01', '2026-10-01', 'RE-TEST-1')
    `;
    await sql`
      insert into payments (id, workspace_id, deal_record_id, date, amount, tax_treatment, payment_method)
      values (${payment}, ${ws}, ${deal}, '2026-10-02', '400.00', 'betriebseinnahme', 'bank_transfer')
    `;
  });

  afterAll(async () => {
    if (sql) {
      await sql`delete from payments where workspace_id = ${ws}`;
      await sql`delete from deal_invoices where workspace_id = ${ws}`;
      await sql`delete from records where id = ${deal}`;
      await sql`delete from objects where id = ${obj}`;
      await sql`delete from workspaces where id = ${ws}`;
      await sql.end({ timeout: 5 });
    }
    await clientSchliessen();
  });

  it("gestellte Rechnung minus Zahlung liegt in offen", async () => {
    const k = await ladeKasse(ws, null, new Date("2026-11-06T11:00:00.000Z"));
    const zeile = k.schlangen.offen.find((z) => z.dealId === deal);
    expect(zeile?.betragCent).toBe(110000);
    expect(k.schlangen.ohne_rechnung.some((z) => z.dealId === deal)).toBe(false);
  });
});
