import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Plan 14, Task Z: `setQuotationDetails` gegen eine echte Postgres-DB.
 * - Preis, Posten und `calculation_version_id` bleiben unverändert (Stand vorher und nachher).
 * - Ohne Quotation 404, fremder Workspace 404, nach der Annahme nur `notes` (sonst 409).
 * - `angebotSperren` ist die erste Anweisung der Transaktion (SQL-Mitschnitt).
 *
 * Läuft nur mit ANNAHME_TEST_DATABASE_URL (Wegwerf-DB mit aktuellem Schema,
 * z. B. postgres://postgres@127.0.0.1:54351/p14_annahme). Nie gegen eine echte DB.
 */
const url = process.env.ANNAHME_TEST_DATABASE_URL;

const mitschnitt = vi.hoisted(() => ({ zeilen: [] as { conn: number; sql: string }[] }));

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.ANNAHME_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", {
    max: 3,
    debug: (conn: number, sql: string) => {
      mitschnitt.zeilen.push({ conn, sql });
    },
  });
  return { db: drizzle(client, { schema }) };
});

describe.skipIf(!url)("setQuotationDetails (DB, Plan 14)", { timeout: 30_000 }, () => {
  let sql: postgres.Sql;
  let setQuotationDetails: typeof import("./quotation-details").setQuotationDetails;
  const ws = randomUUID();
  const fremdWs = randomUUID();
  const objDeals = randomUUID();
  const objFremd = randomUUID();
  const deal = randomUUID();
  const fremdDeal = randomUUID();
  const link = randomUUID();
  let q1 = "";
  let v1 = "";

  /** Alles, was den Preis ausmacht: Kopf und Posten. */
  async function preisStand(dealId = deal) {
    const [q] = await sql`select fixed_price, is_variable, calculation_version_id, selected_package_slug, deposit_required_cents
      from quotations where deal_record_id = ${dealId}`;
    const posten = await sql`select type, description, quantity, unit_rate, sort_order from quotation_line_items li
      join quotations q on q.id = li.quotation_id where q.deal_record_id = ${dealId} order by sort_order`;
    return { q, posten: [...posten] };
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    sql = postgres(url!, { max: 2 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Test', ${`t-${ws}`}), (${fremdWs}, 'Fremd', ${`t-${fremdWs}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name)
      values (${objDeals}, ${ws}, 'deals', 'Deal', 'Deals'), (${objFremd}, ${fremdWs}, 'deals', 'Deal', 'Deals')`;
    await sql`insert into records (id, object_id) values (${deal}, ${objDeals}), (${fremdDeal}, ${objFremd})`;
    await sql`insert into customer_status_links (id, workspace_id, deal_record_id, token) values (${link}, ${ws}, ${deal}, ${randomUUID().replace(/-/g, "")})`;
    ({ setQuotationDetails } = await import("./quotation-details"));
  });

  beforeEach(async () => {
    for (const t of ["kva_confirmations", "quotations", "deal_calculation_versions"]) {
      await sql.unsafe(`delete from ${t} where deal_record_id = any($1)`, [[deal, fremdDeal]]);
    }
    v1 = randomUUID();
    q1 = randomUUID();
    await sql`insert into deal_calculation_versions (id, workspace_id, deal_record_id, version, status, reference_date, price_cents, kv_items)
      values (${v1}, ${ws}, ${deal}, 1, 'gesperrt', '2026-11-07', 189000, ${sql.json([{ description: "Umzug", quantity: 1, unitRate: 1890 }])})`;
    await sql`insert into quotations (id, deal_record_id, fixed_price, is_variable, notes, summary, valid_until, payment_method_preference,
        show_standard_inclusions, service_type, calculation_version_id, selected_package_slug, deposit_required_cents, document_details)
      values (${q1}, ${deal}, '1890.00', false, 'alt', 'alte Zusammenfassung', '2026-11-30', 'cash', true, 'move', ${v1}, 'komfort', 30000,
        ${sql.json({ leistungen: ["Tragen"] })})`;
    await sql`insert into quotation_line_items (id, quotation_id, type, description, quantity, unit_rate, sort_order)
      values (${randomUUID()}, ${q1}, 'other', 'Umzug', 1, '1500.00', 0), (${randomUUID()}, ${q1}, 'other', 'Halteverbot', 1, '390.00', 1)`;
    mitschnitt.zeilen.length = 0;
  });

  afterAll(async () => {
    for (const t of ["kva_confirmations", "customer_status_links", "quotations", "deal_calculation_versions"]) {
      await sql.unsafe(`delete from ${t} where deal_record_id = any($1)`, [[deal, fremdDeal]]);
    }
    await sql`delete from records where id in (${deal}, ${fremdDeal})`;
    await sql`delete from objects where id in (${objDeals}, ${objFremd})`;
    await sql`delete from workspaces where id in (${ws}, ${fremdWs})`;
    await sql.end();
  });

  it("schreibt nur die Detailfelder; Preis, Posten und Version bleiben", async () => {
    const vorher = await preisStand();
    const r = await setQuotationDetails(ws, deal, {
      validUntil: "2026-12-15",
      notes: "neu intern",
      summary: "3 Zimmer, 2. OG",
      paymentMethodPreference: "bank_transfer",
      showStandardInclusions: false,
      serviceType: "clearance_move",
    });
    expect(r.ok).toBe(true);
    expect(await preisStand()).toEqual(vorher);
    const [q] = await sql`select notes, summary, valid_until::text as valid_until, payment_method_preference, show_standard_inclusions,
      service_type, document_details, calculation_version_id from quotations where id = ${q1}`;
    expect(q).toEqual({
      notes: "neu intern",
      summary: "3 Zimmer, 2. OG",
      valid_until: "2026-12-15",
      payment_method_preference: "bank_transfer",
      show_standard_inclusions: false,
      service_type: "move",
      document_details: { leistungen: ["Tragen"], mitEntruempelung: true, leistungBestaetigt: true },
      calculation_version_id: v1,
    });
    if (r.ok) {
      expect(r.quotation.calculationVersionId).toBe(v1);
      expect(r.quotation.lineItems).toHaveLength(2);
    }
  });

  it("lässt nicht genannte Felder stehen und setzt null", async () => {
    const r = await setQuotationDetails(ws, deal, { summary: null });
    expect(r.ok).toBe(true);
    const [q] = await sql`select notes, summary, valid_until::text as valid_until, service_type, document_details from quotations where id = ${q1}`;
    expect(q).toEqual({ notes: "alt", summary: null, valid_until: "2026-11-30", service_type: "move", document_details: { leistungen: ["Tragen"] } });
  });

  it("nimmt angebotSperren als erste Anweisung der Transaktion", async () => {
    await setQuotationDetails(ws, deal, { notes: "x" });
    const begin = mitschnitt.zeilen.findIndex((z) => /^begin/i.test(z.sql.trim()));
    expect(begin).toBeGreaterThanOrEqual(0);
    const conn = mitschnitt.zeilen[begin].conn;
    const danach = mitschnitt.zeilen.slice(begin + 1).filter((z) => z.conn === conn);
    expect(danach[0].sql).toContain("pg_advisory_xact_lock");
    expect(danach[0].sql).toContain("'angebot:'");
    // Alles danach über dieselbe Verbindung (tx), keine zweite aus dem Pool.
    const andere = mitschnitt.zeilen.slice(begin + 1).filter((z) => z.conn !== conn);
    expect(andere).toEqual([]);
  });

  it("antwortet 404 ohne Quotation", async () => {
    await sql`delete from quotations where id = ${q1}`;
    expect(await setQuotationDetails(ws, deal, { notes: "x" })).toEqual({ ok: false, status: 404, code: "QUOTATION_NOT_FOUND" });
  });

  it("antwortet 404 für einen Deal aus fremdem Workspace und schreibt nichts", async () => {
    expect(await setQuotationDetails(fremdWs, deal, { notes: "fremd" })).toEqual({ ok: false, status: 404, code: "NOT_FOUND" });
    const [q] = await sql`select notes from quotations where id = ${q1}`;
    expect(q.notes).toBe("alt");
  });

  describe("nach der Annahme", () => {
    beforeEach(async () => {
      await sql`insert into kva_confirmations (id, workspace_id, deal_record_id, customer_link_id, quotation_snapshot, confirmed_total_cents, agb_version_accepted, ip_address, user_agent)
        values (${randomUUID()}, ${ws}, ${deal}, ${link}, ${sql.json({})}, 189000, 'test', '203.0.113.5', 'test')`;
    });

    it("erlaubt notes", async () => {
      const r = await setQuotationDetails(ws, deal, { notes: "nach Annahme" });
      expect(r.ok).toBe(true);
      const [q] = await sql`select notes from quotations where id = ${q1}`;
      expect(q.notes).toBe("nach Annahme");
    });

    it.each([{ summary: "x" }, { validUntil: "2026-12-31" }, { serviceType: "clearance" as const }, { notes: "x", showStandardInclusions: false }])(
      "verweigert %j mit 409 und schreibt nichts",
      async (patch) => {
        expect(await setQuotationDetails(ws, deal, patch)).toEqual({ ok: false, status: 409, code: "KVA_ACCEPTED" });
        const [q] = await sql`select notes, summary, valid_until::text as valid_until, service_type, show_standard_inclusions from quotations where id = ${q1}`;
        expect(q).toEqual({ notes: "alt", summary: "alte Zusammenfassung", valid_until: "2026-11-30", service_type: "move", show_standard_inclusions: true });
      }
    );

    it("erlaubt nach „Annahme aufheben“ wieder alles", async () => {
      await sql`update kva_confirmations set superseded_at = now() where deal_record_id = ${deal}`;
      expect((await setQuotationDetails(ws, deal, { summary: "wieder offen" })).ok).toBe(true);
    });
  });
});
