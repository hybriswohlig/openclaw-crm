import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql as dsql } from "drizzle-orm";
import type { KvPosten } from "@/services/rechner/kv-posten";
import type { PaketpreisVersion, Tagespreis } from "@/lib/angebot-wahl";

/**
 * Plan 5b, Task T (Entscheidungen 8 und 13) gegen eine echte Postgres-DB:
 * Terminangebote je Datum aktualisieren (Kundenwahl bleibt), Wahl tauscht
 * Preis und Posten aus der gesperrten Version, alles unter `angebotSperren`
 * in einer Transaktion (SQL-Mitschnitt), Rennen gegen Annahme und Sperren.
 *
 * Läuft nur mit ANNAHME_TEST_DATABASE_URL (Wegwerf-DB mit Schema bis 0061,
 * z. B. postgres://postgres@127.0.0.1:54351/t5_t). Nie gegen eine echte DB.
 */
const url = process.env.ANNAHME_TEST_DATABASE_URL;

/** Mitschnitt aller Anweisungen über `@/db`: Verbindung und SQL. */
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
vi.mock("./agb", () => ({ ladeAgbHtml: async () => `<h1>AGB</h1>${"Text der AGB. ".repeat(60)}` }));
vi.mock("./activity-events", () => ({ emitEvent: async () => {} }));
vi.mock("./wartet", () => ({ aktualisiereWartet: async () => {}, aktualisiereWartetNachBesuch: async () => {} }));

const slots = [{ label: "Vormittag", startTime: "08:00", endTime: "12:00" }];
const posten = (...betraege: [string, number][]): KvPosten[] => betraege.map(([description, unitRate]) => ({ description, quantity: 1, unitRate }));
const paket = (slug: string, festpreis: number, p: KvPosten[]): PaketpreisVersion => ({ slug, festpreis, selbstkosten: festpreis * 0.6, margeProzent: 40, rundungEur: 10, kvItems: p });
const tag = (datum: string, festpreis: number, paketpreise: PaketpreisVersion[] | null, empfohlen = false): Tagespreis => ({
  datum,
  wochentag: "fr",
  feiertag: false,
  festpreis,
  rechnerFestpreis: festpreis,
  selbstkosten: festpreis * 0.6,
  margeProzent: 40,
  gruende: [{ text: "Wochenende", punkte: 5 }],
  uebersteuert: null,
  paketpreise,
  kvItems: posten(["Umzug", festpreis]),
  slots,
  note: null,
  empfohlen,
  vehicleBookingId: null,
});

describe.skipIf(!url)("Terminangebote und Kundenwahl unter der Angebots-Sperre (DB)", { timeout: 20_000 }, () => {
  let sql: postgres.Sql;
  let portal: typeof import("./customer-portal-data");
  let kundenwahl: typeof import("./kundenwahl");
  const ws = randomUUID();
  const objDeals = randomUUID();
  const objFirmen = randomUUID();
  const attrMove = randomUUID();
  const attrFirma = randomUUID();
  const deal = randomUUID();
  const firma = randomUUID();
  const link = randomUUID();
  const token = randomUUID().replace(/-/g, "");
  const ctx = { ipAddress: "203.0.113.5", userAgent: "test" };
  let v1 = "";
  let q1 = "";

  /** Version 1: Hauptpreis 1.000 €, Basis 900 €, Komfort 1.200 €; Fr 04.12. (empfohlen) und Sa 05.12. */
  const versionV1 = {
    priceCents: 100000,
    kvItems: posten(["Umzug", 1000]),
    packagePrices: [paket("basis", 900, posten(["Umzug", 900])), paket("komfort", 1200, posten(["Umzug", 1000], ["Halteverbot", 200]))],
    dayPrices: [
      tag("2026-12-04", 1100, [paket("basis", 990, posten(["Umzug", 990])), paket("komfort", 1320, posten(["Umzug", 1100], ["Halteverbot", 220]))], true),
      tag("2026-12-05", 1300, [paket("basis", 1170, posten(["Umzug", 1170])), paket("komfort", 1560, posten(["Umzug", 1300], ["Halteverbot", 260]))]),
    ],
  };

  async function versionAnlegen(nr: number, v: typeof versionV1) {
    const id = randomUUID();
    await sql`insert into deal_calculation_versions (id, workspace_id, deal_record_id, version, status, reference_date, price_cents, kv_items, package_prices, day_prices)
      values (${id}, ${ws}, ${deal}, ${nr}, 'gesperrt', '2026-11-07', ${v.priceCents}, ${sql.json(v.kvItems as never)}, ${sql.json(v.packagePrices as never)}, ${sql.json(v.dayPrices as never)})`;
    return id;
  }

  /** Wie das Sperren (Task K): Terminangebote je Datum aus der Version, dann Kundenwahl anwenden. */
  async function angeboteAusVersion(versionId: string, v: typeof versionV1, tx?: Parameters<typeof portal.terminangeboteSchreiben>[0]) {
    const { db } = await import("@/db");
    const lauf = async (t: Parameters<typeof portal.terminangeboteSchreiben>[0]) => {
      const { angebotSperren } = await import("./quotations");
      await angebotSperren(t, deal);
      await portal.terminangeboteSchreiben(t, {
        workspaceId: ws,
        dealRecordId: deal,
        createdBy: null,
        calculationVersionId: versionId,
        offers: v.dayPrices.map((d) => ({
          date: d.datum,
          slots: d.slots,
          note: d.note,
          isRecommended: d.empfohlen,
          priceCents: Math.round((d.festpreis ?? 0) * 100),
          packagePrices: Object.fromEntries((d.paketpreise ?? []).map((p) => [p.slug, Math.round((p.festpreis ?? 0) * 100)])),
        })),
      });
    };
    if (tx) return lauf(tx);
    await db.transaction(lauf);
  }

  async function optionenAusVersion(versionId: string | null) {
    const basis = randomUUID();
    const komfort = randomUUID();
    await sql`insert into quotation_package_options (id, workspace_id, deal_record_id, catalogue_slug, display_name, price_cents, is_recommended, sort_order, calculation_version_id)
      values (${basis}, ${ws}, ${deal}, 'basis', 'Basis', 90000, false, 0, ${versionId}), (${komfort}, ${ws}, ${deal}, 'komfort', 'Komfort', 120000, true, 1, ${versionId})`;
    return { basis, komfort };
  }

  const angebote = async () =>
    sql`select id, offer_date::text as datum, price_cents, package_prices, calculation_version_id, slots from quotation_date_offers where deal_record_id = ${deal} order by sort_order`;
  const wahl = async () =>
    (await sql`select date_offer_id, selected_date::text as datum from customer_date_selections where deal_record_id = ${deal}`)[0] ?? null;
  const quotation = async () =>
    (await sql`select fixed_price, calculation_version_id, selected_package_option_id, selected_package_slug from quotations where deal_record_id = ${deal}`)[0];
  const postenDerQuotation = async () =>
    (await sql`select description, quantity, unit_rate from quotation_line_items where quotation_id = ${q1} order by sort_order`).map((r) => ({
      description: r.description,
      quantity: r.quantity,
      unitRate: Number(r.unit_rate),
    }));
  const vonHand = (...daten: string[]) =>
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
  const kvPdf = async (versionId: string) => {
    const id = randomUUID();
    await sql`insert into deal_documents (id, workspace_id, deal_record_id, document_type, file_name, file_size, mime_type, file_content, calculation_version_id)
      values (${id}, ${ws}, ${deal}, 'quotation', 'KV.pdf', 10, 'application/pdf', ${Buffer.from(`%PDF ${id}`).toString("base64")}, ${versionId})`;
  };
  const annehmen = (expectedTotalCents: number) =>
    portal.confirmKvaForToken(
      token,
      { acceptedOffer: true, acceptedAgb: true, haftungshinweisBestaetigt: false, versicherungGewuenscht: false, vorzeitigerBeginnVerlangt: false, expectedTotalCents, fullName: "Anna Muster" },
      ctx
    );

  /** Hält die Deal-Sperre über eine eigene Verbindung, bis `frei()`. */
  async function tor() {
    let frei!: () => void;
    const offen = new Promise<void>((r) => (frei = r));
    let gehalten!: () => void;
    const haelt = new Promise<void>((r) => (gehalten = r));
    const fertig = sql.begin(async (t) => {
      await t.unsafe("select pg_advisory_xact_lock(hashtext('angebot:' || $1::text))", [deal]);
      gehalten();
      await offen;
    });
    await haelt;
    return { frei: async () => (frei(), await fertig) };
  }
  async function wartende(n: number) {
    for (let i = 0; i < 300; i++) {
      const [{ c }] = await sql`select count(*)::int as c from pg_locks where locktype = 'advisory' and not granted`;
      if (c >= n) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`nicht ${n} Wartende`);
  }
  /** `erst` und `dann` warten in dieser Reihenfolge auf die Sperre; Postgres vergibt sie so. */
  async function rennen<A, B>(erst: () => Promise<A>, dann: () => Promise<B>) {
    const t = await tor();
    const laeufe: Promise<unknown>[] = [];
    try {
      laeufe.push(erst());
      await wartende(1);
      laeufe.push(dann());
      await wartende(2);
    } finally {
      await t.frei();
    }
    return Promise.allSettled(laeufe) as Promise<[PromiseSettledResult<Awaited<A>>, PromiseSettledResult<Awaited<B>>]>;
  }

  beforeAll(async () => {
    sql = postgres(url!, { max: 3 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Test', ${`t-${ws}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${objDeals}, ${ws}, 'deals', 'Deal', 'Deals'), (${objFirmen}, ${ws}, 'firmen', 'Firma', 'Firmen')`;
    await sql`insert into attributes (id, object_id, slug, title, type) values (${attrMove}, ${objDeals}, 'move_date', 'Umzugstermin', 'date'), (${attrFirma}, ${objDeals}, 'operating_company', 'Firma', 'record_reference')`;
    await sql`insert into records (id, object_id) values (${deal}, ${objDeals}), (${firma}, ${objFirmen})`;
    await sql`insert into customer_status_links (id, workspace_id, deal_record_id, token) values (${link}, ${ws}, ${deal}, ${token})`;
    await sql`insert into offer_packages (id, workspace_id, operating_company_record_id, slug, display_name, price_fixed_flag, price_from_cents)
      values (${randomUUID()}, ${ws}, ${firma}, 'basis', 'Basis', true, 50000), (${randomUUID()}, ${ws}, ${firma}, 'komfort', 'Komfort', true, 70000)`;
    portal = await import("./customer-portal-data");
    kundenwahl = await import("./kundenwahl");
  });

  beforeEach(async () => {
    for (const t of ["kva_confirmations", "deal_documents", "customer_date_selections", "quotation_date_offers", "quotation_package_options", "quotations", "deal_calculation_versions"]) {
      await sql.unsafe(`delete from ${t} where deal_record_id = $1`, [deal]);
    }
    await sql`delete from record_values where record_id = ${deal}`;
    await sql`insert into record_values (id, record_id, attribute_id, referenced_record_id) values (${randomUUID()}, ${deal}, ${attrFirma}, ${firma})`;
    q1 = randomUUID();
    // Küchenmontage: die Annahme braucht keinen Umzugstermin (nur die offene Terminwahl zählt).
    await sql`insert into quotations (id, deal_record_id, fixed_price, is_variable, service_type) values (${q1}, ${deal}, '1000.00', false, 'kitchen_installation')`;
    mitschnitt.zeilen.length = 0;
  });

  afterAll(async () => {
    await sql`delete from workspaces where id = ${ws}`;
    await sql.end();
  });

  // ─── Entscheidung 13: je Datum aktualisieren ─────────────────────────────

  it("Upsert je Datum: ein weiter angebotener Tag behält ID und Kundenwahl (F18)", async () => {
    await vonHand("2026-12-04", "2026-12-05");
    const vorher = await angebote();
    expect(await waehleTag("2026-12-05")).toEqual({ ok: true });

    // Büro speichert erneut: 04.12. raus, 05.12. bleibt (neues Zeitfenster), 06.12. neu.
    expect(
      await portal.replaceDateOffers({
        workspaceId: ws,
        dealRecordId: deal,
        createdBy: null,
        offers: [
          { date: "2026-12-05", slots: [{ label: "Ganztags", startTime: "08:00", endTime: "17:00" }], note: "Sa", isRecommended: true },
          { date: "2026-12-06", slots, note: null, isRecommended: false },
        ],
      })
    ).toEqual({ count: 2 });
    const nachher = await angebote();
    expect(nachher.map((a) => a.datum)).toEqual(["2026-12-05", "2026-12-06"]);
    expect(nachher[0].id).toBe(vorher.find((a) => a.datum === "2026-12-05")!.id);
    expect(nachher[0].slots).toEqual([{ label: "Ganztags", startTime: "08:00", endTime: "17:00" }]);
    expect(await wahl()).toEqual({ date_offer_id: nachher[0].id, datum: "2026-12-05" });
    // Von Hand: nie ein Preis, nie ein Versionsbezug; die Quotation bleibt.
    expect(nachher.every((a) => a.price_cents === null && a.package_prices === null && a.calculation_version_id === null)).toBe(true);
    expect((await quotation()).fixed_price).toBe("1000.00");
  });

  it("ein entfernter Tag löscht die Wahl darauf", async () => {
    await vonHand("2026-12-04", "2026-12-05");
    expect(await waehleTag("2026-12-04")).toEqual({ ok: true });
    await vonHand("2026-12-05");
    expect(await wahl()).toBeNull();
    expect((await angebote()).map((a) => a.datum)).toEqual(["2026-12-05"]);
  });

  it("doppelte Daten: das erste gilt; Altbestand mit doppeltem Tag behält die Zeile der Kundenwahl", async () => {
    await vonHand("2026-12-04");
    const [erste] = await angebote();
    await sql`insert into quotation_date_offers (id, workspace_id, deal_record_id, offer_date, slots, sort_order) values (${randomUUID()}, ${ws}, ${deal}, '2026-12-04', ${sql.json(slots)}, 1)`;
    const [, zweite] = await angebote();
    expect(await portal.selectDateOffer(token, { dateOfferId: zweite.id, slotIndex: 0 }, ctx)).toEqual({ ok: true });
    expect(await vonHand("2026-12-04", "2026-12-04")).toEqual({ count: 1 });
    const rest = await angebote();
    expect(rest.map((a) => a.id)).toEqual([zweite.id]);
    expect(rest[0].id).not.toBe(erste.id);
    expect((await wahl())?.date_offer_id).toBe(zweite.id);
  });

  it("SQL-Mitschnitt: Lesen und Schreiben in einer Transaktion nach angebotSperren, alles auf einer Verbindung", async () => {
    await vonHand("2026-12-04", "2026-12-05");
    mitschnitt.zeilen.length = 0;
    await vonHand("2026-12-05", "2026-12-06");
    const z = mitschnitt.zeilen;
    const sperre = z.findIndex((e) => e.sql.includes("pg_advisory_xact_lock"));
    expect(sperre).toBeGreaterThan(0);
    const conn = z[sperre].conn;
    const begin = z.findIndex((e, i) => i < sperre && e.conn === conn && /^begin/i.test(e.sql.trim()));
    const commit = z.findIndex((e, i) => i > sperre && e.conn === conn && /^commit/i.test(e.sql.trim()));
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(begin).toBe(z.map((e) => e.conn === conn).lastIndexOf(true, sperre - 1));
    expect(commit).toBeGreaterThan(sperre);
    const schreibend = z
      .map((e, i) => ({ ...e, i }))
      .filter((e) => /^(insert|update|delete)/i.test(e.sql.trim()) && /quotation_date_offers|customer_date_selections/.test(e.sql));
    expect(schreibend.length).toBeGreaterThan(0);
    for (const s of schreibend) {
      expect(s.conn).toBe(conn);
      expect(s.i).toBeGreaterThan(sperre);
      expect(s.i).toBeLessThan(commit);
    }
    // Zwischen Sperre und Commit läuft keine Anweisung über eine andere Verbindung des Pools.
    expect(z.slice(sperre, commit).every((e) => e.conn === conn)).toBe(true);
  });

  it("SQL-Mitschnitt: die Terminwahl mit Version schreibt Wahl, Termin, Preis und Posten unter derselben Sperre", async () => {
    v1 = await versionAnlegen(1, versionV1);
    await sql`update quotations set calculation_version_id = ${v1} where id = ${q1}`;
    await angeboteAusVersion(v1, versionV1);
    mitschnitt.zeilen.length = 0;
    expect(await waehleTag("2026-12-05")).toEqual({ ok: true });
    const z = mitschnitt.zeilen;
    const sperre = z.findIndex((e) => e.sql.includes("pg_advisory_xact_lock"));
    const conn = z[sperre].conn;
    const commit = z.findIndex((e, i) => i > sperre && e.conn === conn && /^commit/i.test(e.sql.trim()));
    const schreibend = z
      .map((e, i) => ({ ...e, i }))
      .filter((e) => /^(insert|update|delete)/i.test(e.sql.trim()));
    expect(schreibend.map((s) => s.sql.match(/(?:into|update|from)\s+"(\w+)"/i)?.[1])).toEqual(
      expect.arrayContaining(["customer_date_selections", "record_values", "quotations", "quotation_line_items"])
    );
    for (const s of schreibend) expect(s.conn === conn && s.i > sperre && s.i < commit).toBe(true);
    expect(z.slice(sperre, commit).every((e) => e.conn === conn)).toBe(true);
  });

  it("alter Weg von Hand bei Angeboten aus einer Version, Firma mit Tagespreisen: TermineMitPreisError, nichts geändert", async () => {
    await sql`insert into operating_company_portal_settings (operating_company_record_id, workspace_id, angebot_aus_kalkulation, tagespreise_enabled)
      values (${firma}, ${ws}, true, true)`;
    try {
      v1 = await versionAnlegen(1, versionV1);
      await sql`update quotations set calculation_version_id = ${v1} where id = ${q1}`;
      await angeboteAusVersion(v1, versionV1);
      const vorher = await angebote();
      await expect(vonHand("2026-12-06")).rejects.toBeInstanceOf(portal.TermineMitPreisError);
      await expect(vonHand()).rejects.toMatchObject({ code: "TERMINE_MIT_PREIS", message: "Termine mit Preis bitte im Termin-Dialog ändern." });
      expect(await angebote()).toEqual(vorher);
    } finally {
      await sql`delete from operating_company_portal_settings where operating_company_record_id = ${firma}`;
    }
  });

  it("F2 (I6): ohne Schalter ersetzt der alte Weg die Termine und löst den Versionsbezug; DELETE leert", async () => {
    // Schalter wieder aus: Zeile mit beiden Schaltern aus (wie nach dem Abschalten).
    await sql`insert into operating_company_portal_settings (operating_company_record_id, workspace_id, angebot_aus_kalkulation, tagespreise_enabled)
      values (${firma}, ${ws}, false, false)`;
    try {
      v1 = await versionAnlegen(1, versionV1);
      await sql`update quotations set calculation_version_id = ${v1} where id = ${q1}`;
      await angeboteAusVersion(v1, versionV1);
      const vorher = await angebote();
      expect(await waehleTag("2026-12-05")).toEqual({ ok: true });
      expect(await vonHand("2026-12-05", "2026-12-06")).toEqual({ count: 2 });
      const nachher = await angebote();
      expect(nachher.map((a) => [a.datum, a.price_cents, a.package_prices, a.calculation_version_id])).toEqual([
        ["2026-12-05", null, null, null],
        ["2026-12-06", null, null, null],
      ]);
      // Der weiter angebotene Tag behält ID und Kundenwahl.
      expect(nachher[0].id).toBe(vorher.find((a) => a.datum === "2026-12-05")!.id);
      expect(await wahl()).toEqual({ date_offer_id: nachher[0].id, datum: "2026-12-05" });
      // Das Portal zeigt an ungebundenen Terminen keine Preise mehr.
      const c = (await portal.loadContextByToken(token))!;
      expect(c.dateOffers.options.every((o) => (o as { priceCents?: unknown }).priceCents === undefined)).toBe(true);
      // DELETE (leere Liste) wie früher.
      expect(await vonHand()).toEqual({ count: 0 });
      expect(await angebote()).toEqual([]);
    } finally {
      await sql`delete from operating_company_portal_settings where operating_company_record_id = ${firma}`;
    }
  });

  it("Angebote aus der Version: Preis, Paketpreise und Bezug je Tag; erneutes Sperren hält IDs und Wahl", async () => {
    v1 = await versionAnlegen(1, versionV1);
    await sql`update quotations set calculation_version_id = ${v1} where id = ${q1}`;
    await angeboteAusVersion(v1, versionV1);
    const a = await angebote();
    expect(a.map((x) => [x.datum, x.price_cents, x.package_prices, x.calculation_version_id])).toEqual([
      ["2026-12-04", 110000, { basis: 99000, komfort: 132000 }, v1],
      ["2026-12-05", 130000, { basis: 117000, komfort: 156000 }, v1],
    ]);
    expect(await waehleTag("2026-12-05")).toEqual({ ok: true });

    // Neue Version mit anderem Preis am 05.12. und ohne den 04.12.: ID und Wahl am 05.12. bleiben.
    const v2Daten = { ...versionV1, dayPrices: [tag("2026-12-05", 1400, null, true)], packagePrices: [] };
    const v2 = await versionAnlegen(2, v2Daten);
    const { db } = await import("@/db");
    await db.transaction(async (tx) => {
      await angeboteAusVersion(v2, v2Daten, tx);
      await tx.execute(dsql`update quotations set calculation_version_id = ${v2} where id = ${q1}`);
      expect(await kundenwahl.kundenwahlAnwenden(tx, deal)).toBe("geschrieben");
    });
    const b = await angebote();
    expect(b.map((x) => [x.id, x.price_cents, x.calculation_version_id])).toEqual([[a[1].id, 140000, v2]]);
    expect(await wahl()).toEqual({ date_offer_id: a[1].id, datum: "2026-12-05" });
    expect((await quotation()).fixed_price).toBe("1400.00");
  });

  // ─── Entscheidung 8: Wahl tauscht Preis und Posten ──────────────────────

  it("Terminwahl, Paketwahl und Standardwahl tauschen Preis und Posten aus der Version, ohne neue Version", async () => {
    v1 = await versionAnlegen(1, versionV1);
    const o = await optionenAusVersion(v1);
    await sql`update quotations set calculation_version_id = ${v1}, selected_package_option_id = ${o.komfort}, selected_package_slug = 'komfort' where id = ${q1}`;
    await angeboteAusVersion(v1, versionV1);

    // Tag: Komfort am Sa 05.12.
    expect(await waehleTag("2026-12-05")).toEqual({ ok: true });
    expect(await quotation()).toEqual({ fixed_price: "1560.00", calculation_version_id: v1, selected_package_option_id: o.komfort, selected_package_slug: "komfort" });
    expect(await postenDerQuotation()).toEqual(posten(["Umzug", 1300], ["Halteverbot", 260]));

    // Paket: Basis am gewählten Tag.
    expect(await portal.selectDealPackageOptionForToken(token, { optionId: o.basis }, ctx)).toEqual({ ok: true });
    expect(await quotation()).toEqual({ fixed_price: "1170.00", calculation_version_id: v1, selected_package_option_id: o.basis, selected_package_slug: "basis" });
    expect(await postenDerQuotation()).toEqual(posten(["Umzug", 1170]));

    // Katalog-Klick auf ein gebundenes Paket: Preis aus der Version, nie der Katalogpreis.
    expect(await portal.selectPackageForToken(token, { slug: "komfort" }, ctx)).toEqual({ ok: true });
    expect(await quotation()).toMatchObject({ fixed_price: "1560.00", selected_package_option_id: o.komfort });

    // Standardwahl ohne gebundene Option: empfohlene Option (Komfort) am gewählten Tag.
    await sql`update quotations set selected_package_option_id = null, fixed_price = '0.00' where id = ${q1}`;
    await portal.ensureDefaultPackageSelection(deal);
    expect(await quotation()).toMatchObject({ fixed_price: "1560.00", selected_package_option_id: o.komfort, calculation_version_id: v1 });
    expect(await postenDerQuotation()).toEqual(posten(["Umzug", 1300], ["Halteverbot", 260]));

    // Ohne Kundenwahl gilt der empfohlene Tag (Fr 04.12.).
    await sql`delete from customer_date_selections where deal_record_id = ${deal}`;
    expect(await portal.selectDealPackageOptionForToken(token, { optionId: o.basis }, ctx)).toEqual({ ok: true });
    expect((await quotation()).fixed_price).toBe("990.00");

    // Ein zweiter Portal-Aufruf schreibt nichts, wenn die Wahl schon gebunden ist.
    mitschnitt.zeilen.length = 0;
    await portal.ensureDefaultPackageSelection(deal);
    expect(mitschnitt.zeilen.some((e) => /^(insert|update|delete)/i.test(e.sql.trim()))).toBe(false);

    const [{ n }] = await sql`select count(*)::int as n from deal_calculation_versions where deal_record_id = ${deal}`;
    expect(n).toBe(1);
  });

  it("ohne Bezug zur Version (von Hand) bleibt alles wie heute: Optionspreis, Termin ohne Preis", async () => {
    v1 = await versionAnlegen(1, versionV1);
    const o = await optionenAusVersion(null);
    await sql`update quotations set calculation_version_id = ${v1} where id = ${q1}`;
    await vonHand("2026-12-05");
    expect(await waehleTag("2026-12-05")).toEqual({ ok: true });
    expect((await quotation()).fixed_price).toBe("1000.00");
    expect(await portal.selectDealPackageOptionForToken(token, { optionId: o.basis }, ctx)).toEqual({ ok: true });
    expect((await quotation()).fixed_price).toBe("900.00");
    expect(await portal.selectPackageForToken(token, { slug: "komfort" }, ctx)).toEqual({ ok: true });
  });

  it("Portal-Kontext: Preis je Termin additiv, keine internen Zahlen", async () => {
    v1 = await versionAnlegen(1, versionV1);
    await sql`update quotations set calculation_version_id = ${v1} where id = ${q1}`;
    await angeboteAusVersion(v1, versionV1);
    const c = await portal.loadContextByToken(token);
    expect(c?.dateOffers.options.map((o) => [o.date, (o as { priceCents?: number }).priceCents, (o as { packagePrices?: unknown }).packagePrices])).toEqual([
      ["2026-12-04", 110000, { basis: 99000, komfort: 132000 }],
      ["2026-12-05", 130000, { basis: 117000, komfort: 156000 }],
    ]);
    const json = JSON.stringify(c?.dateOffers);
    for (const intern of ["selbstkosten", "margeProzent", "gruende", "Wochenende", "rechnerFestpreis"]) expect(json).not.toContain(intern);

    // Von Hand (ohne Version): Kontext genau wie vor 5b, ohne Preisfelder.
    await sql`update quotations set calculation_version_id = null where id = ${q1}`;
    const alt = await portal.loadContextByToken(token);
    expect(alt?.dateOffers.options.every((o) => !("priceCents" in o) && !("packagePrices" in o))).toBe(true);
  });

  // ─── Rennen ─────────────────────────────────────────────────────────────

  it("Annahme zuerst, dann Terminwahl: already_accepted, Preis und Wahl bleiben", async () => {
    v1 = await versionAnlegen(1, versionV1);
    await sql`update quotations set calculation_version_id = ${v1} where id = ${q1}`;
    await angeboteAusVersion(v1, { ...versionV1, packagePrices: [] });
    expect(await waehleTag("2026-12-04")).toEqual({ ok: true });
    await kvPdf(v1);
    const [ar, wr] = await rennen(() => annehmen(110000), () => waehleTag("2026-12-05"));
    expect(ar).toMatchObject({ status: "fulfilled", value: { ok: true } });
    expect(wr).toEqual({ status: "fulfilled", value: { ok: false, reason: "already_accepted" } });
    expect((await quotation()).fixed_price).toBe("1100.00");
    expect((await wahl())?.datum).toBe("2026-12-04");
    // Auch danach schreibt keine Wahl mehr.
    expect(await waehleTag("2026-12-05")).toEqual({ ok: false, reason: "already_accepted" });
    await portal.ensureDefaultPackageSelection(deal);
    expect((await quotation()).fixed_price).toBe("1100.00");
  });

  it("Terminwahl zuerst, dann Annahme mit altem Preis: price_changed, nichts angenommen", async () => {
    v1 = await versionAnlegen(1, versionV1);
    await sql`update quotations set calculation_version_id = ${v1} where id = ${q1}`;
    await angeboteAusVersion(v1, { ...versionV1, packagePrices: [] });
    expect(await waehleTag("2026-12-04")).toEqual({ ok: true });
    await kvPdf(v1);
    const [wr, ar] = await rennen(() => waehleTag("2026-12-05"), () => annehmen(110000));
    expect(wr).toEqual({ status: "fulfilled", value: { ok: true } });
    expect(ar).toEqual({ status: "fulfilled", value: { ok: false, reason: "price_changed" } });
    expect((await quotation()).fixed_price).toBe("1300.00");
    const [{ n }] = await sql`select count(*)::int as n from kva_confirmations where deal_record_id = ${deal}`;
    expect(n).toBe(0);
  });

  it("Sperren zuerst, dann Terminwahl: die Wahl nimmt den Preis der neuen Version", async () => {
    v1 = await versionAnlegen(1, versionV1);
    await sql`update quotations set calculation_version_id = ${v1} where id = ${q1}`;
    await angeboteAusVersion(v1, versionV1);
    const v2Daten = { ...versionV1, packagePrices: [], dayPrices: [tag("2026-12-04", 1000, null, true), tag("2026-12-05", 1250, null)] };
    const v2 = await versionAnlegen(2, v2Daten);
    const { db } = await import("@/db");
    const sperrenV2 = () =>
      db.transaction(async (tx) => {
        await angeboteAusVersion(v2, v2Daten, tx);
        await tx.execute(dsql`update quotations set calculation_version_id = ${v2}, fixed_price = '1000.00' where id = ${q1}`);
        await kundenwahl.kundenwahlAnwenden(tx, deal);
      });
    const [sr, wr] = await rennen(sperrenV2, () => waehleTag("2026-12-05"));
    expect(sr.status).toBe("fulfilled");
    expect(wr).toEqual({ status: "fulfilled", value: { ok: true } });
    expect(await quotation()).toMatchObject({ fixed_price: "1250.00", calculation_version_id: v2 });
    expect(await postenDerQuotation()).toEqual(posten(["Umzug", 1250]));
  });

  it("Terminwahl zuerst, dann Sperren: die erhaltene Wahl behält ihren Tag, Preis aus der neuen Version", async () => {
    v1 = await versionAnlegen(1, versionV1);
    await sql`update quotations set calculation_version_id = ${v1} where id = ${q1}`;
    await angeboteAusVersion(v1, versionV1);
    const v2Daten = { ...versionV1, packagePrices: [], dayPrices: [tag("2026-12-04", 1000, null, true), tag("2026-12-05", 1250, null)] };
    const v2 = await versionAnlegen(2, v2Daten);
    const { db } = await import("@/db");
    const sperrenV2 = () =>
      db.transaction(async (tx) => {
        await angeboteAusVersion(v2, v2Daten, tx);
        await tx.execute(dsql`update quotations set calculation_version_id = ${v2}, fixed_price = '1000.00' where id = ${q1}`);
        await kundenwahl.kundenwahlAnwenden(tx, deal);
      });
    const [wr, sr] = await rennen(() => waehleTag("2026-12-05"), sperrenV2);
    expect(wr).toEqual({ status: "fulfilled", value: { ok: true } });
    expect(sr.status).toBe("fulfilled");
    expect((await wahl())?.datum).toBe("2026-12-05");
    expect(await quotation()).toMatchObject({ fixed_price: "1250.00", calculation_version_id: v2 });
  });
});
