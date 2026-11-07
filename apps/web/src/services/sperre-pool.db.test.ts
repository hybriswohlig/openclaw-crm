import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Review 5a, Fund 1: Wer `angebotSperren` hält, darf in derselben Transaktion
 * nichts über die globale `db` lesen oder schreiben. Sonst wartet der
 * Sperrhalter auf eine Pool-Verbindung, die wartende Transaktionen belegen.
 *
 * Beweis: `@/db` hat hier genau EINE Verbindung (postgres-js `max: 1`). Die
 * Transaktion belegt sie; jeder Aufruf über `db` darin hängt, und der Test
 * scheitert am Zeitlimit. Läuft nur mit ANNAHME_TEST_DATABASE_URL (Wegwerf-DB).
 */
const url = process.env.ANNAHME_TEST_DATABASE_URL;

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.ANNAHME_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 1 });
  return { db: drizzle(client, { schema }) };
});
vi.mock("./agb", () => ({ ladeAgbHtml: async () => `<h1>AGB</h1>${"Text der AGB. ".repeat(60)}` }));
vi.mock("./activity-events", () => ({ emitEvent: async () => {} }));
vi.mock("./wartet", () => ({ aktualisiereWartet: async () => {}, aktualisiereWartetNachBesuch: async () => {} }));
const auth = vi.hoisted(() => ({ workspaceId: "" }));
vi.mock("@/lib/api-utils", async (orig) => ({
  ...(await orig<typeof import("@/lib/api-utils")>()),
  getAuthContext: async () => ({ userId: "u1", workspaceId: auth.workspaceId, workspaceRole: "admin", authMethod: "cookie" }),
}));

describe.skipIf(!url)("Unter der Angebots-Sperre nur über tx (Pool mit einer Verbindung)", { timeout: 8_000 }, () => {
  let sql: postgres.Sql;
  let portal: typeof import("./customer-portal-data");
  const ws = randomUUID();
  const obj = randomUUID();
  const attrMove = randomUUID();
  const deal = randomUUID();
  const link = randomUUID();
  const token = randomUUID().replace(/-/g, "");
  const ctx = { ipAddress: "203.0.113.5", userAgent: "test" };
  let v1 = "";

  beforeAll(async () => {
    sql = postgres(url!, { max: 1 });
    auth.workspaceId = ws;
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Test', ${`t-${ws}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${obj}, ${ws}, 'deals', 'Deal', 'Deals')`;
    await sql`insert into attributes (id, object_id, slug, title, type) values (${attrMove}, ${obj}, 'move_date', 'Umzugstermin', 'date')`;
    await sql`insert into records (id, object_id) values (${deal}, ${obj})`;
    await sql`insert into customer_status_links (id, workspace_id, deal_record_id, token) values (${link}, ${ws}, ${deal}, ${token})`;
    portal = await import("./customer-portal-data");
  });

  beforeEach(async () => {
    for (const t of ["kva_confirmations", "deal_documents", "customer_date_selections", "quotation_date_offers", "quotation_package_options", "quotations", "deal_calculation_versions"]) {
      await sql.unsafe(`delete from ${t} where deal_record_id = $1`, [deal]);
    }
    await sql`delete from record_values where record_id = ${deal}`;
    v1 = randomUUID();
    await sql`insert into deal_calculation_versions (id, workspace_id, deal_record_id, version, status, reference_date, price_cents)
      values (${v1}, ${ws}, ${deal}, 1, 'entwurf', '2026-12-01', null)`;
    await sql`insert into quotations (id, deal_record_id, fixed_price, is_variable, service_type)
      values (${randomUUID()}, ${deal}, '1000.00', false, 'kitchen_installation')`;
  });

  afterAll(async () => {
    await sql`delete from workspaces where id = ${ws}`;
    await sql.end();
  });

  const option = (name: string, cent: number, empfohlen = false) => ({
    catalogueSlug: null, displayName: name, shortDescription: null, priceCents: cent, includedItems: [], note: null, isRecommended: empfohlen,
  });

  it("confirmKvaForToken (Firmenattribute, Leistung, PDF, Insert unter der Sperre)", async () => {
    const r = await portal.confirmKvaForToken(
      token,
      { acceptedOffer: true, acceptedAgb: true, haftungshinweisBestaetigt: false, versicherungGewuenscht: false, vorzeitigerBeginnVerlangt: false, expectedTotalCents: 100000, fullName: null },
      ctx
    );
    expect(r.ok).toBe(true);
    expect((await sql`select count(*)::int as n from kva_confirmations where deal_record_id = ${deal}`)[0].n).toBe(1);
  });

  it("Annahme mit Paketoptionen: ensureDefaultPackageSelection schreibt in der Annahme-Transaktion", async () => {
    await sql`insert into quotation_package_options (id, workspace_id, deal_record_id, display_name, price_cents, is_recommended)
      values (${randomUUID()}, ${ws}, ${deal}, 'Komfort', 120000, true)`;
    const r = await portal.confirmKvaForToken(
      token,
      { acceptedOffer: true, acceptedAgb: true, haftungshinweisBestaetigt: false, versicherungGewuenscht: false, vorzeitigerBeginnVerlangt: false, expectedTotalCents: 120000, fullName: null },
      ctx
    );
    expect(r.ok).toBe(true);
  });

  it("replaceDealPackageOptions und selectDealPackageOptionForToken", async () => {
    expect(await portal.replaceDealPackageOptions({ workspaceId: ws, dealRecordId: deal, createdBy: null, options: [option("Basis", 90000), option("Komfort", 120000, true)] })).toEqual({ count: 2 });
    const [o] = await sql`select id from quotation_package_options where deal_record_id = ${deal} and display_name = 'Basis'`;
    expect(await portal.selectDealPackageOptionForToken(token, { optionId: o.id }, ctx)).toEqual({ ok: true });
    expect((await sql`select fixed_price from quotations where deal_record_id = ${deal}`)[0].fixed_price).toBe("900.00");
  });

  it("ensureDefaultPackageSelection ohne Aufrufer-Transaktion", async () => {
    await sql`insert into quotation_package_options (id, workspace_id, deal_record_id, display_name, price_cents, is_recommended)
      values (${randomUUID()}, ${ws}, ${deal}, 'Premium', 150000, true)`;
    await portal.ensureDefaultPackageSelection(deal);
    expect((await sql`select fixed_price from quotations where deal_record_id = ${deal}`)[0].fixed_price).toBe("1500.00");
  });

  it("replaceDateOffers und selectDateOffer (Termin am Deal über tx)", async () => {
    expect(
      await portal.replaceDateOffers({ workspaceId: ws, dealRecordId: deal, createdBy: null, offers: [{ date: "2026-12-02", slots: [{ label: "Vormittag", startTime: "08:00", endTime: "12:00" }], note: null, isRecommended: true }] })
    ).toEqual({ count: 1 });
    const [d] = await sql`select id from quotation_date_offers where deal_record_id = ${deal}`;
    expect(await portal.selectDateOffer(token, { dateOfferId: d.id, slotIndex: 0 }, ctx)).toEqual({ ok: true });
    const [mv] = await sql`select date_value::text as d from record_values where record_id = ${deal} and attribute_id = ${attrMove}`;
    expect(mv.d).toBe("2026-12-02");
  });

  it("sperrenUndAngebot", async () => {
    const { dbVersionsSpeicher } = await import("./kalkulation-versionen-speicher");
    await dbVersionsSpeicher.sperrenUndAngebot(
      ws,
      deal,
      v1,
      { lineItems: [{ description: "Küchenmontage", quantity: 1, unitRate: "1500" }], validUntil: null, calculationAssumptions: null, documentDetails: null, notes: null } as never,
      [{ type: "other", description: "Küchenmontage", quantity: 1, unitRate: 1500 }] as never,
      "u1"
    );
    expect((await sql`select calculation_version_id from quotations where deal_record_id = ${deal}`)[0].calculation_version_id).toBe(v1);
  });

  it("upsertQuotation", async () => {
    const { upsertQuotation } = await import("./quotations");
    await upsertQuotation(deal, { isVariable: false, fixedPrice: "1100.00", lineItems: [] } as never);
    expect((await sql`select fixed_price from quotations where deal_record_id = ${deal}`)[0].fixed_price).toBe("1100.00");
  });

  it("PATCH quotation/anzahlung", async () => {
    const { PATCH } = await import("@/app/api/v1/deals/[recordId]/quotation/anzahlung/route");
    const req = new NextRequest(`http://localhost/api/v1/deals/${deal}/quotation/anzahlung`, {
      method: "PATCH",
      body: JSON.stringify({ depositRequiredCents: 20000, paymentMethodPreference: "cash" }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ recordId: deal }) });
    expect(res.status).toBe(200);
    expect((await sql`select deposit_required_cents from quotations where deal_record_id = ${deal}`)[0].deposit_required_cents).toBe(20000);
  });
});
