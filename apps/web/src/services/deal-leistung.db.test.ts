import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Leistung in der Akte gegen eine echte Postgres-DB (ANNAHME_TEST_DATABASE_URL):
 * ohne Angebot nur das Deal-Feld, mit Angebot auch quotations.serviceType (bestätigt),
 * nach der Annahme abgelehnt und nichts geändert, Mandantentrennung.
 */
const url = process.env.ANNAHME_TEST_DATABASE_URL;

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  return { db: drizzle(pg(process.env.ANNAHME_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 4 }), { schema }) };
});
const annahme = vi.hoisted(() => ({ aktiv: false }));
vi.mock("./kva-annahme", () => ({ ladeAktiveAnnahme: async () => (annahme.aktiv ? { id: "a1" } : null) }));

describe.skipIf(!url)("Leistung in der Akte (DB)", { timeout: 30_000 }, () => {
  let sql: postgres.Sql;
  let dienst: typeof import("./deal-leistung");
  const ws = randomUUID();
  const fremd = randomUUID();
  const obj = { deals: randomUUID(), fremdDeals: randomUUID() };
  const deal = { ohne: randomUUID(), mit: randomUUID(), entr: randomUUID(), fremd: randomUUID() };

  beforeAll(async () => {
    sql = postgres(url!, { max: 2 });
    for (const w of [ws, fremd]) await sql`insert into workspaces (id, name, slug) values (${w}, 'Test', ${`t-${w}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values
      (${obj.deals}, ${ws}, 'deals', 'Deal', 'Deals'), (${obj.fremdDeals}, ${fremd}, 'deals', 'Deal', 'Deals')`;
    const attr: Record<string, string> = {};
    for (const [o, slug, type] of [
      [obj.deals, "name", "text"],
      [obj.deals, "leistung", "text"],
      [obj.deals, "moving_lead_payload", "json"],
      [obj.fremdDeals, "leistung", "text"],
    ] as const) {
      const id = randomUUID();
      attr[`${o}.${slug}`] = id;
      await sql`insert into attributes (id, object_id, slug, title, type) values (${id}, ${o}, ${slug}, ${slug}, ${type}::text::attribute_type)`;
    }
    await sql`insert into records (id, object_id) values (${deal.ohne}, ${obj.deals}), (${deal.mit}, ${obj.deals}), (${deal.entr}, ${obj.deals}), (${deal.fremd}, ${obj.fremdDeals})`;
    // Entrümpelungs-Anfrage aus dem Portal-Import.
    await sql`insert into record_values (id, record_id, attribute_id, json_value) values
      (${randomUUID()}, ${deal.entr}, ${attr[`${obj.deals}.moving_lead_payload`]}, ${sql.json({ leadType: "entruempelung" })})`;
    // Angebot mit dem Spalten-Default „move“ (nicht bestätigt).
    await sql`insert into quotations (id, deal_record_id, is_variable) values (${randomUUID()}, ${deal.mit}, false)`;
    dienst = await import("./deal-leistung");
  });

  afterAll(async () => {
    await sql`delete from quotations where deal_record_id in (${deal.ohne}, ${deal.mit}, ${deal.entr}, ${deal.fremd})`;
    await sql`delete from activity_events where workspace_id in (${ws}, ${fremd})`;
    await sql`delete from record_values where record_id in (${deal.ohne}, ${deal.mit}, ${deal.entr}, ${deal.fremd})`;
    await sql`delete from records where object_id in (${obj.deals}, ${obj.fremdDeals})`;
    await sql`delete from attributes where object_id in (${obj.deals}, ${obj.fremdDeals})`;
    await sql`delete from objects where id in (${obj.deals}, ${obj.fremdDeals})`;
    await sql`delete from workspaces where id in (${ws}, ${fremd})`;
    await sql.end();
  });

  it("ohne Angebot: Umzug als Vorschlag, nach der Wahl Küche im Deal-Feld, kein Angebot angelegt", async () => {
    expect((await dienst.leistungDesDeals(ws, deal.ohne)).leistung).toBe("move");
    const r = await dienst.setzeLeistung(ws, deal.ohne, "kitchen_installation", null);
    expect(r).toMatchObject({ leistung: "kitchen_installation", hatAngebot: false, akte: "kitchen_installation" });
    expect(await sql`select 1 from quotations where deal_record_id = ${deal.ohne}`).toHaveLength(0);
  });

  it("die Wahl in der Akte schlägt die Entrümpelungs-Anfrage", async () => {
    expect((await dienst.leistungDesDeals(ws, deal.entr)).leistung).toBe("clearance");
    expect((await dienst.setzeLeistung(ws, deal.entr, "move", null)).leistung).toBe("move");
  });

  it("mit Angebot: Leistung des Angebots bestätigt mitgeändert", async () => {
    const r = await dienst.setzeLeistung(ws, deal.mit, "clearance_move", null);
    expect(r.leistung).toBe("clearance_move");
    const [q] = await sql`select service_type, document_details from quotations where deal_record_id = ${deal.mit}`;
    expect(q.service_type).toBe("move");
    expect(q.document_details).toMatchObject({ mitEntruempelung: true, leistungBestaetigt: true });
  });

  it("nach der Annahme: abgelehnt, Angebot und Deal-Feld bleiben", async () => {
    annahme.aktiv = true;
    try {
      await expect(dienst.setzeLeistung(ws, deal.mit, "kitchen_installation", null)).rejects.toMatchObject({ code: "KVA_ACCEPTED" });
    } finally {
      annahme.aktiv = false;
    }
    expect((await dienst.leistungDesDeals(ws, deal.mit)).leistung).toBe("clearance_move");
    const [q] = await sql`select service_type from quotations where deal_record_id = ${deal.mit}`;
    expect(q.service_type).toBe("move");
  });

  it("unbekannte Leistung und fremder Deal werden abgelehnt", async () => {
    await expect(dienst.setzeLeistung(ws, deal.ohne, "transport", null)).rejects.toMatchObject({ code: "UNGUELTIG" });
    await expect(dienst.setzeLeistung(ws, deal.fremd, "move", null)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await sql`select 1 from record_values where record_id = ${deal.fremd}`).toHaveLength(0);
  });
});
