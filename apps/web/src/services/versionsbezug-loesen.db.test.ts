import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { angezeigterPreis } from "@openclaw-crm/customer-portal-core";
import type { KvPosten } from "@/services/rechner/kv-posten";
import type { PaketpreisVersion, Tagespreis } from "@/lib/angebot-wahl";

/**
 * Fix-Runde N zu Plan 5b gegen eine echte Postgres-DB:
 * - N1: Ohne Firmen-Schalter löst der alte Termin-Weg (PUT und DELETE date-offers)
 *   Termine aus einer Version und im selben `tx` unter `angebotSperren` auch
 *   Quotation und Paketoptionen. Danach nennen Quotation, Portal-Kontext,
 *   Annahme und KV-Modell (`loadCommercialModel`) denselben Preis, und das
 *   KV-PDF zeigt keine alten Tage (Szenario aus `review-tmp/rr-i6.ts`).
 * - M2: Paketoptionen von Hand lösen den Bezug auch ohne Schalter, wenn die
 *   Version der Quotation Paketpreise trägt.
 * - N4: `kvAusVersion` liest Angebot und Wahl in einem REPEATABLE-READ-Stand.
 *
 * Läuft nur mit ANNAHME_TEST_DATABASE_URL (Wegwerf-DB mit Schema bis 0061,
 * z. B. postgres://postgres@127.0.0.1:54351/n_annahme). Nie gegen eine echte DB.
 */
const url = process.env.ANNAHME_TEST_DATABASE_URL;

/** Mitschnitt aller Anweisungen über `@/db`: Verbindung und SQL. */
const mitschnitt = vi.hoisted(() => ({ zeilen: [] as { conn: number; sql: string }[], deal: "" }));

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
vi.mock("./agb", () => ({ ladeAgbHtml: async () => `<h1>AGB</h1>${"Text der AGB. ".repeat(60)}` }));
vi.mock("./activity-events", () => ({ emitEvent: async () => {} }));
vi.mock("./wartet", () => ({ aktualisiereWartet: async () => {}, aktualisiereWartetNachBesuch: async () => {} }));
// Nur für den Kopf des KV-Modells (Firma, Kunde); Preise liest `loadCommercialModel` aus der DB.
vi.mock("@/services/records", () => ({
  getRecord: async (_objekt: string, id: string) =>
    id === mitschnitt.deal
      ? { values: { name: "Umzug Muster", operating_company: { id: "oc_ceylan", displayName: "Ceylan Umzüge" } } }
      : { values: {} },
}));
vi.mock("@/services/doc-customer-name", () => ({
  resolveDocCustomerName: async () => ({ vorname: "Anna", nachname: "Muster", fullName: "Anna Muster", source: "person" }),
}));
vi.mock("@/services/customer-portal-emails", () => ({ loadCustomerEmail: async () => null }));
vi.mock("@/services/agent/agent-suppress", () => ({
  ladeGespeicherteAnrede: async () => ({}),
  anredeFuerOptOut: () => "sie",
}));

const slots = [{ label: "Vormittag", startTime: "08:00", endTime: "12:00" }];
const posten = (...betraege: [string, number][]): KvPosten[] => betraege.map(([description, unitRate]) => ({ description, quantity: 1, unitRate }));
const paket = (slug: string, festpreis: number, p: KvPosten[]): PaketpreisVersion => ({ slug, festpreis, selbstkosten: festpreis * 0.6, margeProzent: 40, rundungEur: 10, kvItems: p });
const tag = (datum: string, festpreis: number, paketpreise: PaketpreisVersion[], empfohlen = false): Tagespreis => ({
  datum,
  wochentag: "di",
  feiertag: false,
  festpreis,
  rechnerFestpreis: festpreis,
  selbstkosten: festpreis * 0.6,
  margeProzent: 40,
  gruende: [{ text: "INTERN-GRUND", punkte: 5 }],
  uebersteuert: null,
  paketpreise,
  kvItems: posten(["Umzug", festpreis]),
  slots,
  note: null,
  empfohlen,
  vehicleBookingId: null,
});

/**
 * Wie im Review (rr-i6.ts): Komfort am Basistag 1.890 €, am empfohlenen Di 23.03. 1.640 €.
 * Sa 20.03. kostet wie der Basistag.
 */
const version = {
  priceCents: 150000,
  kvItems: posten(["Umzug", 1500]),
  packagePrices: [paket("basis", 1200, posten(["Umzug", 1200])), paket("komfort", 1890, posten(["Umzug", 1500], ["Halteverbot", 390]))],
  dayPrices: [
    tag("2027-03-20", 1500, [paket("basis", 1200, posten(["Umzug", 1200])), paket("komfort", 1890, posten(["Umzug", 1500], ["Halteverbot", 390]))]),
    tag("2027-03-23", 1300, [paket("basis", 1050, posten(["Umzug", 1050])), paket("komfort", 1640, posten(["Umzug", 1300], ["Halteverbot", 340]))], true),
  ],
};

describe.skipIf(!url)("Versionsbezug lösen ohne Firmen-Schalter (DB, F2 N1/M2/N4)", { timeout: 30_000 }, () => {
  let sql: postgres.Sql;
  let portal: typeof import("./customer-portal-data");
  let dokumente: typeof import("./commercial-documents");
  const ws = randomUUID();
  const objDeals = randomUUID();
  const objFirmen = randomUUID();
  const attrMove = randomUUID();
  const attrFirma = randomUUID();
  const deal = randomUUID();
  const firma = randomUUID();
  const token = randomUUID().replace(/-/g, "");
  const ctx = { ipAddress: "203.0.113.5", userAgent: "test" };
  mitschnitt.deal = deal;
  let v1 = "";
  let q1 = "";
  let basis = "";
  let komfort = "";

  const schalter = (angebot: boolean, tage: boolean) =>
    sql`insert into operating_company_portal_settings (operating_company_record_id, workspace_id, angebot_aus_kalkulation, tagespreise_enabled)
      values (${firma}, ${ws}, ${angebot}, ${tage})
      on conflict (operating_company_record_id) do update set angebot_aus_kalkulation = ${angebot}, tagespreise_enabled = ${tage}`;

  /** Stand nach dem Sperren mit Paketen und Tagen (Schalter waren an): Komfort am empfohlenen Tag. */
  async function gesperrtMitPaketenUndTagen(v = version) {
    v1 = randomUUID();
    await sql`insert into deal_calculation_versions (id, workspace_id, deal_record_id, version, status, reference_date, price_cents, kv_items, package_prices, day_prices)
      values (${v1}, ${ws}, ${deal}, 1, 'gesperrt', '2026-11-07', ${v.priceCents}, ${sql.json(v.kvItems as never)}, ${sql.json(v.packagePrices as never)}, ${sql.json(v.dayPrices as never)})`;
    basis = randomUUID();
    komfort = randomUUID();
    // Optionen tragen den Paketpreis am Basistag (plan5Schreiben).
    await sql`insert into quotation_package_options (id, workspace_id, deal_record_id, catalogue_slug, display_name, price_cents, is_recommended, sort_order, calculation_version_id)
      values (${basis}, ${ws}, ${deal}, 'basis', 'Basis', 120000, false, 0, ${v1}), (${komfort}, ${ws}, ${deal}, 'komfort', 'Komfort', 189000, true, 1, ${v1})`;
    // Quotation: Komfort am Standardtag (Di 23.03.), Posten dieser Wahl.
    await sql`update quotations set fixed_price = '1640.00', is_variable = false, calculation_version_id = ${v1},
      selected_package_option_id = ${komfort}, selected_package_slug = 'komfort' where id = ${q1}`;
    await sql`delete from quotation_line_items where quotation_id = ${q1}`;
    await sql`insert into quotation_line_items (id, quotation_id, type, description, quantity, unit_rate, sort_order)
      values (${randomUUID()}, ${q1}, 'other', 'Umzug', 1, '1300.00', 0), (${randomUUID()}, ${q1}, 'other', 'Halteverbot', 1, '340.00', 1)`;
    // Terminangebote aus der Version (wie das Sperren, über terminangeboteSchreiben).
    const { db } = await import("@/db");
    const { angebotSperren } = await import("./quotations");
    await db.transaction(async (tx) => {
      await angebotSperren(tx, deal);
      await portal.terminangeboteSchreiben(tx, {
        workspaceId: ws,
        dealRecordId: deal,
        createdBy: null,
        calculationVersionId: v1,
        offers: v.dayPrices.map((d) => {
          const paketPreise = Object.fromEntries((d.paketpreise ?? []).map((p) => [p.slug, Math.round((p.festpreis ?? 0) * 100)]));
          return { date: d.datum, slots: d.slots, note: d.note, isRecommended: d.empfohlen, priceCents: paketPreise.komfort, packagePrices: paketPreise };
        }),
      });
    });
    // KV-PDF genau dieser Version (sonst wäre die Annahme vor dem Lösen gesperrt).
    await sql`insert into deal_documents (id, workspace_id, deal_record_id, document_type, file_name, file_size, mime_type, file_content, calculation_version_id)
      values (${randomUUID()}, ${ws}, ${deal}, 'quotation', 'KV.pdf', 10, 'application/pdf', ${Buffer.from("%PDF v1").toString("base64")}, ${v1})`;
  }

  const quotation = async () =>
    (await sql`select fixed_price, calculation_version_id, selected_package_option_id, selected_package_slug from quotations where id = ${q1}`)[0];
  const optionen = async () =>
    sql`select catalogue_slug, price_cents, calculation_version_id from quotation_package_options where deal_record_id = ${deal} order by sort_order`;
  const angebote = async () =>
    sql`select offer_date::text as datum, price_cents, package_prices, calculation_version_id from quotation_date_offers where deal_record_id = ${deal} order by sort_order`;
  const termineVonHand = (...daten: string[]) =>
    portal.replaceDateOffers({
      workspaceId: ws,
      dealRecordId: deal,
      createdBy: null,
      offers: daten.map((date) => ({ date, slots, note: null, isRecommended: false })),
    });
  const waehleTag = async (datum: string) => {
    const [o] = await sql`select id from quotation_date_offers where deal_record_id = ${deal} and offer_date = ${datum}`;
    return portal.selectDateOffer(token, { dateOfferId: o.id, slotIndex: 0 }, ctx);
  };
  const annehmen = (expectedTotalCents: number) =>
    portal.confirmKvaForToken(
      token,
      { acceptedOffer: true, acceptedAgb: true, haftungshinweisBestaetigt: false, versicherungGewuenscht: false, vorzeitigerBeginnVerlangt: false, expectedTotalCents, fullName: "Anna Muster" },
      ctx
    );

  /** Preis aus jeder Quelle: Quotation, Portal (Preiskarte, KV), KV-Modell des CRM-PDFs. */
  async function preise() {
    const q = await quotation();
    const c = (await portal.loadContextByToken(token))!;
    const modell = await dokumente.loadCommercialModel({ workspaceId: ws, dealRecordId: deal, kind: "KV" });
    return {
      quotation: Math.round(Number(q.fixed_price) * 100),
      portal: angezeigterPreis({ kva: c.kva, dealPackageOffers: c.dealPackageOffers, dateOffers: c.dateOffers, acceptance: null }).cents,
      kva: c.kva!.totalCents,
      kvModell: modell.totalCents,
      // „Wählbare Optionen“ im KV-PDF: Zeilen je Tag der Version; null ohne Block.
      kvTage: modell.choices ? modell.choices.rows.map((r) => r.label) : null,
    };
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    sql = postgres(url!, { max: 3 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Test', ${`t-${ws}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${objDeals}, ${ws}, 'deals', 'Deal', 'Deals'), (${objFirmen}, ${ws}, 'firmen', 'Firma', 'Firmen')`;
    await sql`insert into attributes (id, object_id, slug, title, type) values (${attrMove}, ${objDeals}, 'move_date', 'Umzugstermin', 'date'), (${attrFirma}, ${objDeals}, 'operating_company', 'Firma', 'record_reference')`;
    await sql`insert into records (id, object_id) values (${deal}, ${objDeals}), (${firma}, ${objFirmen})`;
    await sql`insert into customer_status_links (id, workspace_id, deal_record_id, token) values (${randomUUID()}, ${ws}, ${deal}, ${token})`;
    await sql`insert into record_values (id, record_id, attribute_id, referenced_record_id) values (${randomUUID()}, ${deal}, ${attrFirma}, ${firma})`;
    portal = await import("./customer-portal-data");
    dokumente = await import("./commercial-documents");
  });

  beforeEach(async () => {
    for (const t of ["kva_confirmations", "deal_documents", "customer_date_selections", "quotation_date_offers", "quotation_package_options", "quotations", "deal_calculation_versions"]) {
      await sql.unsafe(`delete from ${t} where deal_record_id = $1`, [deal]);
    }
    await sql`delete from operating_company_portal_settings where operating_company_record_id = ${firma}`;
    await sql`delete from record_values where record_id = ${deal} and attribute_id = ${attrMove}`;
    q1 = randomUUID();
    // Küchenmontage: die Annahme braucht keinen Umzugstermin.
    await sql`insert into quotations (id, deal_record_id, fixed_price, is_variable, service_type) values (${q1}, ${deal}, '1000.00', false, 'kitchen_installation')`;
    mitschnitt.zeilen.length = 0;
  });

  afterAll(async () => {
    await sql`delete from operating_company_portal_settings where operating_company_record_id = ${firma}`;
    await sql`delete from workspaces where id = ${ws}`;
    await sql.end();
  });

  // ─── N1 ─────────────────────────────────────────────────────────────────

  it("Ausgang: mit Schalter stimmen Quotation, Portal und KV-Modell (1.640 € am empfohlenen Tag)", async () => {
    await schalter(true, true);
    await gesperrtMitPaketenUndTagen();
    expect(await preise()).toEqual({ quotation: 164000, portal: 164000, kva: 164000, kvModell: 164000, kvTage: ["Sa., 20.03.2027", "Di., 23.03.2027"] });
  });

  it("N1: Schalter aus, Termine von Hand (PUT): Quotation und Optionen lösen mit, alle Quellen 1.890 €, keine alten Tage, Annahme mit 1.890 €", async () => {
    await schalter(true, true);
    await gesperrtMitPaketenUndTagen();
    // Die Firma schaltet „Tagespreise“ und „Angebot aus Kalkulation“ aus.
    await schalter(false, false);

    expect(await termineVonHand("2027-03-27")).toEqual({ count: 1 });

    expect(await angebote()).toEqual([{ datum: "2027-03-27", price_cents: null, package_prices: null, calculation_version_id: null }]);
    expect((await optionen()).map((o) => [o.catalogue_slug, o.price_cents, o.calculation_version_id])).toEqual([
      ["basis", 120000, null],
      ["komfort", 189000, null],
    ]);
    // Regel von vor 5b: die Quotation trägt den Preis der gewählten Option.
    expect(await quotation()).toEqual({ fixed_price: "1890.00", calculation_version_id: null, selected_package_option_id: komfort, selected_package_slug: "komfort" });
    // Vorher (Review, rr-i6.ts): Quotation 1.640 €, Portal und Annahme 1.890 €, KV-PDF mit alten Tagen.
    expect(await preise()).toEqual({ quotation: 189000, portal: 189000, kva: 189000, kvModell: 189000, kvTage: null });

    // Spätere Paketwahl: wie vor 5b, Optionspreis.
    expect(await portal.selectDealPackageOptionForToken(token, { optionId: basis }, ctx)).toEqual({ ok: true });
    expect(await preise()).toEqual({ quotation: 120000, portal: 120000, kva: 120000, kvModell: 120000, kvTage: null });

    // Der Kunde wählt den (jetzt preislosen) Termin; der Preis bleibt der Optionspreis.
    expect(await waehleTag("2027-03-27")).toEqual({ ok: true });
    expect(await preise()).toEqual({ quotation: 120000, portal: 120000, kva: 120000, kvModell: 120000, kvTage: null });

    // Die Annahme nimmt genau diesen Preis (und lehnt den alten Standardtag-Preis ab).
    expect(await annehmen(164000)).toMatchObject({ ok: false, reason: "price_changed" });
    expect(await annehmen(120000)).toMatchObject({ ok: true });
    const [a] = await sql`select confirmed_total_cents from kva_confirmations where deal_record_id = ${deal}`;
    expect(a.confirmed_total_cents).toBe(120000);
  });

  it("N1: Schalter aus, DELETE (leere Liste): Quotation und Optionen lösen mit, alle Quellen gleich", async () => {
    await schalter(true, true);
    await gesperrtMitPaketenUndTagen();
    await sql`delete from operating_company_portal_settings where operating_company_record_id = ${firma}`;

    expect(await termineVonHand()).toEqual({ count: 0 });
    expect(await angebote()).toEqual([]);
    expect((await optionen()).every((o) => o.calculation_version_id === null)).toBe(true);
    expect(await quotation()).toMatchObject({ fixed_price: "1890.00", calculation_version_id: null });
    expect(await preise()).toEqual({ quotation: 189000, portal: 189000, kva: 189000, kvModell: 189000, kvTage: null });
    expect(await annehmen(189000)).toMatchObject({ ok: true });
  });

  it("N1: nur Tage (ohne Pakete): die Quotation löst mit und behält ihren Preis; Portal, Annahme und KV gleich, keine alten Tage", async () => {
    await schalter(true, true);
    const nurTage = { ...version, packagePrices: [], dayPrices: version.dayPrices.map((d) => ({ ...d, paketpreise: null })) };
    await gesperrtMitPaketenUndTagen(nurTage as unknown as typeof version);
    await sql`delete from quotation_package_options where deal_record_id = ${deal}`;
    await sql`update quotations set fixed_price = '1300.00', selected_package_option_id = null, selected_package_slug = null where id = ${q1}`;
    await sql`update quotation_line_items set unit_rate = '0.00' where quotation_id = ${q1} and description = 'Halteverbot'`;
    await sql`update quotation_date_offers set price_cents = case when offer_date = '2027-03-23' then 130000 else 150000 end, package_prices = null where deal_record_id = ${deal}`;
    await schalter(false, false);

    expect(await termineVonHand("2027-03-23")).toEqual({ count: 1 });
    expect(await quotation()).toMatchObject({ fixed_price: "1300.00", calculation_version_id: null });
    expect(await preise()).toEqual({ quotation: 130000, portal: 130000, kva: 130000, kvModell: 130000, kvTage: null });
    expect(await waehleTag("2027-03-23")).toEqual({ ok: true });
    expect(await preise()).toEqual({ quotation: 130000, portal: 130000, kva: 130000, kvModell: 130000, kvTage: null });
    expect(await annehmen(130000)).toMatchObject({ ok: true });
  });

  it("N1: Termine ohne Versionsbezug (von Hand) lösen nichts: Quotation und Optionen bleiben gebunden", async () => {
    await schalter(true, true);
    await gesperrtMitPaketenUndTagen();
    await sql`update quotation_date_offers set calculation_version_id = null, price_cents = null, package_prices = null where deal_record_id = ${deal}`;
    await schalter(false, false);
    await termineVonHand("2027-03-27");
    expect(await quotation()).toMatchObject({ fixed_price: "1640.00", calculation_version_id: v1 });
    expect((await optionen()).every((o) => o.calculation_version_id === v1)).toBe(true);
  });

  it("N1: mit Tagespreis-Schalter bleibt die Ablehnung (409), nichts gelöst", async () => {
    await schalter(true, true);
    await gesperrtMitPaketenUndTagen();
    await expect(termineVonHand("2027-03-27")).rejects.toBeInstanceOf(portal.TermineMitPreisError);
    expect(await quotation()).toMatchObject({ fixed_price: "1640.00", calculation_version_id: v1 });
    expect((await optionen()).every((o) => o.calculation_version_id === v1)).toBe(true);
  });

  it("N1, SQL-Mitschnitt: Termine, Optionen und Quotation werden im selben tx nach angebotSperren gelöst, alles auf einer Verbindung", async () => {
    await schalter(true, true);
    await gesperrtMitPaketenUndTagen();
    await schalter(false, false);
    mitschnitt.zeilen.length = 0;
    await termineVonHand("2027-03-23");
    const z = mitschnitt.zeilen;
    const sperre = z.findIndex((e) => e.sql.includes("pg_advisory_xact_lock"));
    expect(sperre).toBeGreaterThanOrEqual(0);
    const conn = z[sperre].conn;
    const commit = z.findIndex((e, i) => i > sperre && e.conn === conn && /^commit/i.test(e.sql.trim()));
    expect(commit).toBeGreaterThan(sperre);
    const schreibend = z
      .map((e, i) => ({ ...e, i }))
      .filter((e) => /^(insert|update|delete)/i.test(e.sql.trim()));
    expect(new Set(schreibend.map((s) => s.sql.match(/(?:into|update|from)\s+"(\w+)"/i)?.[1]))).toEqual(
      new Set(["quotation_date_offers", "quotation_package_options", "quotations"])
    );
    for (const s of schreibend) expect(s.conn === conn && s.i > sperre && s.i < commit).toBe(true);
    expect(z.slice(sperre, commit).every((e) => e.conn === conn)).toBe(true);
  });

  // ─── M2 ─────────────────────────────────────────────────────────────────

  const optionenVonHand = () =>
    portal.replaceDealPackageOptions({
      workspaceId: ws,
      dealRecordId: deal,
      createdBy: null,
      options: [
        { catalogueSlug: "basis", displayName: "Basis", shortDescription: null, priceCents: 110000, includedItems: [], note: null, isRecommended: false },
        { catalogueSlug: "komfort", displayName: "Komfort", shortDescription: null, priceCents: 175000, includedItems: [], note: null, isRecommended: true },
      ],
    });

  it("M2: ohne Schalter lösen Optionen von Hand den Bezug, wenn die Version Paketpreise trägt; Termine verlieren ihre Preise", async () => {
    await schalter(true, true);
    await gesperrtMitPaketenUndTagen();
    await schalter(false, false);

    expect(await optionenVonHand()).toEqual({ count: 2 });
    expect((await optionen()).map((o) => [o.catalogue_slug, o.price_cents, o.calculation_version_id])).toEqual([
      ["basis", 110000, null],
      ["komfort", 175000, null],
    ]);
    expect(await quotation()).toMatchObject({ fixed_price: "1750.00", calculation_version_id: null, selected_package_slug: "komfort" });
    // Ohne Tagespreis-Schalter tragen die Termine keinen Preis mehr (wie beim alten Termin-Weg, I6).
    expect((await angebote()).map((a) => [a.datum, a.price_cents, a.package_prices, a.calculation_version_id])).toEqual([
      ["2027-03-20", null, null, null],
      ["2027-03-23", null, null, null],
    ]);
    expect(await preise()).toEqual({ quotation: 175000, portal: 175000, kva: 175000, kvModell: 175000, kvTage: null });
  });

  it("M2: ohne Schalter und ohne Paketpreise in der Version bleibt der Bezug (wie 5a)", async () => {
    v1 = randomUUID();
    await sql`insert into deal_calculation_versions (id, workspace_id, deal_record_id, version, status, reference_date, price_cents, kv_items, package_prices, day_prices)
      values (${v1}, ${ws}, ${deal}, 1, 'gesperrt', '2026-11-07', 100000, ${sql.json(posten(["Umzug", 1000]) as never)}, ${sql.json([])}, ${sql.json([])})`;
    await sql`update quotations set calculation_version_id = ${v1} where id = ${q1}`;
    await optionenVonHand();
    expect(await quotation()).toMatchObject({ fixed_price: "1750.00", calculation_version_id: v1 });
  });

  it("M2: mit Tagespreis-Schalter bleiben die Termine der Version; Quotation und Optionen lösen", async () => {
    await schalter(true, true);
    await gesperrtMitPaketenUndTagen();
    await optionenVonHand();
    expect(await quotation()).toMatchObject({ calculation_version_id: null });
    expect((await optionen()).every((o) => o.calculation_version_id === null)).toBe(true);
    expect((await angebote()).every((a) => a.calculation_version_id === v1 && a.price_cents !== null)).toBe(true);
  });

  // ─── N4 ─────────────────────────────────────────────────────────────────

  it("N4: kvAusVersion liest Angebot und Wahl in einer REPEATABLE-READ-Transaktion auf einer Verbindung", async () => {
    await schalter(true, true);
    await gesperrtMitPaketenUndTagen();
    const { kvAusVersion } = await import("./kv-aus-version");
    const speichereKv = vi.fn(async () => ({ document: { id: "doc_1" }, fileName: "KV.pdf" }));
    mitschnitt.zeilen.length = 0;
    const r = await kvAusVersion(
      { workspaceId: ws, dealRecordId: deal, version: 1, updatedBy: null },
      {
        ladeVersion: async () => ({ id: v1, status: "gesperrt", pricingMode: "fest", priceCents: version.priceCents, kvItems: version.kvItems, packagePrices: version.packagePrices, dayPrices: version.dayPrices }),
        ladeVersionen: async () => [{ version: 1, status: "gesperrt" }],
        ladeAngebotsVersionId: async () => v1,
        hatPakete: async () => true,
        istKottke: async () => false,
        ladeSchalter: async () => ({ angebotAusKalkulation: true, tagespreise: true }),
        speichereKv: speichereKv as never,
      }
    );
    // Komfort am empfohlenen Tag passt zur Version: kein „von Hand geändert“.
    expect(r).toMatchObject({ renderer: "crm", fileName: "KV.pdf" });
    const z = mitschnitt.zeilen;
    // drizzle (postgres-js): „begin“, dann „set transaction isolation level repeatable read read only“.
    const begin = z.findIndex((e) => /^set transaction/i.test(e.sql.trim()) && /repeatable read/i.test(e.sql));
    expect(begin).toBeGreaterThanOrEqual(0);
    const conn = z[begin].conn;
    const commit = z.findIndex((e, i) => i > begin && e.conn === conn && /^commit/i.test(e.sql.trim()));
    expect(commit).toBeGreaterThan(begin);
    const lesend = z.slice(begin + 1, commit);
    const tabellen = new Set(lesend.map((e) => e.sql.match(/from\s+"(\w+)"/i)?.[1]).filter(Boolean));
    // Kopf, Posten, Optionen (Paket der Wahl) und Kundenwahl (Tag) aus einem Stand.
    for (const t of ["quotations", "quotation_line_items", "quotation_package_options", "customer_date_selections"]) expect(tabellen).toContain(t);
    expect(lesend.every((e) => e.conn === conn)).toBe(true);
    // Außerhalb dieser Transaktion liest kvAusVersion weder Quotation noch Wahl.
    const aussen = z.filter((e, i) => (i < begin || i > commit) && /from\s+"(quotations|quotation_line_items|customer_date_selections)"/i.test(e.sql));
    expect(aussen).toEqual([]);
  });
});
