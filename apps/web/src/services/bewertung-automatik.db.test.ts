import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Treiber der Bewertungs-Automatik gegen eine Wegwerf-Datenbank. Gesendet
 * wird über einen Fake von `bewertungAnfragen`; Vormerkungen, Anspruch,
 * Kandidaten und Aufräumen laufen echt. Nur mit BEWERTUNG_TEST_DATABASE_URL.
 */
const url = process.env.BEWERTUNG_TEST_DATABASE_URL;

const held = vi.hoisted(() => ({
  client: null as { end: (opts?: { timeout?: number }) => Promise<void> } | null,
}));

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.BEWERTUNG_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 4 });
  held.client = client;
  return { db: drizzle(client, { schema }) };
});

import { BewertungFehler, BewertungVersandFehler } from "./bewertung-anfragen";
import { bewertungAutomatikLauf } from "./bewertung-automatik";

afterAll(async () => {
  await held.client?.end({ timeout: 5 });
  held.client = null;
});

describe("vercel.json", () => {
  it("trägt bewertung-auto ein und keinen alten reviews-Cron", () => {
    const v = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    expect(v.crons).toContainEqual({ path: "/api/cron/bewertung-auto", schedule: "*/15 * * * *" });
    expect(v.crons.some((c) => c.path.includes("reviews-"))).toBe(false);
  });
});

// Di 10.11.2026, 11:00 Berlin
const JETZT = new Date("2026-11-10T10:00:00Z");
// So 15.11.2026, 12:00 Berlin
const SONNTAG = new Date("2026-11-15T11:00:00Z");
const TAG = 24 * 3600 * 1000;

describe.skipIf(!url)("bewertungAutomatikLauf gegen Postgres", () => {
  let sql: postgres.Sql;
  const welten: string[] = [];

  beforeAll(() => {
    sql = postgres(url!, { max: 1, onnotice: () => {} });
  });

  afterAll(async () => {
    if (!sql) return;
    for (const ws of welten) {
      await sql`delete from review_vormerkungen where workspace_id = ${ws}`;
      await sql`delete from review_events where workspace_id = ${ws}`;
      await sql`delete from review_tokens where workspace_id = ${ws}`;
      await sql`delete from inbox_messages where workspace_id = ${ws}`;
      await sql`delete from inbox_conversations where workspace_id = ${ws}`;
      await sql`delete from inbox_contacts where workspace_id = ${ws}`;
      await sql`delete from channel_accounts where workspace_id = ${ws}`;
      await sql`delete from company_settings where workspace_id = ${ws}`;
      await sql`delete from deal_workflow_state where record_id in (select r.id from records r join objects o on o.id = r.object_id where o.workspace_id = ${ws})`;
      await sql`delete from workspaces where id = ${ws}`;
    }
    await sql.end({ timeout: 5 });
  });

  /** Eigener Workspace je Test: Deals, Personen, Firma, Attribute, Stufen. */
  async function welt(modus: "aus" | "entwurf" | "senden", seit: Date | null = new Date(JETZT.getTime() - 30 * TAG)) {
    const ws = randomUUID();
    welten.push(ws);
    const id = () => randomUUID();
    const o = { deals: id(), people: id(), oc: id() };
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Auto', ${`a-${ws}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values
      (${o.deals}, ${ws}, 'deals', 'Deal', 'Deals'), (${o.people}, ${ws}, 'people', 'Person', 'Personen'),
      (${o.oc}, ${ws}, 'operating_companies', 'Firma', 'Firmen')`;
    const a = {
      oc: id(), stage: id(), status: id(), dnc: id(), ppl: id(), kontaktart: id(), name: id(),
    };
    await sql`insert into attributes (id, object_id, slug, title, type) values
      (${a.oc}, ${o.deals}, 'operating_company', 'Firma', 'record_reference'),
      (${a.stage}, ${o.deals}, 'stage', 'Stufe', 'status'),
      (${a.status}, ${o.deals}, 'review_request_status', 'Bewertung', 'status'),
      (${a.dnc}, ${o.deals}, 'do_not_contact_review', 'Keine Bewertung', 'checkbox'),
      (${a.ppl}, ${o.deals}, 'associated_people', 'Personen', 'record_reference'),
      (${a.kontaktart}, ${o.people}, 'kontaktart', 'Kontaktart', 'select'),
      (${a.name}, ${o.oc}, 'name', 'Name', 'text')`;
    const s = { paid: id(), done: id(), booked: id(), sent: id(), complaint: id() };
    await sql`insert into statuses (id, attribute_id, title, stage_category) values
      (${s.paid}, ${a.stage}, 'Bezahlt', 'paid'), (${s.done}, ${a.stage}, 'Durchgeführt', 'done_unpaid'),
      (${s.booked}, ${a.stage}, 'Gebucht', 'booked'),
      (${s.sent}, ${a.status}, 'sent_whatsapp', null), (${s.complaint}, ${a.status}, 'complaint_routed', null)`;
    const opt = { bewerber: id() };
    await sql`insert into select_options (id, attribute_id, title) values (${opt.bewerber}, ${a.kontaktart}, 'Bewerber')`;
    const firma = id();
    await sql`insert into records (id, object_id) values (${firma}, ${o.oc})`;
    await sql`insert into record_values (id, record_id, attribute_id, text_value) values (${id()}, ${firma}, ${a.name}, 'Kottke Umzüge')`;
    await sql`insert into company_settings (operating_company_record_id, workspace_id, bewertung_modus, bewertung_modus_seit)
      values (${firma}, ${ws}, ${modus}, ${seit})`;

    async function deal(e: {
      stufe?: "paid" | "done" | "booked";
      bezahltAm?: Date | null;
      status?: "sent" | "complaint";
      dnc?: boolean;
      bewerber?: boolean;
    } = {}) {
      const d = id();
      const p = id();
      await sql`insert into records (id, object_id) values (${d}, ${o.deals}), (${p}, ${o.people})`;
      await sql`insert into record_values (id, record_id, attribute_id, referenced_record_id) values
        (${id()}, ${d}, ${a.oc}, ${firma}), (${id()}, ${d}, ${a.ppl}, ${p})`;
      await sql`insert into record_values (id, record_id, attribute_id, text_value) values (${id()}, ${d}, ${a.stage}, ${s[e.stufe ?? "paid"]})`;
      if (e.status) {
        await sql`insert into record_values (id, record_id, attribute_id, text_value) values (${id()}, ${d}, ${a.status}, ${e.status === "sent" ? s.sent : s.complaint})`;
      }
      if (e.dnc) await sql`insert into record_values (id, record_id, attribute_id, boolean_value) values (${id()}, ${d}, ${a.dnc}, true)`;
      if (e.bewerber) await sql`insert into record_values (id, record_id, attribute_id, text_value) values (${id()}, ${p}, ${a.kontaktart}, ${opt.bewerber})`;
      const bezahlt = e.bezahltAm === undefined ? new Date(JETZT.getTime() - 2 * TAG) : e.bezahltAm;
      await sql`insert into deal_workflow_state (record_id, bezahlt_am) values (${d}, ${bezahlt})`;
      return d;
    }

    async function vormerkungen() {
      return sql<{ deal_record_id: string; art: string; status: string; sperre: string | null; versuche: number; faellig_ab: Date }[]>`
        select deal_record_id, art, status, sperre, versuche, faellig_ab from review_vormerkungen where workspace_id = ${ws} order by created_at`;
    }

    async function nachricht(deal: string, body: string, am: Date) {
      const acc = id();
      const kontakt = id();
      const conv = id();
      await sql`insert into channel_accounts (id, workspace_id, channel_type, name, address) values (${acc}, ${ws}, 'whatsapp', 'Kottke', '+49170')`;
      await sql`insert into inbox_contacts (id, workspace_id) values (${kontakt}, ${ws})`;
      await sql`insert into inbox_conversations (id, workspace_id, channel_account_id, contact_id, deal_record_id) values (${conv}, ${ws}, ${acc}, ${kontakt}, ${deal})`;
      await sql`insert into inbox_messages (id, workspace_id, conversation_id, direction, body, created_at)
        values (${id()}, ${ws}, ${conv}, 'inbound', ${body}, ${am.toISOString()}::timestamptz at time zone 'UTC')`;
    }

    return { ws, firma, deal, vormerkungen, nachricht };
  }

  function sendenFake(impl?: (ws: string, deal: string) => Promise<unknown>) {
    return vi.fn(async (ws: string, deal: string) => {
      if (impl) await impl(ws, deal);
      return { gesendet: true as const, gespraechId: "conv" };
    });
  }

  /** Nur die Zeilen dieses Workspace zählen; andere Tests laufen in derselben DB. */
  const fuer = (senden: ReturnType<typeof sendenFake>, ws: string) => senden.mock.calls.filter((c) => c[0] === ws);

  it("Modus aus legt nichts an, Modus entwurf sendet nie", async () => {
    const aus = await welt("aus");
    const d1 = await aus.deal();
    const ent = await welt("entwurf");
    const d2 = await ent.deal();
    const senden = sendenFake();
    await bewertungAutomatikLauf(JETZT, { senden: senden as never });
    expect(await aus.vormerkungen()).toHaveLength(0);
    const v = await ent.vormerkungen();
    expect(v).toMatchObject([{ deal_record_id: d2, art: "entwurf", status: "offen" }]);
    expect(fuer(senden, aus.ws)).toHaveLength(0);
    expect(fuer(senden, ent.ws)).toHaveLength(0);
    await bewertungAutomatikLauf(new Date(JETZT.getTime() + 3600 * 1000), { senden: senden as never });
    expect(fuer(senden, ent.ws)).toHaveLength(0);
    expect(await ent.vormerkungen()).toHaveLength(1);
    void d1;
  });

  it("Modus senden: legt an und sendet im Fenster als Automatik, schließt die Vormerkung", async () => {
    const w = await welt("senden");
    const d = await w.deal();
    const senden = sendenFake();
    await bewertungAutomatikLauf(JETZT, { senden: senden as never });
    expect(fuer(senden, w.ws)).toEqual([[w.ws, d, { userId: null, quelle: "automatik" }, expect.anything()]]);
    expect(await w.vormerkungen()).toMatchObject([{ art: "auto", status: "gesendet" }]);
  });

  it("Altauftrag, Frist, falsche Stufe, Sperren und Bewerber: keine Vormerkung", async () => {
    const w = await welt("senden", new Date(JETZT.getTime() - 3 * TAG));
    await w.deal({ bezahltAm: new Date(JETZT.getTime() - 4 * TAG) }); // vor dem Einschalten
    await w.deal({ bezahltAm: null });
    await w.deal({ stufe: "booked" });
    await w.deal({ status: "sent" });
    await w.deal({ status: "complaint" });
    await w.deal({ dnc: true });
    await w.deal({ bewerber: true });
    const w2 = await welt("senden", new Date(JETZT.getTime() - 60 * TAG));
    await w2.deal({ bezahltAm: new Date(JETZT.getTime() - 20 * TAG) }); // Frist 14 Tage vorbei
    const senden = sendenFake();
    await bewertungAutomatikLauf(JETZT, { senden: senden as never });
    expect(await w.vormerkungen()).toHaveLength(0);
    expect(await w2.vormerkungen()).toHaveLength(0);
  });

  it("Sonntag: vorgemerkt für Montag 9 Uhr, nicht gesendet", async () => {
    const w = await welt("senden");
    await w.deal({ bezahltAm: new Date(SONNTAG.getTime() - 2 * TAG) });
    const senden = sendenFake();
    await bewertungAutomatikLauf(SONNTAG, { senden: senden as never });
    expect(fuer(senden, w.ws)).toHaveLength(0);
    const [v] = await w.vormerkungen();
    expect(v).toMatchObject({ status: "offen" });
    expect(v!.faellig_ab.toISOString()).toBe("2026-11-16T08:00:00.000Z");
  });

  it("Beschwerde im Verlauf: gesperrt BESCHWERDE ohne Senden", async () => {
    const w = await welt("senden");
    const d = await w.deal();
    await w.nachricht(d, "Ich bin sehr unzufrieden mit dem Umzug", new Date(JETZT.getTime() - 5 * TAG));
    const senden = sendenFake();
    await bewertungAutomatikLauf(JETZT, { senden: senden as never });
    expect(fuer(senden, w.ws)).toHaveLength(0);
    expect(await w.vormerkungen()).toMatchObject([{ status: "gesperrt", sperre: "BESCHWERDE" }]);
  });

  it("ohne Einwilligung im Ledger: gesperrt EINWILLIGUNG, keine zweite Vormerkung danach", async () => {
    const w = await welt("senden");
    await w.deal();
    const senden = sendenFake(async () => {
      throw new BewertungFehler("EINWILLIGUNG");
    });
    await bewertungAutomatikLauf(JETZT, { senden: senden as never });
    await bewertungAutomatikLauf(new Date(JETZT.getTime() + 15 * 60 * 1000), { senden: senden as never });
    expect(await w.vormerkungen()).toMatchObject([{ status: "gesperrt", sperre: "EINWILLIGUNG" }]);
    expect(fuer(senden, w.ws)).toHaveLength(1);
  });

  it("Ergebnisse: SCHON_GESENDET verworfen, VERSAND_UNKLAR gesperrt, RUHEZEIT bleibt offen", async () => {
    const w = await welt("senden");
    const a = await w.deal();
    const b = await w.deal();
    const c = await w.deal();
    const senden = sendenFake(async (_ws, deal) => {
      if (deal === a) throw new BewertungFehler("SCHON_GESENDET");
      if (deal === b) throw new BewertungVersandFehler("VERSAND_UNKLAR", null);
      if (deal === c) throw new BewertungFehler("RUHEZEIT");
    });
    await bewertungAutomatikLauf(JETZT, { senden: senden as never });
    const v = Object.fromEntries((await w.vormerkungen()).map((x) => [x.deal_record_id, x]));
    expect(v[a]).toMatchObject({ status: "verworfen" });
    expect(v[b]).toMatchObject({ status: "gesperrt", sperre: "VERSAND_UNKLAR" });
    expect(v[c]).toMatchObject({ status: "offen" });
  });

  it("NICHT_GESENDET: neuer Versuch, ab dem dritten gesperrt FEHLGESCHLAGEN", async () => {
    const w = await welt("senden");
    await w.deal();
    const senden = sendenFake(async () => {
      throw new BewertungVersandFehler("NICHT_GESENDET", null);
    });
    for (let i = 0; i < 3; i++) {
      await bewertungAutomatikLauf(new Date(JETZT.getTime() + i * 15 * 60 * 1000), { senden: senden as never });
      // Anspruch frei machen (sonst sperrt er 5 Minuten echte Zeit)
      await sql`update review_vormerkungen set letzter_versuch_at = null where workspace_id = ${w.ws}`;
    }
    expect(await w.vormerkungen()).toMatchObject([{ status: "gesperrt", sperre: "FEHLGESCHLAGEN" }]);
    expect(fuer(senden, w.ws)).toHaveLength(3);
  });

  it("Frist einer offenen Vormerkung vorbei: gesperrt FRIST", async () => {
    const w = await welt("senden");
    const d = await w.deal({ bezahltAm: new Date(JETZT.getTime() - 2 * TAG) });
    await sql`insert into review_vormerkungen (id, workspace_id, deal_record_id, operating_company_record_id, art, faellig_ab, frist_bis)
      values (${randomUUID()}, ${w.ws}, ${d}, ${w.firma}, 'auto', ${new Date(JETZT.getTime() - 3 * TAG)}, ${new Date(JETZT.getTime() - TAG)})`;
    const senden = sendenFake();
    await bewertungAutomatikLauf(JETZT, { senden: senden as never });
    expect(fuer(senden, w.ws)).toHaveLength(0);
    expect(await w.vormerkungen()).toMatchObject([{ status: "gesperrt", sperre: "FRIST" }]);
  });

  it("Vormerkung von Hand: Autor, Text und Einwilligung, Quelle vorgemerkt, auch bei Modus aus", async () => {
    const w = await welt("aus");
    const d = await w.deal();
    await sql`insert into review_vormerkungen (id, workspace_id, deal_record_id, art, faellig_ab, frist_bis, text, einwilligung, erstellt_von)
      values (${randomUUID()}, ${w.ws}, ${d}, 'hand', ${new Date(JETZT.getTime() - 3600 * 1000)}, ${new Date(JETZT.getTime() + TAG)},
              'Text [Bewertungslink]', 'Am Telefon', 'usr_9')`;
    const senden = sendenFake();
    await bewertungAutomatikLauf(JETZT, { senden: senden as never });
    expect(fuer(senden, w.ws)).toEqual([
      [w.ws, d, { userId: "usr_9", quelle: "vorgemerkt", text: "Text [Bewertungslink]", einwilligung: "Am Telefon" }, expect.anything()],
    ]);
    expect(await w.vormerkungen()).toMatchObject([{ status: "gesendet" }]);
  });

  it("zwei Läufe parallel senden jede Vormerkung höchstens einmal; Limit je Lauf", async () => {
    const w = await welt("senden");
    for (let i = 0; i < 12; i++) await w.deal();
    const senden = sendenFake(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    await Promise.all([
      bewertungAutomatikLauf(JETZT, { senden: senden as never }),
      bewertungAutomatikLauf(JETZT, { senden: senden as never }),
    ]);
    const calls = fuer(senden, w.ws).map((c) => c[1]);
    expect(new Set(calls).size).toBe(calls.length);
    expect(calls.length).toBeLessThanOrEqual(20);
    expect(await w.vormerkungen()).toHaveLength(12);

    const w2 = await welt("senden");
    for (let i = 0; i < 12; i++) await w2.deal();
    const s2 = sendenFake();
    await bewertungAutomatikLauf(JETZT, { senden: s2 as never, limit: 10 });
    expect(fuer(s2, w2.ws).length).toBeLessThanOrEqual(10);
    expect(s2.mock.calls.length).toBeLessThanOrEqual(10);
  });

  it("Aufräumen: Klick-IP und Browser nur älter als 90 Tage, Token und Ereignis-meta", async () => {
    const w = await welt("aus");
    const d = await w.deal();
    const alt = new Date(JETZT.getTime() - 91 * TAG);
    const neu = new Date(JETZT.getTime() - 89 * TAG);
    const utc = (x: Date) => x.toISOString().replace("T", " ").replace("Z", "");
    await sql`insert into review_tokens (token, workspace_id, deal_record_id, destination_url, clicked_at, click_ip, click_user_agent, quelle, zustand)
      values (${`alt-${w.ws}`}, ${w.ws}, ${d}, 'u', ${utc(alt)}::text::timestamp, '1.2.3.4', 'UA', 'hand', 'gesendet'),
             (${`neu-${w.ws}`}, ${w.ws}, ${d}, 'u', ${utc(neu)}::text::timestamp, '5.6.7.8', 'UA2', 'hand', 'gesendet')`;
    await sql`insert into review_events (id, workspace_id, deal_record_id, event_type, meta, at) values
      (${randomUUID()}, ${w.ws}, ${d}, 'clicked', ${sql.json({ ip: "1.2.3.4", user_agent: "UA", x: 1 })}, ${utc(alt)}::text::timestamp),
      (${randomUUID()}, ${w.ws}, ${d}, 'clicked', ${sql.json({ ip: "5.6.7.8", user_agent: "UA2" })}, ${utc(neu)}::text::timestamp)`;
    const erg = await bewertungAutomatikLauf(JETZT, { senden: sendenFake() as never });
    expect(erg.geloeschtKlicks).toBeGreaterThanOrEqual(2);
    const t = await sql<{ token: string; click_ip: string | null; click_user_agent: string | null }[]>`
      select token, click_ip, click_user_agent from review_tokens where workspace_id = ${w.ws} order by token`;
    expect(t).toEqual([
      { token: `alt-${w.ws}`, click_ip: null, click_user_agent: null },
      { token: `neu-${w.ws}`, click_ip: "5.6.7.8", click_user_agent: "UA2" },
    ]);
    const e = await sql<{ meta: Record<string, unknown> }[]>`select meta from review_events where workspace_id = ${w.ws} order by at`;
    expect(e.map((x) => x.meta)).toEqual([{ x: 1 }, { ip: "5.6.7.8", user_agent: "UA2" }]);
    // idempotent
    await bewertungAutomatikLauf(JETZT, { senden: sendenFake() as never });
    const e2 = await sql<{ meta: Record<string, unknown> }[]>`select meta from review_events where workspace_id = ${w.ws} order by at`;
    expect(e2.map((x) => x.meta)).toEqual([{ x: 1 }, { ip: "5.6.7.8", user_agent: "UA2" }]);
  });
});
