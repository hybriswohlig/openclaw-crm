import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Plan 5b, Task K gegen eine Wegwerf-Datenbank: Sperren schreibt Paketoptionen je
 * `catalogue_slug` (IDs und Kundenwahl bleiben), Terminangebote je Datum und die
 * Quotation aus der Kundenwahl in einer Transaktion unter `angebotSperren`. Zwei
 * Sperren gleichzeitig: genau eine gelingt. `@/db` hat EINE Verbindung: wer unter
 * der Sperre über die globale `db` liest, hängt (Regel 5a).
 * Läuft nur mit ANNAHME_TEST_DATABASE_URL (z. B. postgres://postgres@127.0.0.1:54351/t5_k).
 */
const url = process.env.ANNAHME_TEST_DATABASE_URL;

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.ANNAHME_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 1 });
  return { db: drizzle(client, { schema }) };
});
vi.mock("./activity-events", () => ({ emitEvent: async () => {} }));

import type { Tagespreis, VersionsPreise } from "@/lib/angebot-wahl";
import type { AngebotsEingabe } from "./quotations";
import type { Plan5Sperre } from "./kalkulation-versionen";

describe.skipIf(!url)("Sperren mit Paketen und Tagen (DB)", { timeout: 15_000 }, () => {
  let sql: postgres.Sql;
  let speicher: typeof import("./kalkulation-versionen-speicher");
  let portal: typeof import("./customer-portal-data");
  const ws = randomUUID();
  const dealObj = randomUUID();
  const firmaObj = randomUUID();
  const attrFirma = randomUUID();
  const deal = randomUUID();
  const firma = randomUUID();
  const link = randomUUID();
  const ids = { basis: "", komfort: "", tag20: "", tag21: "" };

  const eingabe = (): AngebotsEingabe => ({
    fixedPrice: "1490", isVariable: false, notes: null,
    calculationAssumptions: { selbstkosten: 800, uebernommenVon: "mensch" } as AngebotsEingabe["calculationAssumptions"],
    lineItems: [{ type: "other", description: "Umzug", quantity: 1, unitRate: "1490.00", sortOrder: 0 }],
    documentDetails: { validUntil: "2026-11-19" }, validUntil: "2026-11-19",
  });
  const kv = (eur: number, text = "Umzugsteam") => [{ description: text, quantity: 1, unitRate: eur }];
  const tag = (datum: string, preis: number, empfohlen: boolean): Tagespreis => ({
    datum, wochentag: "sa", feiertag: false, festpreis: preis, rechnerFestpreis: preis, selbstkosten: 800, margeProzent: 40, gruende: [],
    uebersteuert: null, kvItems: kv(preis),
    paketpreise: [
      { slug: "basis", festpreis: preis - 200, selbstkosten: 700, kvItems: kv(preis - 200, "Basis") },
      { slug: "komfort", festpreis: preis, selbstkosten: 800, kvItems: kv(preis, "Komfort") },
    ],
    slots: [{ label: "Vormittag", startTime: "08:00", endTime: "12:00" }], note: null, empfohlen, vehicleBookingId: null,
  });
  const plan5 = (aufschlag = 0): Plan5Sperre => {
    const preise: VersionsPreise = {
      pricingMode: "fest", priceCents: (1590 + aufschlag) * 100, kvItems: kv(1590 + aufschlag, "Komfort"),
      packagePrices: [
        { slug: "basis", festpreis: 1290 + aufschlag, selbstkosten: 700, kvItems: kv(1290 + aufschlag, "Basis") },
        { slug: "komfort", festpreis: 1490 + aufschlag, selbstkosten: 800, kvItems: kv(1490 + aufschlag, "Komfort") },
      ],
      dayPrices: [tag("2026-11-20", 1490 + aufschlag, false), tag("2026-11-21", 1590 + aufschlag, true)],
    };
    return { preise, standard: { paketSlug: "komfort", datum: "2026-11-21" }, stunden: null };
  };
  const entwurf = async (n: number) => {
    const id = randomUUID();
    await sql`insert into deal_calculation_versions (id, workspace_id, deal_record_id, version, status, reference_date)
      values (${id}, ${ws}, ${deal}, ${n}, 'entwurf', '2026-11-07')`;
    return id;
  };
  const sperre = (id: string, p: Plan5Sperre) =>
    speicher.dbVersionsSpeicher.sperrenUndAngebot(ws, deal, id, eingabe(), p.preise.kvItems, null, { uebersteuerungen: 0, plan5: p });

  beforeAll(async () => {
    sql = postgres(url!, { max: 2 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Test', ${`t-${ws}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${dealObj}, ${ws}, 'deals', 'Deal', 'Deals')`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${firmaObj}, ${ws}, 'operating_companies', 'Firma', 'Firmen')`;
    await sql`insert into attributes (id, object_id, slug, title, type) values (${attrFirma}, ${dealObj}, 'operating_company', 'Firma', 'record_reference')`;
    await sql`insert into records (id, object_id) values (${deal}, ${dealObj})`;
    await sql`insert into records (id, object_id) values (${firma}, ${firmaObj})`;
    await sql`insert into record_values (id, record_id, attribute_id, referenced_record_id) values (${randomUUID()}, ${deal}, ${attrFirma}, ${firma})`;
    await sql`insert into operating_company_portal_settings (operating_company_record_id, workspace_id, angebot_aus_kalkulation, tagespreise_enabled)
      values (${firma}, ${ws}, true, true)`;
    await sql`insert into customer_status_links (id, workspace_id, deal_record_id, token) values (${link}, ${ws}, ${deal}, ${randomUUID().replace(/-/g, "")})`;
    speicher = await import("./kalkulation-versionen-speicher");
    portal = await import("./customer-portal-data");
  });

  beforeEach(async () => {
    for (const t of ["kva_confirmations", "customer_date_selections", "quotation_date_offers", "quotation_package_options", "quotations", "deal_calculation_versions"]) {
      await sql.unsafe(`delete from ${t} where deal_record_id = $1`, [deal]);
    }
    ids.basis = randomUUID();
    ids.komfort = randomUUID();
    ids.tag20 = randomUUID();
    ids.tag21 = randomUUID();
    await sql`insert into quotations (id, deal_record_id, fixed_price, is_variable, selected_package_option_id)
      values (${randomUUID()}, ${deal}, '999.00', false, null)`;
    await sql`insert into quotation_package_options (id, workspace_id, deal_record_id, catalogue_slug, display_name, price_cents, is_recommended, sort_order) values
      (${ids.basis}, ${ws}, ${deal}, 'basis', 'Basis', 90000, false, 0),
      (${ids.komfort}, ${ws}, ${deal}, 'komfort', 'Komfort', 120000, true, 1)`;
    // Altbestand ohne Preis: der 20. bleibt (gleiche ID), der 28. wird nicht mehr angeboten.
    await sql`insert into quotation_date_offers (id, workspace_id, deal_record_id, offer_date, sort_order) values
      (${ids.tag20}, ${ws}, ${deal}, '2026-11-20', 0), (${ids.tag21}, ${ws}, ${deal}, '2026-11-28', 1)`;
    // Kundenwahl: Basis am 20.
    await sql`update quotations set selected_package_option_id = ${ids.basis}, selected_package_slug = 'basis' where deal_record_id = ${deal}`;
    await sql`insert into customer_date_selections (id, workspace_id, deal_record_id, customer_link_id, date_offer_id, selected_date)
      values (${randomUUID()}, ${ws}, ${deal}, ${link}, ${ids.tag20}, '2026-11-20')`;
  });

  afterAll(async () => {
    await sql`delete from workspaces where id = ${ws}`;
    await sql.end();
  });

  it("zwei Sperren gleichzeitig: genau eine gelingt; Optionen und Wahl behalten ihre IDs; Quotation = Preis der Kundenwahl", async () => {
    const v1 = await entwurf(1);
    const r = await Promise.allSettled([sperre(v1, plan5()), sperre(v1, plan5())]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "UNGUELTIG" });

    const optionen = await sql`select id, catalogue_slug, price_cents, calculation_version_id from quotation_package_options where deal_record_id = ${deal} order by sort_order`;
    expect(optionen.map((o) => [o.id, o.price_cents, o.calculation_version_id])).toEqual([[ids.basis, 129000, v1], [ids.komfort, 149000, v1]]);
    const tage = await sql`select id, offer_date::text as d, price_cents, package_prices, calculation_version_id from quotation_date_offers where deal_record_id = ${deal} order by offer_date`;
    expect(tage.map((t) => [t.d, t.price_cents, t.calculation_version_id])).toEqual([["2026-11-20", 149000, v1], ["2026-11-21", 159000, v1]]);
    expect(tage[0].id).toBe(ids.tag20);
    expect(tage[0].package_prices).toEqual({ basis: 129000, komfort: 149000 });
    const [wahl] = await sql`select date_offer_id from customer_date_selections where deal_record_id = ${deal}`;
    expect(wahl.date_offer_id).toBe(ids.tag20);

    // Basis am 20.: 1290 €, Posten ergeben den Preis, Version verknüpft.
    const [q] = await sql`select id, fixed_price, is_variable, selected_package_option_id, calculation_version_id from quotations where deal_record_id = ${deal}`;
    expect(q).toMatchObject({ fixed_price: "1290.00", is_variable: false, selected_package_option_id: ids.basis, calculation_version_id: v1 });
    const posten = await sql`select description, unit_rate from quotation_line_items where quotation_id = ${q.id}`;
    expect(posten.map((p) => [p.description, p.unit_rate])).toEqual([["Basis", "1290.00"]]);
    const [v] = await sql`select status, price_cents, jsonb_array_length(day_prices)::int as tage from deal_calculation_versions where id = ${v1}`;
    expect(v).toMatchObject({ status: "gesperrt", price_cents: 159000, tage: 2 });
  });

  it("erneutes Sperren (v2, neue Preise): dieselben IDs, Wahl bleibt, Preis folgt der neuen Version; Paketoptionen von Hand lösen den Bezug", async () => {
    const v1 = await entwurf(1);
    await sperre(v1, plan5());
    const v2 = await entwurf(2);
    await sperre(v2, plan5(100));
    const optionen = await sql`select id, price_cents from quotation_package_options where deal_record_id = ${deal} order by sort_order`;
    expect(optionen.map((o) => [o.id, o.price_cents])).toEqual([[ids.basis, 139000], [ids.komfort, 159000]]);
    const [tag20] = await sql`select id, price_cents from quotation_date_offers where deal_record_id = ${deal} and offer_date = '2026-11-20'`;
    expect(tag20).toMatchObject({ id: ids.tag20, price_cents: 159000 });
    const [q] = await sql`select fixed_price, calculation_version_id from quotations where deal_record_id = ${deal}`;
    expect(q).toMatchObject({ fixed_price: "1390.00", calculation_version_id: v2 });

    await portal.replaceDealPackageOptions({
      workspaceId: ws, dealRecordId: deal, createdBy: null,
      options: [{ catalogueSlug: "basis", displayName: "Basis", shortDescription: null, priceCents: 100000, includedItems: [], note: null, isRecommended: true }],
    });
    const [nachher] = await sql`select calculation_version_id from quotations where deal_record_id = ${deal}`;
    expect(nachher.calculation_version_id).toBeNull();
  });

  it("Plan 12b: Buchung je Tag an Terminangebot und Version eingefroren; ein Sperren ohne Buchung löst sie", async () => {
    const buchung = randomUUID();
    await sql`insert into vehicle_bookings (id, workspace_id, operating_company_record_id, von, bis, station_id, station_name, klasse_id, klasse_name, miete_cents, geplante_auftraege)
      values (${buchung}, ${ws}, ${firma}, '2026-11-17', '2026-11-20', 'st1', 'Sixt', 'kl1', 'Sprinter L', 45000, 3)`;
    const anteil = { buchungId: buchung, mieteCent: 45000, geplanteAuftraege: 3, anteilCent: 15000, inklusivKmAnteil: null, mehrkmSatzCent: null };
    const p = plan5();
    p.preise.dayPrices[0] = { ...p.preise.dayPrices[0]!, vehicleBookingId: buchung, buchungsanteil: anteil };
    const v1 = await entwurf(1);
    await speicher.dbVersionsSpeicher.sperrenUndAngebot(ws, deal, v1, eingabe(), p.preise.kvItems, null, {
      uebersteuerungen: 0,
      plan5: p,
      schnappschuss: {
        referenceDate: "2026-11-07", rechnerRequest: {}, rechnerResult: {}, inputs: [], costLines: [], margin: null, packagePrices: [], tariff: null,
        vehicleBookingId: buchung,
      },
    });
    const [v] = await sql`select vehicle_booking_id, day_prices from deal_calculation_versions where id = ${v1}`;
    expect(v.vehicle_booking_id).toBe(buchung);
    expect(v.day_prices[0]).toMatchObject({ vehicleBookingId: buchung, buchungsanteil: { anteilCent: 15000 } });
    const tage = await sql`select offer_date::text as d, vehicle_booking_id from quotation_date_offers where deal_record_id = ${deal} order by offer_date`;
    expect(tage.map((t) => [t.d, t.vehicle_booking_id])).toEqual([["2026-11-20", buchung], ["2026-11-21", null]]);

    const v2 = await entwurf(2);
    await sperre(v2, plan5(100));
    const nachher = await sql`select vehicle_booking_id from quotation_date_offers where deal_record_id = ${deal}`;
    expect(nachher.every((t) => t.vehicle_booking_id === null)).toBe(true);
    await sql`delete from deal_calculation_versions where deal_record_id = ${deal}`;
    await sql`delete from vehicle_bookings where id = ${buchung}`;
  });

  it("nach der Annahme schreibt das Sperren nichts (Annahme unter derselben Sperre)", async () => {
    const v1 = await entwurf(1);
    await sql`insert into kva_confirmations (id, workspace_id, deal_record_id, customer_link_id, quotation_snapshot, confirmed_total_cents, agb_version_accepted, ip_address, user_agent)
      values (${randomUUID()}, ${ws}, ${deal}, ${link}, ${sql.json({})}, 129000, 'test', '203.0.113.5', 'test')`;
    const { AngebotAngenommenError } = await import("./kva-annahme");
    await expect(sperre(v1, plan5())).rejects.toBeInstanceOf(AngebotAngenommenError);
    const [o] = await sql`select price_cents from quotation_package_options where id = ${ids.basis}`;
    expect(o.price_cents).toBe(90000);
  });
});
