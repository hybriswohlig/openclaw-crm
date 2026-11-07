import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Plan 5b, Review Focus 4: ohne Paket- und Tagespreise (Firmen-Schalter aus,
 * Altbestand) bleibt jeder Portal-Kontext und jede Annahme exakt wie vor 5b.
 *
 * Die Snapshots in `__snapshots__/portal-altbestand.db.test.ts.snap` sind mit
 * dem Code VOR Task W (Basis f70e6a72) erzeugt. Ändert sich ein Kontext ohne
 * Plan-5-Preise, schlägt dieser Test fehl. Einzige gewollte Ausnahme: alte
 * Stunden-KVs tragen `stundenModell: "alt"` (F11), geprüft im eigenen Test.
 *
 * Läuft nur mit ANNAHME_TEST_DATABASE_URL (Wegwerf-DB mit Schema bis 0061).
 */
const url = process.env.ANNAHME_TEST_DATABASE_URL;

vi.mock("./agb", () => ({ ladeAgbHtml: async () => `<h1>AGB</h1>${"Text der AGB. ".repeat(60)}` }));
vi.mock("./activity-events", () => ({ emitEvent: async () => {} }));
vi.mock("./wartet", () => ({ aktualisiereWartet: async () => {}, aktualisiereWartetNachBesuch: async () => {} }));

/** Ersetzt zufällige IDs und Zeitstempel durch feste Namen, damit der Snapshot stabil ist. */
function normalisiert(wert: unknown, namen: Map<string, string>): unknown {
  return JSON.parse(
    JSON.stringify(wert, (_k, v) => {
      if (typeof v !== "string") return v;
      for (const [echt, name] of namen) if (v.includes(echt)) v = v.split(echt).join(name);
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) return "<zeit>";
      // Widerrufs-Vorbelegung nennt das Annahmedatum (heute).
      return v.replace(/angenommen am \d{1,2}\. \S+ \d{4}/, "angenommen am <datum>");
    })
  );
}

describe.skipIf(!url)("Portal ohne Plan-5-Preise wie vor 5b (DB)", { timeout: 20_000 }, () => {
  let sql: postgres.Sql;
  let portal: typeof import("./customer-portal-data");
  const ws = randomUUID();
  const obj = randomUUID();
  const namen = new Map<string, string>();

  /** Deal mit Link; gibt Token und Deal-ID zurück. */
  async function deal(name: string) {
    const id = randomUUID();
    const link = randomUUID();
    const token = randomUUID().replace(/-/g, "");
    namen.set(id, `<deal-${name}>`);
    // Ohne Auftragsnummer nimmt das Portal die ersten acht Zeichen der Deal-ID.
    namen.set(id.slice(0, 8), `<nr-${name}>`);
    namen.set(link, `<link-${name}>`);
    namen.set(token, `<token-${name}>`);
    await sql`insert into records (id, object_id) values (${id}, ${obj})`;
    await sql`insert into customer_status_links (id, workspace_id, deal_record_id, token) values (${link}, ${ws}, ${id}, ${token})`;
    return { id, token };
  }
  const neueId = (name: string) => {
    const id = randomUUID();
    namen.set(id, `<${name}>`);
    return id;
  };

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

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    sql = postgres(url!, { max: 3 });
    namen.set(ws, "<ws>");
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Test', ${`t-${ws}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${obj}, ${ws}, 'deals', 'Deal', 'Deals')`;
    portal = await import("./customer-portal-data");
  });

  afterAll(async () => {
    await sql`delete from workspaces where id = ${ws}`;
    await sql.end();
  });

  /** Pakete von Hand (ohne Version) und Termine ohne Preis, Kunde hat gewählt. */
  async function paketeUndTermine() {
    const d = await deal("pakete");
    const q = neueId("q-pakete");
    const basis = neueId("opt-basis");
    const komfort = neueId("opt-komfort");
    const t1 = neueId("tag-1");
    const t2 = neueId("tag-2");
    await sql`insert into quotations (id, deal_record_id, fixed_price, is_variable, service_type, deposit_required_cents, valid_until, summary)
      values (${q}, ${d.id}, '1290.00', false, 'kitchen_installation', 20000, '2099-01-31', 'Küche abbauen und neu aufbauen.')`;
    await sql`insert into quotation_line_items (id, quotation_id, type, description, quantity, unit_rate, sort_order)
      values (${neueId("li-1")}, ${q}, 'other', 'Küchenmontage', 1, '1100.00', 0), (${neueId("li-2")}, ${q}, 'other', 'Anfahrt', 1, '190.00', 1)`;
    await sql`insert into quotation_package_options (id, workspace_id, deal_record_id, catalogue_slug, display_name, price_cents, included_items, is_recommended, sort_order)
      values (${basis}, ${ws}, ${d.id}, 'basis', 'Basis', 99000, '["Abbau"]', false, 0),
             (${komfort}, ${ws}, ${d.id}, 'komfort', 'Komfort', 129000, '["Abbau","Aufbau"]', true, 1)`;
    await sql`update quotations set selected_package_option_id = ${komfort}, selected_package_slug = 'komfort' where id = ${q}`;
    await sql`insert into quotation_date_offers (id, workspace_id, deal_record_id, offer_date, slots, note, is_recommended, sort_order)
      values (${t1}, ${ws}, ${d.id}, '2099-03-05', '[{"label":"vormittags","startTime":"08:00","endTime":"12:00"}]', null, true, 0),
             (${t2}, ${ws}, ${d.id}, '2099-03-06', '[{"label":"ganztags","startTime":"08:00","endTime":"17:00"}]', 'Samstag', false, 1)`;
    await sql`insert into customer_date_selections (id, workspace_id, deal_record_id, customer_link_id, date_offer_id, selected_date, selected_slot_label, selected_slot_start, selected_slot_end)
      select ${neueId("sel")}, ${ws}, ${d.id}, id, ${t2}, '2099-03-06', 'ganztags', '08:00', '17:00' from customer_status_links where deal_record_id = ${d.id}`;
    return d;
  }

  /** Festpreis ohne Pakete und ohne Termine (Kalkulation 5a ohne Schalter sieht so aus). */
  async function festpreis() {
    const d = await deal("fest");
    const q = neueId("q-fest");
    await sql`insert into quotations (id, deal_record_id, fixed_price, is_variable, service_type)
      values (${q}, ${d.id}, '850.00', false, 'kitchen_installation')`;
    await sql`insert into quotation_line_items (id, quotation_id, type, description, quantity, unit_rate, sort_order)
      values (${neueId("li-f")}, ${q}, 'other', 'Montage', 1, '850.00', 0)`;
    return d;
  }

  /** Stunden-KV von Hand (Wizard-Vorgabe 2 Helfer × 35 €, Transporter 25 €). */
  async function stundenAlt() {
    const d = await deal("stunden");
    const q = neueId("q-stunden");
    await sql`insert into quotations (id, deal_record_id, fixed_price, is_variable, service_type)
      values (${q}, ${d.id}, null, true, 'kitchen_installation')`;
    await sql`insert into quotation_line_items (id, quotation_id, type, description, quantity, unit_rate, sort_order)
      values (${neueId("li-h")}, ${q}, 'helper', 'Helfer', 2, '35.00', 0), (${neueId("li-t")}, ${q}, 'transporter', 'Transporter', 1, '25.00', 1)`;
    return d;
  }

  it("Pakete von Hand und Termine ohne Preis: Kontext unverändert", async () => {
    const d = await paketeUndTermine();
    const c = await portal.loadContextByToken(d.token);
    expect(normalisiert(c, namen)).toMatchSnapshot();
  });

  it("Pakete von Hand: Annahme und gespeicherter Schnappschuss unverändert", async () => {
    const d = await paketeUndTermine();
    expect((await portal.confirmKvaForToken(d.token, body(129000), ctx)).ok).toBe(true);
    const zeilen = await sql`select quotation_snapshot, confirmed_total_cents, selected_option_id, selected_option_name, move_date, service_type, widerruf_modus
      from kva_confirmations where deal_record_id = ${d.id}`;
    expect(normalisiert(zeilen, namen)).toMatchSnapshot();
    // Nach der Annahme: Kontext mit Annahme.
    expect(normalisiert(await portal.loadContextByToken(d.token), namen)).toMatchSnapshot();
  });

  it("Festpreis ohne Pakete und Termine: Kontext und Annahme unverändert", async () => {
    const d = await festpreis();
    expect(normalisiert(await portal.loadContextByToken(d.token), namen)).toMatchSnapshot();
    expect((await portal.confirmKvaForToken(d.token, body(85000), ctx)).ok).toBe(true);
    const zeilen = await sql`select quotation_snapshot, confirmed_total_cents, selected_option_id, selected_option_name
      from kva_confirmations where deal_record_id = ${d.id}`;
    expect(normalisiert(zeilen, namen)).toMatchSnapshot();
  });

  it("Stunden-KV von Hand: Kontext bis auf stundenModell „alt“ unverändert, Annahmebetrag wie heute", async () => {
    const d = await stundenAlt();
    const c = await portal.loadContextByToken(d.token);
    const kva = c?.kva as (Record<string, unknown> & { stundenModell?: string }) | null | undefined;
    // F11: alte Stunden-KVs werden als Stundensatz gekennzeichnet; sonst nichts Neues.
    const { stundenModell, ...rest } = kva ?? {};
    expect(stundenModell === undefined || stundenModell === "alt").toBe(true);
    expect(normalisiert({ ...c, kva: rest }, namen)).toMatchSnapshot();
    expect((await portal.confirmKvaForToken(d.token, body(9500), ctx)).ok).toBe(true);
    const [z] = await sql`select confirmed_total_cents from kva_confirmations where deal_record_id = ${d.id}`;
    expect(z.confirmed_total_cents).toBe(9500);
  });
});
