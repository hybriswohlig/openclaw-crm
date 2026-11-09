import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `ladeUebersicht` gegen eine Wegwerf-Datenbank (Schema aktuell, UTC).
 * Läuft nur mit UEBERSICHT_TEST_DATABASE_URL. `ladeKasse` und
 * `ladeNavZaehler` sind echt. Beide Clients werden geschlossen.
 */
const url = process.env.UEBERSICHT_TEST_DATABASE_URL;

const held = vi.hoisted(() => ({
  client: null as { end: (opts?: { timeout?: number }) => Promise<void> } | null,
}));

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.UEBERSICHT_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 1 });
  held.client = client;
  return { db: drizzle(client, { schema }) };
});

import { getFinancialOverview } from "./financial";
import { navZaehlerCacheLeeren } from "./heute";
import { kasseZaehlerCacheLeeren } from "./kasse";
import { ladeUebersicht, uebersichtCacheLeeren } from "./uebersicht";

async function clientSchliessen(): Promise<void> {
  const client = held.client;
  held.client = null;
  await client?.end({ timeout: 5 });
}

afterAll(async () => {
  await clientSchliessen();
});

/** 8.11.2026, 12:00 Berlin. Fenster: 2025-12 bis 2026-11. */
const JETZT = new Date("2026-11-08T11:00:00.000Z");

describe.skipIf(!url)("ladeUebersicht gegen Postgres", () => {
  let sql: postgres.Sql | undefined;
  const ws = randomUUID();
  const wsFremd = randomUUID();
  const O = { deals: randomUUID(), oc: randomUUID(), fremdDeals: randomUUID(), fremdOc: randomUUID() };
  const A = {
    name: randomUUID(),
    stage: randomUUID(),
    firma: randomUUID(),
    quelle: randomUUID(),
    move: randomUUID(),
    fertig: randomUUID(),
    ocName: randomUUID(),
    fremdStage: randomUUID(),
    fremdFirma: randomUUID(),
    fremdName: randomUUID(),
  };
  const S = {
    neu: randomUUID(),
    angebot: randomUUID(),
    durch: randomUUID(),
    bezahlt: randomUUID(),
    verloren: randomUUID(),
    fremdAngebot: randomUUID(),
  };
  const quelleTelefon = randomUUID();
  const ocA = randomUUID();
  const ocB = randomUUID();
  const ocFremd = randomUUID();
  const deals = {
    rechnung: randomUUID(),
    annahme: randomUUID(),
    festpreis: randomUUID(),
    stunden: randomUUID(),
    offen: randomUUID(),
    verloren: randomUUID(),
    geloescht: randomUUID(),
    alt: randomUUID(),
    fremd: randomUUID(),
  };

  beforeAll(async () => {
    sql = postgres(url!, { max: 1 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Uebersicht Test', ${`u-${ws}`})`;
    await sql`insert into workspaces (id, name, slug) values (${wsFremd}, 'Fremd', ${`f-${wsFremd}`})`;
    await sql`
      insert into objects (id, workspace_id, slug, singular_name, plural_name) values
        (${O.deals}, ${ws}, 'deals', 'Deal', 'Deals'),
        (${O.oc}, ${ws}, 'operating_companies', 'Firma', 'Firmen'),
        (${O.fremdDeals}, ${wsFremd}, 'deals', 'Deal', 'Deals'),
        (${O.fremdOc}, ${wsFremd}, 'operating_companies', 'Firma', 'Firmen')
    `;
    await sql`
      insert into attributes (id, object_id, slug, title, type) values
        (${A.name}, ${O.deals}, 'name', 'Name', 'text'),
        (${A.stage}, ${O.deals}, 'stage', 'Stufe', 'status'),
        (${A.firma}, ${O.deals}, 'operating_company', 'Firma', 'record_reference'),
        (${A.quelle}, ${O.deals}, 'source_channel', 'Quelle', 'select'),
        (${A.move}, ${O.deals}, 'move_date', 'Umzug', 'date'),
        (${A.fertig}, ${O.deals}, 'move_completed_at', 'Durchgeführt am', 'timestamp'),
        (${A.ocName}, ${O.oc}, 'name', 'Name', 'text'),
        (${A.fremdStage}, ${O.fremdDeals}, 'stage', 'Stufe', 'status'),
        (${A.fremdFirma}, ${O.fremdDeals}, 'operating_company', 'Firma', 'record_reference'),
        (${A.fremdName}, ${O.fremdOc}, 'name', 'Name', 'text')
    `;
    await sql`
      insert into statuses (id, attribute_id, title, stage_category, sort_order) values
        (${S.neu}, ${A.stage}, 'Neue Anfrage', 'open_new', 0),
        (${S.angebot}, ${A.stage}, 'Angebot', 'quoted', 1),
        (${S.durch}, ${A.stage}, 'Durchgeführt', 'done_unpaid', 2),
        (${S.bezahlt}, ${A.stage}, 'Bezahlt', 'paid', 3),
        (${S.verloren}, ${A.stage}, 'Verloren', 'lost', 4),
        (${S.fremdAngebot}, ${A.fremdStage}, 'Angebot', 'quoted', 0)
    `;
    await sql`insert into select_options (id, attribute_id, title) values (${quelleTelefon}, ${A.quelle}, 'Telefon')`;

    await sql`insert into records (id, object_id) values (${ocA}, ${O.oc}), (${ocB}, ${O.oc}), (${ocFremd}, ${O.fremdOc})`;
    await text(ocA, A.ocName, "Alpha Umzüge");
    await text(ocB, A.ocName, "Beta Transporte");
    await text(ocFremd, A.fremdName, "Fremde Firma");

    await deal(deals.rechnung, {
      name: "Rechnung",
      stage: S.bezahlt,
      at: "2026-09-15T10:00:00.000Z",
      firma: ocA,
      fertig: "2026-10-31 23:30:00",
    });
    await sql`
      insert into deal_invoices (id, workspace_id, deal_record_id, herkunft, status, brutto_cent, rechnungstag, faellig_am, nummer)
      values (${randomUUID()}, ${ws}, ${deals.rechnung}, 'crm', 'gestellt', 150000, '2026-11-01', '2026-11-15', 'RE-P13-1')
    `;

    await deal(deals.annahme, {
      name: "Annahme",
      stage: S.durch,
      at: "2026-08-15T10:00:00.000Z",
      firma: ocB,
      move: "2026-10-15",
    });
    const link = randomUUID();
    await sql`
      insert into customer_status_links (id, workspace_id, deal_record_id, token)
      values (${link}, ${ws}, ${deals.annahme}, ${randomUUID()})
    `;
    await sql`
      insert into kva_confirmations (
        id, workspace_id, deal_record_id, customer_link_id, quotation_snapshot,
        confirmed_total_cents, agb_version_accepted, ip_address, user_agent
      ) values (
        ${randomUUID()}, ${ws}, ${deals.annahme}, ${link}, ${sql.json({ test: true })},
        80000, 'test', '127.0.0.1', 'vitest'
      )
    `;

    await deal(deals.festpreis, {
      name: "Festpreis",
      stage: S.durch,
      at: "2026-07-15T10:00:00.000Z",
      firma: ocA,
      move: "2026-10-20",
    });
    await sql`
      insert into quotations (id, deal_record_id, fixed_price, is_variable)
      values (${randomUUID()}, ${deals.festpreis}, '1200.00', false)
    `;

    await deal(deals.stunden, {
      name: "Stunden",
      stage: S.durch,
      at: "2026-06-15T10:00:00.000Z",
      firma: ocB,
      move: "2026-11-02",
    });
    await sql`
      insert into quotations (id, deal_record_id, fixed_price, is_variable)
      values (${randomUUID()}, ${deals.stunden}, '999.00', true)
    `;

    await deal(deals.offen, {
      name: "Offen",
      stage: S.angebot,
      at: "2026-11-05T10:00:00.000Z",
      firma: ocA,
      quelle: quelleTelefon,
      move: "2026-11-20",
    });
    await sql`insert into deal_workflow_state (record_id, waiting_on) values (${deals.offen}, 'uns')`;

    await deal(deals.verloren, {
      name: "Verloren",
      stage: S.verloren,
      at: "2026-11-04T10:00:00.000Z",
      firma: ocA,
    });

    await deal(deals.geloescht, {
      name: "Gelöscht",
      stage: S.angebot,
      at: "2026-11-03T10:00:00.000Z",
      firma: ocA,
      deleted: true,
    });

    await deal(deals.alt, {
      name: "Altzahlung",
      stage: S.neu,
      at: "2026-05-15T10:00:00.000Z",
      firma: ocA,
    });

    await zahlung({ deal: deals.offen, date: "2026-11-02", amount: "1000.00", tax: "betriebseinnahme", firma: ocA });
    await zahlung({ deal: deals.offen, date: "2026-11-02", amount: "200.00", tax: "nicht_steuerbar", firma: ocA });
    await zahlung({ deal: deals.offen, date: "2026-11-03", amount: "-150.50", tax: "betriebseinnahme", firma: ocA });
    await zahlung({ deal: null, date: "2026-11-06", amount: "80.00", tax: "betriebseinnahme", firma: ocB });
    await zahlung({ deal: deals.alt, date: "2026-11-04", amount: "40.00", tax: "betriebseinnahme", firma: null });
    await zahlung({ deal: deals.alt, date: "2025-12-10", amount: "10.00", tax: "betriebseinnahme", firma: ocA });

    await sql`
      insert into records (id, object_id, created_at) values (${deals.fremd}, ${O.fremdDeals}, '2026-11-05T10:00:00.000Z')
    `;
    await text(deals.fremd, A.fremdStage, S.fremdAngebot);
    await ref(deals.fremd, A.fremdFirma, ocFremd);
    await zahlung({
      ws: wsFremd,
      deal: deals.fremd,
      date: "2026-11-06",
      amount: "999.00",
      tax: "betriebseinnahme",
      firma: ocFremd,
    });
  }, 30_000);

  afterAll(async () => {
    if (sql) {
      await sql`delete from workspaces where id in (${ws}, ${wsFremd})`;
      await sql.end({ timeout: 5 });
    }
    await clientSchliessen();
  });

  beforeEach(() => {
    uebersichtCacheLeeren();
    navZaehlerCacheLeeren();
    kasseZaehlerCacheLeeren();
  });

  async function text(recordId: string, attr: string, value: string) {
    await sql!`insert into record_values (id, record_id, attribute_id, text_value) values (${randomUUID()}, ${recordId}, ${attr}, ${value})`;
  }

  async function ref(recordId: string, attr: string, target: string) {
    await sql!`insert into record_values (id, record_id, attribute_id, referenced_record_id) values (${randomUUID()}, ${recordId}, ${attr}, ${target})`;
  }

  async function deal(
    id: string,
    o: { name: string; stage: string; at: string; firma?: string; move?: string; fertig?: string; quelle?: string; deleted?: boolean },
  ) {
    await sql!`insert into records (id, object_id, created_at) values (${id}, ${O.deals}, ${o.at})`;
    await text(id, A.name, o.name);
    await text(id, A.stage, o.stage);
    if (o.firma) await ref(id, A.firma, o.firma);
    if (o.move) {
      await sql!`insert into record_values (id, record_id, attribute_id, date_value) values (${randomUUID()}, ${id}, ${A.move}, ${o.move})`;
    }
    if (o.fertig) {
      // Über text, sonst macht postgres.js aus dem String ein lokales Date und verschiebt die UTC-Wandzeit.
      await sql!`insert into record_values (id, record_id, attribute_id, timestamp_value) values (${randomUUID()}, ${id}, ${A.fertig}, ${o.fertig}::text::timestamp)`;
    }
    if (o.quelle) await text(id, A.quelle, o.quelle);
    if (o.deleted) await sql!`update records set deleted_at = now() where id = ${id}`;
  }

  async function zahlung(o: { ws?: string; deal: string | null; date: string; amount: string; tax: string; firma: string | null }) {
    await sql!`
      insert into payments (id, workspace_id, deal_record_id, operating_company_id, date, amount, tax_treatment)
      values (${randomUUID()}, ${o.ws ?? ws}, ${o.deal}, ${o.firma}, ${o.date}, ${o.amount}, ${o.tax})
    `;
  }

  function incomeCent(overview: Awaited<ReturnType<typeof getFinancialOverview>>, companyId: string): number {
    const row = overview.companyBreakdown.find((r) => r.companyId === companyId);
    return Math.round((row?.income ?? 0) * 100);
  }

  it("eingegangen stimmt je Firma und Monat mit getFinancialOverview überein", async () => {
    const alle = await ladeUebersicht(ws, null, JETZT);
    const alpha = await ladeUebersicht(ws, ocA, JETZT);
    const beta = await ladeUebersicht(ws, ocB, JETZT);

    for (const monat of alle.monate) {
      const fin = await getFinancialOverview(ws, monat);
      expect(alpha.eingegangen[monat]).toBe(incomeCent(fin, ocA));
      expect(beta.eingegangen[monat]).toBe(incomeCent(fin, ocB));
      const summe = Math.round(fin.companyBreakdown.reduce((s, r) => s + r.income, 0) * 100);
      expect(alle.eingegangen[monat]).toBe(summe);
    }

    expect(alpha.eingegangen["2026-11"]).toBe(88_950);
    expect(beta.eingegangen["2026-11"]).toBe(8_000);
    expect(alle.eingegangen["2026-11"]).toBe(96_950);
    expect(alpha.eingegangen["2025-12"]).toBe(1_000);
    expect(alle.firma).toBeNull();
    expect(alpha.firma).toBe(ocA);
  });

  it("zählt durchgeführt nach Kategorie und Betragsquelle, Monat aus Berlin bzw. move_date", async () => {
    const alle = await ladeUebersicht(ws, null, JETZT);
    const alpha = await ladeUebersicht(ws, ocA, JETZT);
    const beta = await ladeUebersicht(ws, ocB, JETZT);

    expect(alle.durchgefuehrt["2026-10"]).toEqual({ cent: 200_000, anzahl: 2, ohneBetrag: 0 });
    expect(alle.durchgefuehrt["2026-11"]).toEqual({ cent: 150_000, anzahl: 2, ohneBetrag: 1 });
    expect(alpha.durchgefuehrt["2026-10"]).toEqual({ cent: 120_000, anzahl: 1, ohneBetrag: 0 });
    expect(alpha.durchgefuehrt["2026-11"]).toEqual({ cent: 150_000, anzahl: 1, ohneBetrag: 0 });
    expect(beta.durchgefuehrt["2026-10"]).toEqual({ cent: 80_000, anzahl: 1, ohneBetrag: 0 });
    expect(beta.durchgefuehrt["2026-11"]).toEqual({ cent: 0, anzahl: 1, ohneBetrag: 1 });
  });

  it("Abschluss bleibt bei umbenannter Stufe gleich; gelöschte und fremde Deals fehlen", async () => {
    const vorher = await ladeUebersicht(ws, null, JETZT);
    expect(vorher.anfragen.gesamt["2026-11"]).toBe(2);
    expect(vorher.anfragen.quellen).toEqual([{ id: quelleTelefon, label: "Telefon" }, { id: "ohne", label: "Ohne Quelle" }]);
    expect(vorher.abschluss.je["2026-11"]).toMatchObject({ gewonnen: 0, verloren: 1, offen: 1 });
    expect(vorher.wartetAufUns).toBe(1);
    expect((await ladeUebersicht(ws, ocB, JETZT)).wartetAufUns).toBe(1);

    await sql!`update statuses set title = 'Verloren' where id = ${S.angebot}`;
    uebersichtCacheLeeren();
    navZaehlerCacheLeeren();
    kasseZaehlerCacheLeeren();
    const nachher = await ladeUebersicht(ws, null, JETZT);
    expect(nachher.abschluss).toEqual(vorher.abschluss);
    expect(nachher.anfragen.gesamt).toEqual(vorher.anfragen.gesamt);

    const kasse = nachher.offen;
    expect(kasse.rest).toEqual({ anzahl: 1, cent: 150_000, unbekannt: 0 });
    expect(kasse.ohneRechnung).toEqual({ anzahl: 3, cent: 200_000, unbekannt: 1 });
  });
});
