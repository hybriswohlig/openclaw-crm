import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { canonicalizePhone } from "@/lib/identity/canonical";

/**
 * Kundenliste und Kundenakte gegen eine Wegwerf-Datenbank. Läuft nur mit
 * KUNDEN_TEST_DATABASE_URL. Beide Clients werden geschlossen.
 */
const url = process.env.KUNDEN_TEST_DATABASE_URL;

const held = vi.hoisted(() => ({
  client: null as { end: (opts?: { timeout?: number }) => Promise<void> } | null,
  abfragen: 0,
}));

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.KUNDEN_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 1 });
  held.client = client;
  const real = drizzle(client, { schema });
  const original = real.execute.bind(real);
  return {
    db: new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === "execute") {
          return (q: unknown) => {
            held.abfragen += 1;
            return original(q as never);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }),
  };
});

import { kundeZuDeal, ladeKundenAkte, ladeKundenListe } from "./kunden";

async function clientSchliessen(): Promise<void> {
  const client = held.client;
  held.client = null;
  await client?.end({ timeout: 5 });
}

afterAll(async () => {
  await clientSchliessen();
});

const ws = randomUUID();
const wsFremd = randomUUID();
const O = { people: randomUUID(), deals: randomUUID(), oc: randomUUID(), fremdPeople: randomUUID(), fremdDeals: randomUUID() };
const A = {
  name: randomUUID(),
  phone: randomUUID(),
  email: randomUUID(),
  kontaktart: randomUUID(),
  dealName: randomUUID(),
  stage: randomUUID(),
  people: randomUUID(),
  firma: randomUUID(),
  move: randomUUID(),
  dnc: randomUUID(),
  ocName: randomUUID(),
};
const S = {
  neu: randomUUID(),
  angebot: randomUUID(),
  gebucht: randomUUID(),
  durch: randomUUID(),
  bezahlt: randomUUID(),
  verloren: randomUUID(),
  kein: randomUUID(),
};
const bewerberOpt = randomUUID();
const ocKottke = randomUUID();
const ocCeylan = randomUUID();

const P: Record<string, string> = {};
const D: Record<string, string> = {};

describe.skipIf(!url)("Kunden gegen Postgres", () => {
  let sql: postgres.Sql | undefined;
  let seq = 100;

  function nummer(text: string) {
    const n = seq++;
    return { year: 2026, seq: n, text };
  }

  async function record(objectId: string, createdAt?: string): Promise<string> {
    const id = randomUUID();
    if (createdAt) {
      await sql!`insert into records (id, object_id, created_at) values (${id}, ${objectId}, ${createdAt})`;
    } else {
      await sql!`insert into records (id, object_id) values (${id}, ${objectId})`;
    }
    return id;
  }

  async function text(recordId: string, attr: string, value: string, sort = 0) {
    await sql!`insert into record_values (id, record_id, attribute_id, text_value, sort_order) values (${randomUUID()}, ${recordId}, ${attr}, ${value}, ${sort})`;
  }

  async function ref(recordId: string, attr: string, target: string, sort = 0) {
    await sql!`insert into record_values (id, record_id, attribute_id, referenced_record_id, sort_order) values (${randomUUID()}, ${recordId}, ${attr}, ${target}, ${sort})`;
  }

  async function mensch(o: { name?: string; json?: { full_name: string }; telefon?: string; email?: string; kontaktart?: string; deleted?: boolean }): Promise<string> {
    const id = await record(O.people);
    if (o.name) await text(id, A.name, o.name);
    if (o.json) {
      await sql!`insert into record_values (id, record_id, attribute_id, json_value) values (${randomUUID()}, ${id}, ${A.name}, ${sql!.json(o.json)})`;
    }
    if (o.telefon) await text(id, A.phone, o.telefon);
    if (o.email) await text(id, A.email, o.email);
    if (o.kontaktart) await text(id, A.kontaktart, o.kontaktart);
    if (o.deleted) await sql!`update records set deleted_at = now() where id = ${id}`;
    return id;
  }

  async function deal(o: {
    name: string;
    stage: string;
    at?: string;
    firma?: string;
    move?: string;
    dnc?: boolean;
    nummer?: string;
    personen?: { id: string; sort?: number }[];
    deleted?: boolean;
  }): Promise<string> {
    const id = await record(O.deals, o.at);
    await text(id, A.dealName, o.name);
    await text(id, A.stage, o.stage);
    if (o.firma) await ref(id, A.firma, o.firma);
    if (o.move) await sql!`insert into record_values (id, record_id, attribute_id, date_value) values (${randomUUID()}, ${id}, ${A.move}, ${o.move})`;
    if (o.dnc) await sql!`insert into record_values (id, record_id, attribute_id, boolean_value) values (${randomUUID()}, ${id}, ${A.dnc}, true)`;
    if (o.nummer) {
      const n = nummer(o.nummer);
      await sql!`insert into deal_numbers (id, workspace_id, deal_record_id, year, sequence, deal_number) values (${randomUUID()}, ${ws}, ${id}, ${n.year}, ${n.seq}, ${n.text})`;
    }
    for (const p of o.personen ?? []) await ref(id, A.people, p.id, p.sort ?? 0);
    if (o.deleted) await sql!`update records set deleted_at = now() where id = ${id}`;
    return id;
  }

  async function annahme(dealId: string, cents: number, aufgehoben: boolean) {
    const link = randomUUID();
    await sql!`insert into customer_status_links (id, workspace_id, deal_record_id, token) values (${link}, ${ws}, ${dealId}, ${randomUUID()})`;
    await sql!`
      insert into kva_confirmations (
        id, workspace_id, deal_record_id, customer_link_id, quotation_snapshot,
        confirmed_total_cents, agb_version_accepted, ip_address, user_agent, superseded_at
      ) values (
        ${randomUUID()}, ${ws}, ${dealId}, ${link}, ${sql!.json({ test: true })},
        ${cents}, 'test', '127.0.0.1', 'vitest', ${aufgehoben ? new Date().toISOString() : null}
      )
    `;
  }

  beforeAll(async () => {
    sql = postgres(url!, { max: 1 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Kunden Test', ${`k-${ws}`})`;
    await sql`insert into workspaces (id, name, slug) values (${wsFremd}, 'Fremd', ${`f-${wsFremd}`})`;
    await sql`
      insert into objects (id, workspace_id, slug, singular_name, plural_name) values
        (${O.people}, ${ws}, 'people', 'Person', 'Personen'),
        (${O.deals}, ${ws}, 'deals', 'Deal', 'Deals'),
        (${O.oc}, ${ws}, 'operating_companies', 'Firma', 'Firmen'),
        (${O.fremdPeople}, ${wsFremd}, 'people', 'Person', 'Personen'),
        (${O.fremdDeals}, ${wsFremd}, 'deals', 'Deal', 'Deals')
    `;
    await sql`
      insert into attributes (id, object_id, slug, title, type) values
        (${A.name}, ${O.people}, 'name', 'Name', 'personal_name'),
        (${A.phone}, ${O.people}, 'phone_numbers', 'Telefon', 'phone_number'),
        (${A.email}, ${O.people}, 'email_addresses', 'E-Mail', 'email_address'),
        (${A.kontaktart}, ${O.people}, 'kontaktart', 'Kontaktart', 'select'),
        (${A.dealName}, ${O.deals}, 'name', 'Name', 'text'),
        (${A.stage}, ${O.deals}, 'stage', 'Stufe', 'status'),
        (${A.people}, ${O.deals}, 'associated_people', 'Personen', 'record_reference'),
        (${A.firma}, ${O.deals}, 'operating_company', 'Firma', 'record_reference'),
        (${A.move}, ${O.deals}, 'move_date', 'Umzug', 'date'),
        (${A.dnc}, ${O.deals}, 'do_not_contact_review', 'Keine Bewertung', 'checkbox'),
        (${A.ocName}, ${O.oc}, 'name', 'Name', 'text')
    `;
    await sql`
      insert into statuses (id, attribute_id, title, stage_category) values
        (${S.neu}, ${A.stage}, 'Neue Anfrage', 'open_new'),
        (${S.angebot}, ${A.stage}, 'Angebot', 'quoted'),
        (${S.gebucht}, ${A.stage}, 'Gebucht', 'booked'),
        (${S.durch}, ${A.stage}, 'Durchgeführt', 'done_unpaid'),
        (${S.bezahlt}, ${A.stage}, 'Bezahlt', 'paid'),
        (${S.verloren}, ${A.stage}, 'Verloren', 'lost'),
        (${S.kein}, ${A.stage}, 'Kein Lead', 'kein_lead')
    `;
    await sql`insert into select_options (id, attribute_id, title) values (${bewerberOpt}, ${A.kontaktart}, 'Bewerber')`;

    await sql`insert into records (id, object_id) values (${ocKottke}, ${O.oc}), (${ocCeylan}, ${O.oc})`;
    await text(ocKottke, A.ocName, "Kottke Umzüge GmbH");
    await text(ocCeylan, A.ocName, "Ceylan Transporte");

    P.paula = await mensch({ name: "Paula Telefon", telefon: "0171 1234567" });
    D.paula = await deal({ name: "Paula Deal", stage: S.gebucht, at: "2026-08-01T00:00:00.000Z", personen: [{ id: P.paula }] });

    const idaE164 = canonicalizePhone("+49 160 9998877", "DE")!;
    P.ida = await mensch({ name: "Ida Kennung" });
    await sql!`
      insert into person_identifiers (id, workspace_id, person_record_id, kind, value_raw, value_canonical, source, trust)
      values (${randomUUID()}, ${ws}, ${P.ida}, 'phone', ${idaE164}, ${idaE164}, 'operator', 'claimed')
    `;
    D.ida = await deal({ name: "Ida Deal", stage: S.gebucht, at: "2026-08-02T00:00:00.000Z", personen: [{ id: P.ida }] });

    P.max = await mensch({ name: "Max Mail", email: "Max@Example.de" });
    D.max = await deal({ name: "Max Deal", stage: S.gebucht, at: "2026-08-03T00:00:00.000Z", personen: [{ id: P.max }] });

    P.annaPost = await mensch({ name: "Anna Post" });
    await sql!`
      insert into person_identifiers (id, workspace_id, person_record_id, kind, value_raw, value_canonical, source, trust)
      values (${randomUUID()}, ${ws}, ${P.annaPost}, 'email', 'anna@firma.de', 'anna@firma.de', 'operator', 'claimed')
    `;
    D.annaPost = await deal({ name: "Anna Post Deal", stage: S.gebucht, at: "2026-08-04T00:00:00.000Z", personen: [{ id: P.annaPost }] });

    P.erika = await mensch({ json: { full_name: "Erika Sommer" } });
    D.erika = await deal({ name: "Erika Deal", stage: S.gebucht, at: "2026-08-05T00:00:00.000Z", personen: [{ id: P.erika }] });

    P.nora = await mensch({ name: "Nummer Nora" });
    D.nora = await deal({ name: "Nora Deal", stage: S.gebucht, at: "2026-08-06T00:00:00.000Z", nummer: "2026-14", personen: [{ id: P.nora }] });

    P.anton = await mensch({ name: "Anfrage Anton" });
    D.anton = await deal({ name: "Anton Deal", stage: S.angebot, at: "2026-08-07T00:00:00.000Z", personen: [{ id: P.anton }] });

    P.berta = await mensch({ name: "Bewerber Berta", kontaktart: bewerberOpt });
    D.berta = await deal({ name: "Berta Deal", stage: S.gebucht, at: "2026-11-01T00:00:00.000Z", personen: [{ id: P.berta }] });

    P.susi = await mensch({ name: "Spam Susi", kontaktart: "spam_werbung" });
    D.susi = await deal({ name: "Susi Deal", stage: S.angebot, personen: [{ id: P.susi }] });

    P.greta = await mensch({ name: "Geloeschte Greta", deleted: true });
    D.greta = await deal({ name: "Greta Deal", stage: S.gebucht, at: "2026-08-08T00:00:00.000Z", personen: [{ id: P.greta }] });

    P.anja = await mensch({ name: "Annahme Anja" });
    D.anja = await deal({ name: "Anja Deal", stage: S.angebot, at: "2026-08-09T00:00:00.000Z", personen: [{ id: P.anja }] });
    await annahme(D.anja, 80000, false);

    P.uwe = await mensch({ name: "Aufgehoben Uwe" });
    D.uwe = await deal({ name: "Uwe Deal", stage: S.angebot, at: "2026-08-10T00:00:00.000Z", personen: [{ id: P.uwe }] });
    await annahme(D.uwe, 50000, true);

    P.bernd = await mensch({ name: "Bezahlt Bernd" });
    D.bernd = await deal({ name: "Bernd Deal", stage: S.bezahlt, at: "2026-08-11T00:00:00.000Z", personen: [{ id: P.bernd }] });
    await sql!`
      insert into deal_invoices (id, workspace_id, deal_record_id, herkunft, status, brutto_cent, rechnungstag, nummer)
      values (${randomUUID()}, ${ws}, ${D.bernd}, 'crm', 'gestellt', 150000, '2026-10-01', 'RE-P11-BERND')
    `;
    await sql!`
      insert into payments (id, workspace_id, deal_record_id, date, amount, tax_treatment)
      values (${randomUUID()}, ${ws}, ${D.bernd}, '2026-10-02', '400.00', 'betriebseinnahme')
    `;

    P.doro = await mensch({ name: "Durch Doro" });
    D.doro = await deal({ name: "Doro Deal", stage: S.durch, at: "2026-08-12T00:00:00.000Z", personen: [{ id: P.doro }] });

    P.nina = await mensch({ name: "Neu Nina" });
    D.nina = await deal({ name: "Nina Deal", stage: S.neu, personen: [{ id: P.nina }] });

    P.wanda = await mensch({ name: "Wanda Wieder" });
    D.wandaK = await deal({
      name: "Wanda Kottke",
      stage: S.gebucht,
      at: "2026-03-02T00:00:00.000Z",
      firma: ocKottke,
      move: "2026-03-01",
      dnc: true,
      personen: [{ id: P.wanda }],
    });
    D.wandaC = await deal({
      name: "Wanda Ceylan",
      stage: S.gebucht,
      at: "2026-11-02T00:00:00.000Z",
      firma: ocCeylan,
      move: "2026-11-01",
      personen: [{ id: P.wanda }],
    });

    const kontaktWanda = randomUUID();
    const kontaktFremd = randomUUID();
    const kanalK = randomUUID();
    const kanalC = randomUUID();
    await sql!`insert into inbox_contacts (id, workspace_id, crm_record_id, display_name) values (${kontaktWanda}, ${ws}, ${P.wanda}, 'Wanda')`;
    await sql!`insert into inbox_contacts (id, workspace_id, display_name) values (${kontaktFremd}, ${ws}, 'Jemand')`;
    await sql!`
      insert into channel_accounts (id, workspace_id, operating_company_record_id, channel_type, name, address) values
        (${kanalK}, ${ws}, ${ocKottke}, 'whatsapp', 'Kottke WhatsApp', '+491110000001'),
        (${kanalC}, ${ws}, ${ocCeylan}, 'email', 'Ceylan Mail', 'ceylan@example.test')
    `;
    await sql!`
      insert into inbox_conversations (id, workspace_id, channel_account_id, contact_id, external_thread_id, last_message_at) values
        (${randomUUID()}, ${ws}, ${kanalK}, ${kontaktWanda}, 'thread-k', '2026-11-03T10:00:00.000Z')
    `;
    await sql!`
      insert into inbox_conversations (id, workspace_id, channel_account_id, contact_id, external_thread_id, deal_record_id, last_message_at) values
        (${randomUUID()}, ${ws}, ${kanalC}, ${kontaktFremd}, 'thread-c', ${D.wandaC}, '2026-11-04T10:00:00.000Z')
    `;

    P.anna1 = await mensch({ name: "Anna Berger" });
    P.anna2 = await mensch({ name: "Anna Berger" });
    D.anna1 = await deal({ name: "Anna 1", stage: S.gebucht, at: "2026-07-01T00:00:00.000Z", personen: [{ id: P.anna1 }] });
    D.anna2 = await deal({ name: "Anna 2", stage: S.gebucht, at: "2026-07-02T00:00:00.000Z", personen: [{ id: P.anna2 }] });

    P.cem = await mensch({ name: "Cem Yilmaz" });
    P.cem2 = await mensch({ name: "Cem Andere" });
    D.cem = await deal({ name: "Cem Deal", stage: S.gebucht, at: "2026-07-03T00:00:00.000Z", personen: [{ id: P.cem }] });
    D.cem2 = await deal({ name: "Cem2 Deal", stage: S.gebucht, at: "2026-07-04T00:00:00.000Z", personen: [{ id: P.cem2 }] });
    await sql!`
      insert into person_merge_edges (id, workspace_id, survivor_record_id, absorbed_record_id, method, status, signals, evidence, snapshot)
      values (${randomUUID()}, ${ws}, ${P.cem}, ${P.cem2}, 'suggested', 'suggested', ${sql!.json({})}, ${sql!.json({})}, ${sql!.json({})})
    `;

    P.vera = await mensch({ name: "Verwaist Vera" });
    D.vera = await deal({ name: "Vera Deal", stage: S.gebucht, personen: [{ id: P.vera }], deleted: true });

    P.seite1 = await mensch({ name: "Seite Eins" });
    P.seite2 = await mensch({ name: "Seite Zwei" });
    P.seite3 = await mensch({ name: "Seite Drei" });
    await deal({ name: "Seite 1", stage: S.gebucht, at: "2026-11-08T00:00:00.000Z", personen: [{ id: P.seite1 }] });
    await deal({ name: "Seite 2", stage: S.gebucht, at: "2026-11-07T00:00:00.000Z", personen: [{ id: P.seite2 }] });
    await deal({ name: "Seite 3", stage: S.gebucht, at: "2026-11-06T00:00:00.000Z", personen: [{ id: P.seite3 }] });

    D.ohne = await deal({ name: "Umzug ohne Person", stage: S.angebot, at: "2026-11-05T00:00:00.000Z", firma: ocKottke, nummer: "2026-88" });
    D.ohneLost = await deal({ name: "Verloren ohne", stage: S.verloren, at: "2026-11-05T01:00:00.000Z" });
    D.ohneKein = await deal({ name: "Kein Lead ohne", stage: S.kein, at: "2026-11-05T02:00:00.000Z" });
    const alt = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    D.ohneAlt = await deal({ name: "Alter Auftrag ohne", stage: S.angebot, at: alt });

    P.erste = await mensch({ name: "Erste Erika" });
    P.zweite = await mensch({ name: "Zweite Zara" });
    D.kopf = await deal({
      name: "Kopf Deal",
      stage: S.angebot,
      personen: [{ id: P.erste, sort: 0 }, { id: P.zweite, sort: 1 }],
    });
    D.nurTot = await deal({ name: "Nur Tote", stage: S.angebot, personen: [{ id: P.greta, sort: 0 }] });

    P.fremd = await record(O.fremdPeople);
    const fremdDeal = await record(O.fremdDeals);
    D.fremd = fremdDeal;
  }, 30_000);

  afterAll(async () => {
    if (sql) {
      await sql`delete from person_merge_edges where workspace_id = ${ws}`;
      await sql`delete from workspaces where id in (${ws}, ${wsFremd})`;
      await sql.end({ timeout: 5 });
    }
    await clientSchliessen();
  });

  async function liste(ansicht: "kunden" | "anfragen" | "ohne_kunde", q = "", weiter: string | null = null, seite?: number) {
    return ladeKundenListe(ws, { ansicht, q, weiter, seite });
  }

  function ids(namen: { personId: string }[]) {
    return namen.map((z) => z.personId);
  }

  it("ordnet Kunden nach Stufe und Kontaktart, lässt Bewerber, Gelöschte und fremde Workspaces weg", async () => {
    const kunden = await liste("kunden");
    const anfragen = await liste("anfragen");
    const k = ids(kunden.zeilen);
    const a = ids(anfragen.zeilen);
    for (const id of [P.paula, P.ida, P.max, P.erika, P.nora, P.anja, P.bernd, P.doro, P.wanda, P.anna1, P.seite1]) {
      expect(k).toContain(id);
    }
    expect(k).not.toContain(P.anton);
    expect(k).not.toContain(P.uwe);
    expect(k).not.toContain(P.nina);
    expect(k).not.toContain(P.berta);
    expect(k).not.toContain(P.susi);
    expect(k).not.toContain(P.greta);
    expect(k).not.toContain(P.vera);
    expect(k).not.toContain(P.fremd);
    expect(a).toEqual(expect.arrayContaining([P.anton, P.uwe, P.nina, P.erste]));
    expect(a).not.toContain(P.berta);
    expect(a).not.toContain(P.susi);
    expect(a).not.toContain(P.greta);
    expect(a).not.toContain(P.anja);
    expect(kunden.suche).toBe("leer");
    expect(kunden.ohneKunde).toEqual([]);
  });

  it("findet dasselbe Telefon in vier Schreibweisen, dazu Kennung, E-Mail und Name", async () => {
    for (const q of ["+49 171 1234567", "0049 171 1234567", "0171 1234567", "01711234567"]) {
      const aus = await liste("kunden", q);
      expect(aus.suche).toBe("telefon");
      expect(ids(aus.zeilen)).toEqual([P.paula]);
    }
    const ida = await liste("kunden", "0160 9998877");
    expect(ids(ida.zeilen)).toEqual([P.ida]);
    expect(ids((await liste("kunden", "MAX@EXAMPLE.DE")).zeilen)).toEqual([P.max]);
    expect((await liste("kunden", "MAX@EXAMPLE.DE")).suche).toBe("email");
    expect(ids((await liste("kunden", "Anna@Firma.de")).zeilen)).toEqual([P.annaPost]);
    const erika = await liste("kunden", "sommer");
    expect(erika.suche).toBe("name");
    expect(ids(erika.zeilen)).toEqual([P.erika]);
    expect(ids((await liste("kunden", "2026-14")).zeilen)).toEqual([P.nora]);
    expect((await ladeKundenAkte(ws, P.erika))?.name).toBe("Erika Sommer");
  });

  it("rechnet den offenen Rest und die Kennzahlen", async () => {
    const bernd = (await liste("kunden")).zeilen.find((z) => z.personId === P.bernd);
    expect(bernd?.offenCent).toBe(110000);
    const anja = (await liste("kunden")).zeilen.find((z) => z.personId === P.anja);
    expect(anja?.offenCent).toBe(80000);
    expect(anja?.auftraege).toBe(0);
    const wanda = (await liste("kunden")).zeilen.find((z) => z.personId === P.wanda);
    expect(wanda).toMatchObject({ auftraege: 2, wiederkehrer: true, letzterUmzug: "2026-11-01" });
    expect(wanda?.firmen.map((f) => f.marke).sort()).toEqual(["ceylan", "kottke"]);
  });

  it("listet Deals ohne lebende Person, ohne Verloren, Kein Lead und alte Deals", async () => {
    const aus = await liste("ohne_kunde");
    const deals = aus.ohneKunde.map((d) => d.dealId);
    expect(deals).toContain(D.ohne);
    expect(deals).toContain(D.greta);
    expect(deals).not.toContain(D.ohneLost);
    expect(deals).not.toContain(D.ohneKein);
    expect(deals).not.toContain(D.ohneAlt);
    expect(deals).not.toContain(D.nora);
    expect(aus.zeilen).toEqual([]);
    const perNummer = await liste("ohne_kunde", "2026-88");
    expect(perNummer.ohneKunde.map((d) => d.dealId)).toEqual([D.ohne]);
    expect(perNummer.suche).toBe("dealnummer");
    const perName = await liste("ohne_kunde", "ohne Person");
    expect(perName.ohneKunde.map((d) => d.dealId)).toEqual([D.ohne]);
    expect((await liste("ohne_kunde", "0171 1234567")).ohneKunde).toEqual([]);
    const chip = aus.ohneKunde.find((d) => d.dealId === D.ohne);
    expect(chip?.firma?.marke).toBe("kottke");
  });

  it("blättert stabil über den Cursor", async () => {
    const erste = await liste("kunden", "Seite", null, 2);
    expect(erste.zeilen.map((z) => z.personId)).toEqual([P.seite1, P.seite2]);
    expect(erste.weiter).toBe(P.seite2);
    const zweite = await liste("kunden", "Seite", erste.weiter, 2);
    expect(zweite.zeilen.map((z) => z.personId)).toEqual([P.seite3]);
    expect(zweite.weiter).toBeNull();
  });

  it("führt die Kundenakte mit beiden Firmen und Dubletten", async () => {
    const akte = await ladeKundenAkte(ws, P.wanda);
    expect(akte?.mehrfachFirma).toBe(true);
    expect(akte?.bewertungGesperrt).toBe(true);
    expect(akte?.wiederkehrer).toBe(true);
    expect(akte?.umzuege.map((u) => u.dealId)).toEqual([D.wandaC, D.wandaK]);
    expect(akte?.umzuege.every((u) => u.bewertung === null)).toBe(true);
    expect(akte?.gespraeche.map((g) => g.firma?.name)).toEqual(["Ceylan Transporte", "Kottke Umzüge GmbH"]);
    expect(akte?.gespraeche.find((g) => g.firma?.marke === "kottke")?.liste[0]).toMatchObject({
      kanal: "whatsapp",
      konto: "Kottke WhatsApp",
      dealId: null,
    });
    expect(akte?.gespraeche.find((g) => g.firma?.marke === "ceylan")?.liste[0]).toMatchObject({
      kanal: "email",
      konto: "Ceylan Mail",
      dealId: D.wandaC,
    });

    const anna = await ladeKundenAkte(ws, P.anna1);
    expect(anna?.dubletten).toEqual([{ personId: P.anna2, name: "Anna Berger", grund: "gleicher_name" }]);
    const cem = await ladeKundenAkte(ws, P.cem);
    expect(cem?.dubletten).toContainEqual({ personId: P.cem2, name: "Cem Andere", grund: "vorschlag" });
    const listeKunden = await liste("kunden");
    expect(listeKunden.zeilen.find((z) => z.personId === P.anna1)?.dublette).toBe(true);
    expect(listeKunden.zeilen.find((z) => z.personId === P.cem)?.dublette).toBe(true);
    expect(listeKunden.zeilen.find((z) => z.personId === P.bernd)?.dublette).toBe(false);
  });

  it("gibt für gelöschte, fremde und Nicht-Personen keine Akte", async () => {
    expect(await ladeKundenAkte(ws, P.greta)).toBeNull();
    expect(await ladeKundenAkte(ws, P.fremd)).toBeNull();
    expect(await ladeKundenAkte(wsFremd, P.paula)).toBeNull();
    expect(await ladeKundenAkte(ws, D.nora)).toBeNull();
    const vera = await ladeKundenAkte(ws, P.vera);
    expect(vera?.umzuege).toEqual([]);
    expect(vera?.name).toBe("Verwaist Vera");
  });

  it("nimmt am Deal die erste lebende Person", async () => {
    expect(await kundeZuDeal(ws, D.kopf)).toEqual({ personId: P.erste, name: "Erste Erika" });
    expect(await kundeZuDeal(ws, D.nurTot)).toBeNull();
    expect(await kundeZuDeal(ws, D.fremd)).toBeNull();
    expect(await kundeZuDeal(wsFremd, D.kopf)).toBeNull();
  });

  it("hält die Abfragezahl bei 3 und bei 60 Personen gleich", async () => {
    held.abfragen = 0;
    await liste("kunden");
    const wenig = held.abfragen;
    const extra: string[] = [];
    try {
      for (let i = 0; i < 57; i++) {
        const pid = await mensch({ name: `Zaehl ${i}` });
        const did = await deal({ name: `Zaehl Deal ${i}`, stage: S.gebucht, at: "2026-06-01T00:00:00.000Z", personen: [{ id: pid }] });
        extra.push(pid, did);
      }
      held.abfragen = 0;
      const voll = await liste("kunden");
      expect(held.abfragen).toBe(wenig);
      expect(wenig).toBeGreaterThanOrEqual(6);
      expect(voll.zeilen.length).toBe(50);
      expect(voll.weiter).toBeTruthy();
    } finally {
      if (extra.length > 0) await sql!`delete from records where id in ${sql!(extra)}`;
    }
  }, 60_000);
});
