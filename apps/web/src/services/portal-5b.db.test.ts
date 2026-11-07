import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { angezeigterPreis, hatTagespreise, type KvaAnnahmeSnapshot } from "@openclaw-crm/customer-portal-core";

/**
 * Plan 5b, Task W gegen eine echte Postgres-Datenbank: Portal-Kontext und
 * Annahme mit Paket- und Tagespreisen aus der Version und mit Stunden-KV.
 *
 * Die Preise je Tag liest `loadDateOffersContext` (Task T). Solange T nicht
 * zusammengeführt ist, fehlen sie im Kontext; dann gilt der Optionspreis wie
 * vor 5b. Die Tests prüfen beide Stände: ohne T-Felder die alte Regel, mit
 * ihnen den Tagespreis. Immer gilt: Portal-Preis = Annahmepreis.
 *
 * Läuft nur mit ANNAHME_TEST_DATABASE_URL (Wegwerf-DB mit Schema bis 0061).
 */
const url = process.env.ANNAHME_TEST_DATABASE_URL;

vi.mock("./agb", () => ({ ladeAgbHtml: async () => `<h1>AGB</h1>${"Text der AGB. ".repeat(60)}` }));
vi.mock("./activity-events", () => ({ emitEvent: async () => {} }));
vi.mock("./wartet", () => ({ aktualisiereWartet: async () => {}, aktualisiereWartetNachBesuch: async () => {} }));

/** Interne Zahlen der Version, die nie in Kontext oder Annahme stehen dürfen. */
const INTERN = ["selbstkosten", "marge", "gruende", "rechnerFestpreis", "uebersteuert", "77777", "66666", "Wochenende +5"];

describe.skipIf(!url)("Portal und Annahme mit Plan-5-Preisen (DB)", { timeout: 20_000 }, () => {
  let sql: postgres.Sql;
  let portal: typeof import("./customer-portal-data");
  const ws = randomUUID();
  const obj = randomUUID();

  const body = (expectedTotalCents: number) => ({
    acceptedOffer: true,
    acceptedAgb: true,
    haftungshinweisBestaetigt: false,
    versicherungGewuenscht: false,
    vorzeitigerBeginnVerlangt: false,
    expectedTotalCents,
    fullName: "Anna Muster",
  });
  const ctx = { ipAddress: "203.0.113.5", userAgent: "test" };

  async function deal() {
    const id = randomUUID();
    const link = randomUUID();
    const token = randomUUID().replace(/-/g, "");
    await sql`insert into records (id, object_id) values (${id}, ${obj})`;
    await sql`insert into customer_status_links (id, workspace_id, deal_record_id, token) values (${link}, ${ws}, ${id}, ${token})`;
    return { id, link, token };
  }

  /** Gesperrte Version mit internen Zahlen in Paket- und Tagespreisen. */
  async function version(dealId: string, modus: "fest" | "stunden" = "fest") {
    const v = randomUUID();
    const paket = (slug: string, festpreis: number) => ({ slug, festpreis, selbstkosten: 77777, margeProzent: 37, rechnerFestpreis: festpreis, uebersteuert: null });
    await sql`insert into deal_calculation_versions (id, workspace_id, deal_record_id, version, status, pricing_mode, reference_date, price_cents, package_prices, day_prices, margin)
      values (${v}, ${ws}, ${dealId}, 1, 'gesperrt', ${modus}, '2099-01-10', 149000,
        ${sql.json([paket("basis", 1190), paket("komfort", 1490)])},
        ${sql.json([{ datum: "2099-03-06", festpreis: 1640, selbstkosten: 66666, margeProzent: 40, gruende: [{ text: "Wochenende +5", punkte: 5 }], paketpreise: [paket("komfort", 1640)] }])},
        ${sql.json({ margeProzent: 37, selbstkosten: 77777 })})`;
    await sql`insert into deal_documents (id, workspace_id, deal_record_id, document_type, file_name, file_size, mime_type, file_content, calculation_version_id)
      values (${randomUUID()}, ${ws}, ${dealId}, 'quotation', 'KV.pdf', 10, 'application/pdf', ${Buffer.from("%PDF test").toString("base64")}, ${v})`;
    return v;
  }

  async function quotation(dealId: string, v: string | null, euro: number | null, opts: { variabel?: boolean; details?: unknown } = {}) {
    const q = randomUUID();
    await sql`insert into quotations (id, deal_record_id, fixed_price, is_variable, service_type, calculation_version_id, document_details)
      values (${q}, ${dealId}, ${euro === null ? null : euro.toFixed(2)}, ${opts.variabel ?? false}, 'kitchen_installation', ${v}, ${opts.details ? sql.json(opts.details as never) : null})`;
    return q;
  }
  async function posten(q: string, zeilen: Array<[string, string, number, number]>) {
    for (const [i, [typ, text, menge, satz]] of zeilen.entries()) {
      await sql`insert into quotation_line_items (id, quotation_id, type, description, quantity, unit_rate, sort_order)
        values (${randomUUID()}, ${q}, ${typ}, ${text}, ${menge}, ${satz.toFixed(2)}, ${i})`;
    }
  }
  async function terminangebot(dealId: string, v: string | null, datum: string, cent: number | null, pakete: Record<string, number> | null, empfohlen = false) {
    const id = randomUUID();
    await sql`insert into quotation_date_offers (id, workspace_id, deal_record_id, offer_date, slots, is_recommended, sort_order, price_cents, package_prices, calculation_version_id)
      values (${id}, ${ws}, ${dealId}, ${datum}, '[{"label":"vormittags","startTime":"08:00","endTime":"12:00"}]', ${empfohlen}, 0, ${cent}, ${pakete ? sql.json(pakete) : null}, ${v})`;
    return id;
  }
  async function terminWaehlen(d: { id: string; link: string }, angebot: string, datum: string) {
    await sql`delete from customer_date_selections where deal_record_id = ${d.id}`;
    await sql`insert into customer_date_selections (id, workspace_id, deal_record_id, customer_link_id, date_offer_id, selected_date, selected_slot_label, selected_slot_start, selected_slot_end)
      values (${randomUUID()}, ${ws}, ${d.id}, ${d.link}, ${angebot}, ${datum}, 'vormittags', '08:00', '12:00')`;
  }
  const annahme = async (dealId: string) =>
    (await sql`select confirmed_total_cents, selected_option_id, selected_option_name, selected_date_offer_id, selected_date::text as selected_date, quotation_snapshot
      from kva_confirmations where deal_record_id = ${dealId}`)[0];

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    sql = postgres(url!, { max: 3 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Test', ${`t-${ws}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${obj}, ${ws}, 'deals', 'Deal', 'Deals')`;
    portal = await import("./customer-portal-data");
  });

  afterAll(async () => {
    await sql`delete from workspaces where id = ${ws}`;
    await sql.end();
  });

  it("Pakete × Tage: Kontext ohne interne Zahlen, Annahme mit Wahl, Tag und allen angebotenen Preisen", async () => {
    const d = await deal();
    const v = await version(d.id);
    const q = await quotation(d.id, v, 1640);
    await posten(q, [["other", "Umzug", 1, 1250], ["other", "Halteverbotszone", 1, 180], ["other", "Montage", 1, 210]]);
    const basis = randomUUID();
    const komfort = randomUUID();
    await sql`insert into quotation_package_options (id, workspace_id, deal_record_id, catalogue_slug, calculation_version_id, display_name, price_cents, is_recommended, sort_order)
      values (${basis}, ${ws}, ${d.id}, 'basis', ${v}, 'Basis', 119000, false, 0), (${komfort}, ${ws}, ${d.id}, 'komfort', ${v}, 'Komfort', 149000, true, 1)`;
    await sql`update quotations set selected_package_option_id = ${komfort}, selected_package_slug = 'komfort' where id = ${q}`;
    const fr = await terminangebot(d.id, v, "2099-03-05", 149000, { basis: 119000, komfort: 149000 }, true);
    const sa = await terminangebot(d.id, v, "2099-03-06", 164000, { basis: 131000, komfort: 164000 });
    void fr;
    await terminWaehlen(d, sa, "2099-03-06");

    const c = (await portal.loadContextByToken(d.token))!;
    const json = JSON.stringify(c);
    for (const wort of INTERN) expect(json).not.toContain(wort);
    const mitTagespreisen = hatTagespreise(c.dateOffers.options);
    const preis = angezeigterPreis(c).cents;
    // Mit Tagespreisen (Task T) gilt Komfort am Samstag, sonst wie vor 5b der Optionspreis.
    expect(preis).toBe(mitTagespreisen ? 164000 : 149000);
    expect(c.kva?.totalCents).toBe(preis);

    expect(await portal.confirmKvaForToken(d.token, body(preis), ctx)).toMatchObject({ ok: true });
    const a = await annahme(d.id);
    expect(a).toMatchObject({ confirmed_total_cents: preis, selected_option_id: komfort, selected_option_name: "Komfort", selected_date_offer_id: sa, selected_date: "2099-03-06" });
    const snap = a.quotation_snapshot as KvaAnnahmeSnapshot;
    expect(snap.wahl).toEqual({ paketSlug: "komfort", paketName: "Komfort", dateOfferId: sa, datum: "2099-03-06", priceCents: preis });
    // F2 (M7): nur die Zellen, die das Portal anbietet: je Tag jedes Paket. Paketpreise am
    // Basistag (datum null) und der Tagespreis ohne Paket sind mit Paketen nie wählbar.
    expect(mitTagespreisen).toBe(true);
    expect(snap.angebotenePreise).toEqual([
      { paketSlug: "basis", paketName: "Basis", datum: "2099-03-05", cent: 119000 },
      { paketSlug: "komfort", paketName: "Komfort", datum: "2099-03-05", cent: 149000 },
      { paketSlug: "basis", paketName: "Basis", datum: "2099-03-06", cent: 131000 },
      { paketSlug: "komfort", paketName: "Komfort", datum: "2099-03-06", cent: 164000 },
    ]);
    const snapJson = JSON.stringify(snap);
    for (const wort of INTERN) expect(snapJson).not.toContain(wort);
  });

  it("nur Tage: price_changed, wenn ein zweiter Tab den Tag gewechselt hat; danach Annahme mit dem neuen Tag", async () => {
    const d = await deal();
    const v = await version(d.id);
    const q = await quotation(d.id, v, 1490);
    await posten(q, [["other", "Umzug", 1, 1490]]);
    const fr = await terminangebot(d.id, v, "2099-03-05", 149000, null, true);
    const sa = await terminangebot(d.id, v, "2099-03-06", 164000, null);
    await terminWaehlen(d, fr, "2099-03-05");

    // Tab A lädt und zeigt den Freitag.
    const tabA = (await portal.loadContextByToken(d.token))!;
    const gesehen = angezeigterPreis(tabA).cents;
    expect(gesehen).toBe(149000);

    // Tab B wählt den Samstag. Die Kundenwahl (Task T) tauscht Preis und Posten
    // unter der Sperre; hier von Hand nachgestellt, mit T sind die Werte dieselben.
    expect(await portal.selectDateOffer(d.token, { dateOfferId: sa, slotIndex: 0 }, ctx)).toEqual({ ok: true });
    await sql`update quotations set fixed_price = '1640.00' where id = ${q}`;
    await sql`update quotation_line_items set unit_rate = '1640.00' where quotation_id = ${q}`;

    expect(await portal.confirmKvaForToken(d.token, body(gesehen), ctx)).toEqual({ ok: false, reason: "price_changed" });
    expect(await annahme(d.id)).toBeUndefined();

    const neu = (await portal.loadContextByToken(d.token))!;
    expect(angezeigterPreis(neu).cents).toBe(164000);
    expect(await portal.confirmKvaForToken(d.token, body(164000), ctx)).toMatchObject({ ok: true });
    const a = await annahme(d.id);
    expect(a).toMatchObject({ confirmed_total_cents: 164000, selected_date_offer_id: sa, selected_date: "2099-03-06", selected_option_id: null });
    // F2 (M7): ohne Pakete je Tag der Tagespreis.
    expect((a.quotation_snapshot as KvaAnnahmeSnapshot).angebotenePreise).toEqual([
      { paketSlug: null, paketName: null, datum: "2099-03-05", cent: 149000 },
      { paketSlug: null, paketName: null, datum: "2099-03-06", cent: 164000 },
    ]);
  });

  it("Stunden-KV aus der Version: Schätzung im Kontext und als Annahmebetrag, Stunden im Schnappschuss", async () => {
    const d = await deal();
    const v = await version(d.id, "stunden");
    const stunden = { helfer: 3, transporter: 1, stundenGeschaetzt: 5.5, mindestStunden: 3, satzHelferEur: 35, satzTransporterEur: 25, summeGeschaetztCent: 71500, mindestbetragCent: 39000, quelle: "version" };
    const q = await quotation(d.id, v, null, { variabel: true, details: { stunden } });
    await posten(q, [["helper", "Helfer je Stunde", 3, 35], ["transporter", "Transporter je Stunde", 1, 25]]);

    const c = (await portal.loadContextByToken(d.token))!;
    expect(c.kva).toMatchObject({ isVariable: true, totalCents: 71500, stundenModell: "version", stunden });
    for (const wort of INTERN) expect(JSON.stringify(c)).not.toContain(wort);
    expect(await portal.confirmKvaForToken(d.token, body(71500), ctx)).toMatchObject({ ok: true });
    const a = await annahme(d.id);
    expect(a.confirmed_total_cents).toBe(71500);
    expect(a.quotation_snapshot).toMatchObject({ stundenModell: "version", stunden, totalCents: 71500 });
    expect((a.quotation_snapshot as KvaAnnahmeSnapshot).wahl).toBeUndefined();
  });

  it("Stunden-KV, von Hand gelöst (ohne Version): „alt“, Annahmebetrag wie heute", async () => {
    const d = await deal();
    const stunden = { helfer: 3, transporter: 1, stundenGeschaetzt: 5.5, mindestStunden: 3, satzHelferEur: 35, satzTransporterEur: 25, summeGeschaetztCent: 71500, mindestbetragCent: 39000, quelle: "version" };
    const q = await quotation(d.id, null, null, { variabel: true, details: { stunden } });
    await posten(q, [["helper", "Helfer", 2, 35], ["transporter", "Transporter", 1, 25]]);
    const c = (await portal.loadContextByToken(d.token))!;
    expect(c.kva).toMatchObject({ totalCents: 9500, stundenModell: "alt" });
    expect(c.kva?.stunden).toBeUndefined();
    expect(await portal.confirmKvaForToken(d.token, body(9500), ctx)).toMatchObject({ ok: true });
    expect((await annahme(d.id)).confirmed_total_cents).toBe(9500);
  });

  it("Altbestand mit Terminwahl: Termin wird an der Annahme mitgeschrieben, Schnappschuss ohne Wahl", async () => {
    const d = await deal();
    const q = await quotation(d.id, null, 850);
    await posten(q, [["other", "Montage", 1, 850]]);
    const t = await terminangebot(d.id, null, "2099-04-01", null, null, true);
    await terminWaehlen(d, t, "2099-04-01");
    const c = (await portal.loadContextByToken(d.token))!;
    expect(c.dateOffers.options[0]).not.toHaveProperty("priceCents");
    expect(c.dateOffers.options[0]).not.toHaveProperty("packagePrices");
    expect(await portal.confirmKvaForToken(d.token, body(85000), ctx)).toMatchObject({ ok: true });
    const a = await annahme(d.id);
    expect(a).toMatchObject({ confirmed_total_cents: 85000, selected_date_offer_id: t, selected_date: "2099-04-01" });
    expect(a.quotation_snapshot).not.toHaveProperty("wahl");
    expect(a.quotation_snapshot).not.toHaveProperty("angebotenePreise");
  });
});
