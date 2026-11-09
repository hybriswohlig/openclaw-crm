import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Plan 15, Bauteil 8: `ladeChatAdressen` gegen eine echte Postgres-DB (ANNAHME_TEST_DATABASE_URL).
 * Viktoria-Fall, Vorrang KI vor Erkennung, nur eingehende Nachrichten, Mandantentrennung.
 */
const url = process.env.ANNAHME_TEST_DATABASE_URL;

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  return { db: drizzle(pg(process.env.ANNAHME_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 4 }), { schema }) };
});

describe.skipIf(!url)("ladeChatAdressen (DB, Plan 15)", { timeout: 30_000 }, () => {
  let sql: postgres.Sql;
  let ladeChatAdressen: typeof import("./chat-adressen").ladeChatAdressen;
  const ws = randomUUID();
  const fremd = randomUUID();
  const deal = `deal-${randomUUID()}`;
  const dealKi = `deal-${randomUUID()}`;

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
  }

  beforeAll(async () => {
    sql = postgres(url!, { max: 2 });
    for (const w of [ws, fremd]) {
      await sql`insert into workspaces (id, name, slug) values (${w}, 'Test', ${`t-${w}`})`;
      await sql`insert into channel_accounts (id, workspace_id, channel_type, name, address) values (${`ch-${w}`}, ${w}, 'whatsapp', 'WA', ${`+49${w.slice(0, 8)}`})`;
    }
    const obj = randomUUID();
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${obj}, ${ws}, 'deals', 'Deal', 'Deals')`;
    await sql`insert into records (id, object_id) values (${deal}, ${obj}), (${dealKi}, ${obj})`;
    ({ ladeChatAdressen } = await import("./chat-adressen"));
    // Viktoria: beide PLZ in Kundennachrichten; eine eigene ausgehende Nachricht nennt andere PLZ.
    await gespraech(ws, deal, [
      { richtung: "outbound", text: "Ziehen Sie von 10115 Berlin nach 80331 München?", min: 0 },
      { richtung: "inbound", text: "Hallo, wir ziehen von 70372 Stuttgart", min: 1 },
      { richtung: "inbound", text: "nach 71032 Böblingen, 3 Zimmer", min: 2 },
    ]);
    // Fremder Workspace mit derselben Deal-ID darf nichts beitragen.
    await gespraech(fremd, dealKi, [{ richtung: "inbound", text: "von 20095 Hamburg nach 50667 Köln", min: 0 }]);
    await gespraech(ws, dealKi, [{ richtung: "inbound", text: "von 70372 Stuttgart nach 71032 Böblingen", min: 0 }]);
    await sql`insert into activity_events (id, workspace_id, record_id, object_slug, event_type, payload)
      values (${randomUUID()}, ${ws}, ${dealKi}, 'deals', 'ai.insights_extracted', ${sql.json({ adressen: { von: "Königstr. 1, 70173 Stuttgart", nach: null } })})`;
  });
  afterAll(async () => {
    for (const w of [ws, fremd]) {
      await sql`delete from activity_events where workspace_id = ${w}`;
      await sql`delete from inbox_messages where workspace_id = ${w}`;
      await sql`delete from inbox_conversations where workspace_id = ${w}`;
      await sql`delete from inbox_contacts where workspace_id = ${w}`;
      await sql`delete from channel_accounts where workspace_id = ${w}`;
      await sql`delete from records where id in (${deal}, ${dealKi})`;
      await sql`delete from objects where workspace_id = ${w}`;
      await sql`delete from workspaces where id = ${w}`;
    }
    await sql.end();
  });

  it("Viktoria: Lead leer, beide PLZ aus eingehenden Nachrichten, ausgehende zählen nicht", async () => {
    expect(await ladeChatAdressen(ws, deal, { von: null, nach: null })).toEqual({
      von: "70372 Stuttgart",
      nach: "71032 Böblingen",
      quelleVon: "erkennung",
      quelleNach: "erkennung",
    });
  });

  it("Lead vor KI vor Erkennung", async () => {
    expect(await ladeChatAdressen(ws, dealKi, { von: null, nach: null })).toEqual({
      von: "70173 Stuttgart",
      nach: "71032 Böblingen",
      quelleVon: "ki",
      quelleNach: "erkennung",
    });
    expect(await ladeChatAdressen(ws, dealKi, { von: "Lead 1, 70000 Ort", nach: null })).toMatchObject({ von: null, quelleVon: null, nach: "71032 Böblingen" });
    expect(await ladeChatAdressen(ws, dealKi, { von: "a", nach: "b" })).toBeNull();
  });

  it("fremder Workspace sieht nichts", async () => {
    expect(await ladeChatAdressen(fremd, deal, { von: null, nach: null })).toBeNull();
    const imFremden = await ladeChatAdressen(fremd, dealKi, { von: null, nach: null });
    expect(imFremden).toMatchObject({ von: "20095 Hamburg", nach: "50667 Köln" });
  });
});
