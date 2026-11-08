import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Fix-Welle Plan 9 gegen eine echte Postgres-DB:
 * - I1: Das Portal rechnet den offenen Rest über `offenAus`: gestellte Rechnung
 *   mit Mehraufwand (Grund) vor der Annahme; Stunden-KV mit Rechnungsbetrag
 *   zeigt Rest und Bankdaten.
 * - Die interne Notiz des Angebots (`quotations.notes`) steht nie im Kontext-JSON.
 * Läuft nur mit GELD_TEST_DATABASE_URL (Wegwerf-DB). Nie gegen eine echte DB.
 */
const url = process.env.GELD_TEST_DATABASE_URL;

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.GELD_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 3 });
  return { db: drizzle(client, { schema }), __client: client };
});
vi.mock("./agb", () => ({ ladeAgbHtml: async () => `<h1>AGB</h1>${"Text der AGB. ".repeat(60)}` }));
vi.mock("./activity-events", () => ({ emitEvent: async () => {} }));
vi.mock("./wartet", () => ({ aktualisiereWartet: async () => {}, aktualisiereWartetNachBesuch: async () => {} }));

const NOTIZ = "INTERN-NOTIZ-Kunde-zahlt-schlecht-4711";

describe.skipIf(!url)("Portal: offener Rest aus offenAus, keine interne Notiz (DB, Fix-Welle Plan 9)", { timeout: 30_000 }, () => {
  let sql: postgres.Sql;
  let portal: typeof import("./customer-portal-data");
  const ws = randomUUID();
  const obj = randomUUID();
  const objFirmen = randomUUID();
  const attrFirma = randomUUID();
  const firma = randomUUID();

  async function deal(e: { stunden: boolean; annahmeCent: number | null; rechnungCent: number; gezahlt: string | null }) {
    const id = randomUUID();
    const token = randomUUID().replace(/-/g, "");
    const link = randomUUID();
    await sql`insert into records (id, object_id) values (${id}, ${obj})`;
    await sql`insert into record_values (id, record_id, attribute_id, referenced_record_id) values (${randomUUID()}, ${id}, ${attrFirma}, ${firma})`;
    await sql`insert into customer_status_links (id, workspace_id, deal_record_id, token) values (${link}, ${ws}, ${id}, ${token})`;
    const q = randomUUID();
    await sql`insert into quotations (id, deal_record_id, fixed_price, is_variable, service_type, notes, payment_method_preference)
      values (${q}, ${id}, ${e.stunden ? null : "1200.00"}, ${e.stunden}, 'move', ${NOTIZ}, 'bank_transfer')`;
    await sql`insert into quotation_line_items (id, quotation_id, type, description, quantity, unit_rate, sort_order)
      values (${randomUUID()}, ${q}, ${e.stunden ? "helper" : "other"}, 'Umzug', 1, ${e.stunden ? "45.00" : "1200.00"}, 0)`;
    if (e.annahmeCent != null) {
      await sql`insert into kva_confirmations (id, workspace_id, deal_record_id, customer_link_id, quotation_snapshot, confirmed_total_cents, agb_version_accepted, ip_address, user_agent)
        values (${randomUUID()}, ${ws}, ${id}, ${link}, ${sql.json({})}, ${e.annahmeCent}, 'v1', '203.0.113.1', 'test')`;
    }
    const doc = randomUUID();
    await sql`insert into deal_documents (id, workspace_id, deal_record_id, document_type, file_name, file_size, mime_type, file_content)
      values (${doc}, ${ws}, ${id}, 'invoice', 'RE.pdf', 1, 'application/pdf', 'eA==')`;
    await sql`insert into deal_invoices (id, workspace_id, deal_record_id, operating_company_id, herkunft, status, brutto_cent, rechnungstag, faellig_am, deal_document_id, abweichung_grund)
      values (${randomUUID()}, ${ws}, ${id}, ${firma}, 'crm', 'gestellt', ${e.rechnungCent}, '2026-11-07', '2026-11-07', ${doc}, ${e.annahmeCent != null && e.annahmeCent !== e.rechnungCent ? "Mehr Möbel vor Ort" : null})`;
    if (e.gezahlt) {
      await sql`insert into payments (id, workspace_id, deal_record_id, date, amount, tax_treatment)
        values (${randomUUID()}, ${ws}, ${id}, '2026-11-01', ${e.gezahlt}, 'betriebseinnahme')`;
    }
    return { id, token };
  }

  beforeAll(async () => {
    sql = postgres(url!, { max: 2 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Test', ${`t-${ws}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${obj}, ${ws}, 'deals', 'Deal', 'Deals'), (${objFirmen}, ${ws}, 'operating_companies', 'Firma', 'Firmen')`;
    await sql`insert into attributes (id, object_id, slug, title, type) values (${attrFirma}, ${obj}, 'operating_company', 'Firma', 'record_reference')`;
    await sql`insert into records (id, object_id) values (${firma}, ${objFirmen})`;
    await sql`insert into operating_company_portal_settings (operating_company_record_id, workspace_id, enabled, payments_enabled) values (${firma}, ${ws}, true, true)`;
    portal = await import("./customer-portal-data");
  });

  afterAll(async () => {
    await sql`delete from workspaces where id = ${ws}`;
    await sql.end();
    await ((await import("@/db")) as unknown as { __client: postgres.Sql }).__client.end();
  });

  it("Mehraufwand mit Grund: das Portal nennt den Rechnungsbetrag minus Zahlungen, nicht die Annahme", async () => {
    const d = await deal({ stunden: false, annahmeCent: 120000, rechnungCent: 138000, gezahlt: "300.00" });
    const c = (await portal.loadContextByToken(d.token))!;
    expect(c.stage).toBe(4);
    expect(c.payment?.amountCents).toBe(108000);
    expect(c.paymentStatus).toMatchObject({ receivedCents: 30000, remainingCents: 108000, paid: false });
  });

  it("Stunden-KV mit Rechnungsbetrag: Rest und Bankdaten sichtbar", async () => {
    const d = await deal({ stunden: true, annahmeCent: null, rechnungCent: 96000, gezahlt: null });
    const c = (await portal.loadContextByToken(d.token))!;
    expect(c.payment?.amountCents).toBe(96000);
    expect(c.paymentStatus?.remainingCents).toBe(96000);
  });

  it("die interne Notiz des Angebots steht nicht im Kontext-JSON", async () => {
    const d = await deal({ stunden: false, annahmeCent: 120000, rechnungCent: 120000, gezahlt: "1200.00" });
    const c = (await portal.loadContextByToken(d.token))!;
    expect(JSON.stringify(c)).not.toContain(NOTIZ);
    expect(c.paymentStatus).toMatchObject({ remainingCents: 0, paid: true });
  });
});
