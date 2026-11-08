import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.BEWERTUNG_TEST_DATABASE_URL;

const held = vi.hoisted(() => ({
  client: null as { end: (opts?: { timeout?: number }) => Promise<void> } | null,
}));

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.BEWERTUNG_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 5 });
  held.client = client;
  return { db: drizzle(client, { schema }) };
});

import { GET } from "./route";

async function clientSchliessen(): Promise<void> {
  const client = held.client;
  held.client = null;
  await client?.end({ timeout: 5 });
}

afterAll(async () => {
  await clientSchliessen();
});

const ZIEL = "https://g.page/r/kottke/review";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

describe.skipIf(!url)("GET /r/[token] gegen Postgres", () => {
  let sql: postgres.Sql | undefined;
  const ws = randomUUID();
  const obj = randomUUID();
  const statusAttr = randomUUID();
  const clickedAttr = randomUUID();
  const st = {
    sent: randomUUID(),
    clicked: randomUUID(),
    complaint: randomUUID(),
  };
  const dealRace = randomUUID();
  const dealComplaint = randomUUID();
  const dealPreview = randomUUID();
  const tokRace = `race-${randomUUID()}`;
  const tokComplaint = `complaint-${randomUUID()}`;
  const tokPreview = `preview-${randomUUID()}`;

  beforeAll(async () => {
    sql = postgres(url!, { max: 1 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Klick', ${`k-${ws}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${obj}, ${ws}, 'deals', 'Deal', 'Deals')`;
    await sql`insert into attributes (id, object_id, slug, title, type) values (${statusAttr}, ${obj}, 'review_request_status', 'Status', ${"status"}::text::attribute_type)`;
    await sql`insert into attributes (id, object_id, slug, title, type) values (${clickedAttr}, ${obj}, 'review_request_clicked_at', 'Klick', ${"timestamp"}::text::attribute_type)`;
    await sql`insert into statuses (id, attribute_id, title) values (${st.sent}, ${statusAttr}, 'sent_whatsapp')`;
    await sql`insert into statuses (id, attribute_id, title) values (${st.clicked}, ${statusAttr}, 'clicked')`;
    await sql`insert into statuses (id, attribute_id, title) values (${st.complaint}, ${statusAttr}, 'complaint_routed')`;
    for (const deal of [dealRace, dealComplaint, dealPreview]) {
      await sql`insert into records (id, object_id) values (${deal}, ${obj})`;
    }
    await sql`insert into record_values (id, record_id, attribute_id, text_value) values (${randomUUID()}, ${dealRace}, ${statusAttr}, ${st.sent})`;
    await sql`insert into record_values (id, record_id, attribute_id, text_value) values (${randomUUID()}, ${dealComplaint}, ${statusAttr}, ${st.complaint})`;
    const anlegen = async (token: string, deal: string) => {
      await sql!`insert into review_tokens (token, workspace_id, deal_record_id, destination_url, zustand, quelle) values (${token}, ${ws}, ${deal}, ${ZIEL}, 'gesendet', 'hand')`;
      await sql!`insert into review_events (id, workspace_id, deal_record_id, event_type, channel, meta) values (${randomUUID()}, ${ws}, ${deal}, 'sent_whatsapp', 'whatsapp', ${sql!.json({ token })})`;
    };
    await anlegen(tokRace, dealRace);
    await anlegen(tokComplaint, dealComplaint);
    await anlegen(tokPreview, dealPreview);
  });

  afterAll(async () => {
    if (sql) {
      await sql`delete from workspaces where id = ${ws}`;
      await sql.end({ timeout: 5 });
    }
    await clientSchliessen();
  });

  const aufruf = (token: string, ua: string) =>
    GET(
      new NextRequest(`http://localhost/r/${token}`, { headers: { "user-agent": ua, "x-forwarded-for": "203.0.113.5" } }),
      { params: Promise.resolve({ token }) }
    );

  it("zwei gleichzeitige erste Klicks ergeben ein Ereignis ohne ip im meta", async () => {
    const antworten = await Promise.all(Array.from({ length: 8 }, () => aufruf(tokRace, IPHONE)));
    expect(antworten.every((r) => r.status === 302 && r.headers.get("location") === ZIEL)).toBe(true);

    const events = await sql!<{ meta: Record<string, unknown> }[]>`
      select meta from review_events where deal_record_id = ${dealRace} and event_type = 'clicked'
    `;
    expect(events).toHaveLength(1);
    expect(events[0]!.meta).toEqual({ token: tokRace });
    expect(events[0]!.meta).not.toHaveProperty("ip");
    expect(events[0]!.meta).not.toHaveProperty("user_agent");

    const [tok] = await sql!<{ zustand: string; click_ip: string | null; clicked_at: Date | null }[]>`
      select zustand, click_ip, clicked_at from review_tokens where token = ${tokRace}
    `;
    expect(tok!.zustand).toBe("gesendet");
    expect(tok!.clicked_at).not.toBeNull();
    expect(tok!.click_ip).toBe("203.0.113.5");

    const [status] = await sql!<{ text_value: string | null; referenced_record_id: string | null }[]>`
      select text_value, referenced_record_id from record_values where record_id = ${dealRace} and attribute_id = ${statusAttr}
    `;
    expect(status!.text_value).toBe(st.clicked);
    expect(status!.referenced_record_id).toBeNull();
    const [klick] = await sql!<{ da: boolean }[]>`
      select timestamp_value is not null as da from record_values where record_id = ${dealRace} and attribute_id = ${clickedAttr}
    `;
    expect(klick!.da).toBe(true);
  });

  it("Vorschau zählt nicht, complaint_routed bleibt", async () => {
    const vorschau = await aufruf(tokPreview, "WhatsApp/2.23.20.0 A");
    expect(vorschau.status).toBe(302);
    const [previewTok] = await sql!<{ clicked_at: Date | null }[]>`select clicked_at from review_tokens where token = ${tokPreview}`;
    expect(previewTok!.clicked_at).toBeNull();
    const previewEvents = await sql!`select 1 from review_events where deal_record_id = ${dealPreview} and event_type = 'clicked'`;
    expect(previewEvents).toHaveLength(0);

    const klage = await aufruf(tokComplaint, IPHONE);
    expect(klage.status).toBe(302);
    const [status] = await sql!<{ text_value: string | null }[]>`
      select text_value from record_values where record_id = ${dealComplaint} and attribute_id = ${statusAttr}
    `;
    expect(status!.text_value).toBe(st.complaint);
    const [zeit] = await sql!<{ da: boolean }[]>`
      select timestamp_value is not null as da from record_values where record_id = ${dealComplaint} and attribute_id = ${clickedAttr}
    `;
    expect(zeit!.da).toBe(true);
    const meta = await sql!<{ meta: Record<string, unknown> }[]>`
      select meta from review_events where deal_record_id = ${dealComplaint} and event_type = 'clicked'
    `;
    expect(meta).toHaveLength(1);
    expect(meta[0]!.meta).toEqual({ token: tokComplaint });
  });
});
