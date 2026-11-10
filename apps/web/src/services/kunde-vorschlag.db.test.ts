import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Eingabe von „Aus dem Chat übernehmen“ gegen Postgres (ANNAHME_TEST_DATABASE_URL):
 * nur eingehende Nachrichten der Gespräche dieses Deals im eigenen Workspace,
 * Nachrichtenstand ändert sich mit jeder neuen, gespeicherte Auswertung wird gelesen.
 */
const url = process.env.ANNAHME_TEST_DATABASE_URL;

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  return { db: drizzle(pg(process.env.ANNAHME_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 4 }), { schema }) };
});

describe.skipIf(!url)("Chat-Vorschlag: Eingabe und Cache (DB)", { timeout: 30_000 }, () => {
  let sql: postgres.Sql;
  let q: import("./kunde-vorschlag").VorschlagQuellen;
  const ws = randomUUID();
  const fremd = randomUUID();
  const deal = `deal-${randomUUID()}`;
  const andererDeal = `deal-${randomUUID()}`;

  async function gespraech(w: string, d: string, nachrichten: { richtung: "inbound" | "outbound"; text: string; min: number }[]) {
    const conv = randomUUID();
    const kontakt = randomUUID();
    await sql`insert into inbox_contacts (id, workspace_id, display_name) values (${kontakt}, ${w}, 'Kundin')`;
    await sql`insert into inbox_conversations (id, workspace_id, channel_account_id, contact_id, external_thread_id, deal_record_id)
      values (${conv}, ${w}, ${`ch-${w}`}, ${kontakt}, ${conv}, ${d})`;
    for (const n of nachrichten) {
      await sql`insert into inbox_messages (id, workspace_id, conversation_id, direction, body, sent_at)
        values (${randomUUID()}, ${w}, ${conv}, ${n.richtung}, ${n.text}, ${new Date(Date.UTC(2026, 10, 1, 10, n.min))})`;
    }
    return conv;
  }

  beforeAll(async () => {
    sql = postgres(url!, { max: 2 });
    for (const w of [ws, fremd]) {
      await sql`insert into workspaces (id, name, slug) values (${w}, 'Test', ${`t-${w}`})`;
      await sql`insert into channel_accounts (id, workspace_id, channel_type, name, address) values (${`ch-${w}`}, ${w}, 'whatsapp', 'WA', ${`+49${w.slice(0, 8)}`})`;
    }
    const obj = randomUUID();
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${obj}, ${ws}, 'deals', 'Deal', 'Deals')`;
    await sql`insert into records (id, object_id) values (${deal}, ${obj}), (${andererDeal}, ${obj})`;
    await gespraech(ws, deal, [
      { richtung: "inbound", text: "Hallo, ich bin Viktoria Muster", min: 0 },
      { richtung: "outbound", text: "Unsere Adresse: Firmenweg 1, 10115 Berlin", min: 1 },
      { richtung: "inbound", text: "Wir wohnen Hauptstr. 1, 72218 Wildberg", min: 2 },
    ]);
    await gespraech(ws, andererDeal, [{ richtung: "inbound", text: "Anderer Deal: Ring 2, 20095 Hamburg", min: 0 }]);
    await gespraech(fremd, deal, [{ richtung: "inbound", text: "Fremder Workspace: Weg 3, 50667 Köln", min: 0 }]);
    ({ q } = { q: await (await import("./kunde-vorschlag")).standardQuellen() });
  });

  afterAll(async () => {
    for (const w of [ws, fremd]) {
      await sql`delete from inbox_messages where workspace_id = ${w}`;
      await sql`delete from inbox_conversations where workspace_id = ${w}`;
      await sql`delete from inbox_contacts where workspace_id = ${w}`;
      await sql`delete from channel_accounts where workspace_id = ${w}`;
      await sql`delete from activity_events where workspace_id = ${w}`;
    }
    await sql`delete from records where id in (${deal}, ${andererDeal})`;
    await sql`delete from objects where workspace_id = ${ws}`;
    await sql`delete from workspaces where id in (${ws}, ${fremd})`;
    await sql.end();
  });

  it("nur eingehende Nachrichten dieses Deals im eigenen Workspace, älteste zuerst", async () => {
    const e = await q.eingang(ws, deal);
    expect(e.texte).toEqual(["Hallo, ich bin Viktoria Muster", "Wir wohnen Hauptstr. 1, 72218 Wildberg"]);
    expect(e.stand.startsWith("2:")).toBe(true);
  });

  it("neue Nachricht ändert den Stand; gespeicherte Auswertung kommt mit Stand zurück", async () => {
    const vorher = await q.eingang(ws, deal);
    await q.speichern(ws, deal, { stand: vorher.stand, ki: { customer_name: "Viktoria Muster" } });
    expect(await q.gespeichert(ws, deal)).toEqual({ stand: vorher.stand, ki: { customer_name: "Viktoria Muster" } });
    expect(await q.gespeichert(fremd, deal)).toBeNull();
    const [conv] = await sql`select id from inbox_conversations where workspace_id = ${ws} and deal_record_id = ${deal}`;
    await sql`insert into inbox_messages (id, workspace_id, conversation_id, direction, body, sent_at)
      values (${randomUUID()}, ${ws}, ${conv.id}, 'inbound', 'Noch was', ${new Date(Date.UTC(2026, 10, 1, 11, 0))})`;
    expect((await q.eingang(ws, deal)).stand).not.toBe(vorher.stand);
  });
});
