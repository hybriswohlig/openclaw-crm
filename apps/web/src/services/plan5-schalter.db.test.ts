import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Plan 15, Bauteil 15: „Pakete anbieten“ am Deal übersteuert den Firmen-Schalter
 * (ANNAHME_TEST_DATABASE_URL). Alle Leser (Sperren, Ansicht, Portal-Kontext,
 * Rechner-Anfrage, Termin-Dialog) gehen über `plan5Schalter`.
 */
const url = process.env.ANNAHME_TEST_DATABASE_URL;

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  return { db: drizzle(pg(process.env.ANNAHME_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 4 }), { schema }) };
});

describe.skipIf(!url)("plan5Schalter mit Wert am Deal (DB, Plan 15)", { timeout: 30_000 }, () => {
  let sql: postgres.Sql;
  let m: typeof import("./plan5-schalter");
  const ws = randomUUID();
  const ids = { deals: randomUUID(), oc: randomUUID(), attr: randomUUID(), firmaAn: randomUUID(), firmaAus: randomUUID(), d1: randomUUID(), d2: randomUUID() };

  async function setzeFirma(deal: string, firma: string) {
    await sql`insert into record_values (id, record_id, attribute_id, referenced_record_id) values (${randomUUID()}, ${deal}, ${ids.attr}, ${firma})`;
  }

  beforeAll(async () => {
    sql = postgres(url!, { max: 2 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Test', ${`t-${ws}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${ids.deals}, ${ws}, 'deals', 'Deal', 'Deals'), (${ids.oc}, ${ws}, 'operating_companies', 'Firma', 'Firmen')`;
    await sql`insert into attributes (id, object_id, slug, title, type) values (${ids.attr}, ${ids.deals}, 'operating_company', 'Firma', 'record_reference')`;
    await sql`insert into records (id, object_id) values (${ids.firmaAn}, ${ids.oc}), (${ids.firmaAus}, ${ids.oc}), (${ids.d1}, ${ids.deals}), (${ids.d2}, ${ids.deals})`;
    await sql`insert into operating_company_portal_settings (operating_company_record_id, workspace_id, angebot_aus_kalkulation, tagespreise_enabled)
      values (${ids.firmaAn}, ${ws}, true, true), (${ids.firmaAus}, ${ws}, false, false)`;
    await sql`insert into offer_packages (id, workspace_id, operating_company_record_id, slug, display_name) values (${randomUUID()}, ${ws}, ${ids.firmaAus}, 'komfort', 'Komfort')`;
    await setzeFirma(ids.d1, ids.firmaAus);
    await setzeFirma(ids.d2, ids.firmaAn);
    m = await import("./plan5-schalter");
  });
  afterAll(async () => {
    await sql`delete from deal_workflow_state where record_id in (${ids.d1}, ${ids.d2})`;
    await sql`delete from offer_packages where workspace_id = ${ws}`;
    await sql`delete from operating_company_portal_settings where workspace_id = ${ws}`;
    await sql`delete from record_values where record_id in (${ids.d1}, ${ids.d2})`;
    await sql`delete from records where object_id in (${ids.deals}, ${ids.oc})`;
    await sql`delete from attributes where object_id = ${ids.deals}`;
    await sql`delete from objects where workspace_id = ${ws}`;
    await sql`delete from workspaces where id = ${ws}`;
    await sql.end();
  });

  it("Firmenstandard: unverändert wie heute", async () => {
    expect(await m.plan5Schalter(ws, ids.d1)).toEqual({ angebotAusKalkulation: false, tagespreise: false });
    expect(await m.plan5Schalter(ws, ids.d2)).toEqual({ angebotAusKalkulation: true, tagespreise: true });
  });

  it("Deal an bei Firma aus: Pakete an (Tagespreise bleiben beim Firmenschalter); Basis fehlt wird gemeldet", async () => {
    await m.paketeAnbietenSetzen(ids.d1, "an");
    expect(await m.plan5Schalter(ws, ids.d1)).toEqual({ angebotAusKalkulation: true, tagespreise: false });
    expect(await m.paketSchalter(ws, ids.d1)).toEqual({ firma: false, deal: "an", wirksam: true, pakete: { aktiv: 1, basis: false } });
  });

  it("Deal aus bei Firma an: wie ohne Pakete; zurück auf Standard", async () => {
    await m.paketeAnbietenSetzen(ids.d2, "aus");
    expect(await m.plan5Schalter(ws, ids.d2)).toEqual({ angebotAusKalkulation: false, tagespreise: true });
    await m.paketeAnbietenSetzen(ids.d2, null);
    expect(await m.plan5Schalter(ws, ids.d2)).toEqual({ angebotAusKalkulation: true, tagespreise: true });
  });
});
