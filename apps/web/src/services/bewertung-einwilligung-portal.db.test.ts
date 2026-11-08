import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Portal-Haken und Einwilligung gegen eine Wegwerf-Datenbank (BEWERTUNG_TEST_DATABASE_URL). */
const url = process.env.BEWERTUNG_TEST_DATABASE_URL;

const held = vi.hoisted(() => ({
  client: null as { end: (opts?: { timeout?: number }) => Promise<void> } | null,
}));

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.BEWERTUNG_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 3 });
  held.client = client;
  return { db: drizzle(client, { schema }) };
});

import { EINWILLIGUNG_PORTAL, einwilligungsWortlaut } from "@/lib/bewertungen-kunden";
import { dbBewertungSpeicher } from "./bewertung-anfragen";
import { portalEinwilligungSpeichern, portalHaken } from "./bewertung-einwilligung-portal";

afterAll(async () => {
  await held.client?.end({ timeout: 5 });
  held.client = null;
});

describe.skipIf(!url)("Portal-Einwilligung gegen Postgres", () => {
  let sql: postgres.Sql;
  const ws = randomUUID();
  const id = () => randomUUID();
  const o = { deals: id(), people: id(), oc: id() };
  const a = { oc: id(), ppl: id(), name: id() };
  const firmen = { kottke: id(), ceylan: id() };

  beforeAll(async () => {
    sql = postgres(url!, { max: 1, onnotice: () => {} });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Portal', ${`p-${ws}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values
      (${o.deals}, ${ws}, 'deals', 'Deal', 'Deals'), (${o.people}, ${ws}, 'people', 'Person', 'Personen'),
      (${o.oc}, ${ws}, 'operating_companies', 'Firma', 'Firmen')`;
    await sql`insert into attributes (id, object_id, slug, title, type) values
      (${a.oc}, ${o.deals}, 'operating_company', 'Firma', 'record_reference'),
      (${a.ppl}, ${o.deals}, 'associated_people', 'Personen', 'record_reference'),
      (${a.name}, ${o.oc}, 'name', 'Name', 'text')`;
    await sql`insert into records (id, object_id) values (${firmen.kottke}, ${o.oc}), (${firmen.ceylan}, ${o.oc})`;
    await sql`insert into record_values (id, record_id, attribute_id, text_value) values
      (${id()}, ${firmen.kottke}, ${a.name}, 'Umzüge Kottke'), (${id()}, ${firmen.ceylan}, ${a.name}, 'Ceylan Transporte')`;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from activity_events where workspace_id = ${ws}`;
    await sql`delete from consent_ledger where workspace_id = ${ws}`;
    await sql`delete from kva_confirmations where workspace_id = ${ws}`;
    await sql`delete from customer_status_links where workspace_id = ${ws}`;
    await sql`delete from operating_company_portal_settings where workspace_id = ${ws}`;
    await sql`delete from company_settings where workspace_id = ${ws}`;
    await sql`delete from workspaces where id = ${ws}`;
    await sql.end({ timeout: 5 });
  });

  async function einstellen(firma: string, e: { haken: boolean; link: string | null }) {
    await sql`insert into company_settings (operating_company_record_id, workspace_id, bewertung_haken_portal)
      values (${firma}, ${ws}, ${e.haken})
      on conflict (operating_company_record_id) do update set bewertung_haken_portal = ${e.haken}`;
    await sql`delete from operating_company_portal_settings where operating_company_record_id = ${firma}`;
    if (e.link !== null) {
      await sql`insert into operating_company_portal_settings (workspace_id, operating_company_record_id, google_review_url)
        values (${ws}, ${firma}, ${e.link})`;
    }
  }

  async function deal(firma: string, mitPerson = true, angenommen = true) {
    const d = id();
    const p = id();
    const token = randomUUID().replace(/-/g, "").slice(0, 32);
    await sql`insert into records (id, object_id) values (${d}, ${o.deals}), (${p}, ${o.people})`;
    await sql`insert into record_values (id, record_id, attribute_id, referenced_record_id) values (${id()}, ${d}, ${a.oc}, ${firma})`;
    if (mitPerson) await sql`insert into record_values (id, record_id, attribute_id, referenced_record_id) values (${id()}, ${d}, ${a.ppl}, ${p})`;
    const link = id();
    await sql`insert into customer_status_links (id, workspace_id, deal_record_id, token) values (${link}, ${ws}, ${d}, ${token})`;
    if (angenommen) {
      await sql`insert into kva_confirmations (id, workspace_id, deal_record_id, customer_link_id, quotation_snapshot,
          confirmed_total_cents, agb_version_accepted, ip_address, user_agent)
        values (${id()}, ${ws}, ${d}, ${link}, ${sql.json({})}, 100000, 'v1', '1.1.1.1', 'UA')`;
    }
    return { d, p, token };
  }

  it("Haken nur mit Schalter und gültigem Link; Anrede je Firma", async () => {
    const k = await deal(firmen.kottke);
    const c = await deal(firmen.ceylan);
    await einstellen(firmen.kottke, { haken: false, link: "https://g.page/r/k/review" });
    await einstellen(firmen.ceylan, { haken: true, link: null });
    expect(await portalHaken(ws, k.d)).toBeNull();
    expect(await portalHaken(ws, c.d)).toBeNull();
    await einstellen(firmen.ceylan, { haken: true, link: "kein link" });
    expect(await portalHaken(ws, c.d)).toBeNull();
    await einstellen(firmen.kottke, { haken: true, link: "https://g.page/r/k/review" });
    await einstellen(firmen.ceylan, { haken: true, link: "https://g.page/r/c/review" });
    expect(await portalHaken(ws, k.d)).toEqual({ anrede: "du" });
    expect(await portalHaken(ws, c.d)).toEqual({ anrede: "sie" });
    expect(await portalHaken(randomUUID(), k.d)).toBeNull();
  });

  it("speichert den exakten Wortlaut je Anrede, einmal, ohne Akteur; danach Einwilligung da", async () => {
    await einstellen(firmen.kottke, { haken: true, link: "https://g.page/r/k/review" });
    await einstellen(firmen.ceylan, { haken: true, link: "https://g.page/r/c/review" });
    const k = await deal(firmen.kottke);
    const c = await deal(firmen.ceylan);
    expect(await dbBewertungSpeicher.einwilligungDa(ws, k.p)).toBe(false);
    const [r1, r2] = await Promise.all([portalEinwilligungSpeichern(k.token), portalEinwilligungSpeichern(k.token)]);
    expect([r1, r2].sort()).toEqual(["gespeichert", "schon_da"]);
    expect(await portalEinwilligungSpeichern(c.token)).toBe("gespeichert");
    const zeilen = await sql<{ person_record_id: string; exact_wording: string; channel: string; purpose: string }[]>`
      select person_record_id, exact_wording, channel, purpose from consent_ledger where workspace_id = ${ws} and person_record_id in (${k.p}, ${c.p})`;
    expect(zeilen).toHaveLength(2);
    const nach = Object.fromEntries(zeilen.map((z) => [z.person_record_id, z]));
    expect(nach[k.p]).toMatchObject({ exact_wording: einwilligungsWortlaut("du"), channel: "whatsapp", purpose: "review_request" });
    expect(nach[c.p]!.exact_wording).toContain(EINWILLIGUNG_PORTAL.sie.frage);
    const ev = await sql<{ actor_id: string | null; payload: { quelle: string } }[]>`
      select actor_id, payload from activity_events where workspace_id = ${ws} and record_id = ${k.d} and event_type = 'consent.eingetragen'`;
    expect(ev).toEqual([{ actor_id: null, payload: expect.objectContaining({ quelle: "portal", personRecordId: k.p }) }]);
    expect(await dbBewertungSpeicher.einwilligungDa(ws, k.p)).toBe(true);
  });

  it("aus, keine Person, keine Annahme", async () => {
    await einstellen(firmen.kottke, { haken: true, link: "https://g.page/r/k/review" });
    const ohne = await deal(firmen.kottke, false);
    expect(await portalEinwilligungSpeichern(ohne.token)).toBe("keine_person");
    const nichtAngenommen = await deal(firmen.kottke, true, false);
    expect(await portalEinwilligungSpeichern(nichtAngenommen.token)).toBe("aus");
    await einstellen(firmen.kottke, { haken: false, link: "https://g.page/r/k/review" });
    const aus = await deal(firmen.kottke);
    expect(await portalEinwilligungSpeichern(aus.token)).toBe("aus");
    expect(await portalEinwilligungSpeichern("x".repeat(32))).toBe("aus");
  });
});
