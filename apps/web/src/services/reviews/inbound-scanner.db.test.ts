import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.BEWERTUNG_TEST_DATABASE_URL;

const held = vi.hoisted(() => ({
  client: null as { end: (opts?: { timeout?: number }) => Promise<void> } | null,
  sendSms: vi.fn(async () => ({ id: "sms-1", channel: "sms" as const })),
}));

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.BEWERTUNG_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 1 });
  held.client = client;
  return { db: drizzle(client, { schema }) };
});

vi.mock("@/lib/messaging", () => ({
  sendSms: held.sendSms,
  MessagingSendError: class MessagingSendError extends Error {
    cause: { provider: string };
    constructor(message: string, cause: { provider: string }) {
      super(message);
      this.name = "MessagingSendError";
      this.cause = cause;
    }
  },
}));

import { scanInboundReply } from "./inbound-scanner";

async function clientSchliessen(): Promise<void> {
  const client = held.client;
  held.client = null;
  await client?.end({ timeout: 5 });
}

afterAll(async () => {
  await clientSchliessen();
});

describe("WhatsApp-Schalter", () => {
  it("bleibt aus, solange REVIEWS_INBOUND_SCAN_WHATSAPP nicht gesetzt ist", async () => {
    const vorher = process.env.REVIEWS_INBOUND_SCAN_WHATSAPP;
    delete process.env.REVIEWS_INBOUND_SCAN_WHATSAPP;
    const r = await scanInboundReply({
      workspaceId: "ws",
      conversationId: "c",
      messageId: "m",
      channel: "whatsapp",
      body: "Das Sofa ist kaputt",
      contactId: "k",
      customerAddress: "+491701234567",
      sentAt: new Date(),
    });
    expect(r).toEqual({ triggered: false, reason: "whatsapp_disabled_in_phase_1" });
    if (vorher === undefined) delete process.env.REVIEWS_INBOUND_SCAN_WHATSAPP;
    else process.env.REVIEWS_INBOUND_SCAN_WHATSAPP = vorher;
  });
});

describe.skipIf(!url)("scanInboundReply gegen Postgres", () => {
  let sql: postgres.Sql | undefined;
  const ws = randomUUID();
  const deals = randomUUID();
  const firmen = randomUUID();
  const people = randomUUID();
  const deal = randomUUID();
  const person = randomUUID();
  const oc = randomUUID();
  const statusAttr = randomUUID();
  const hitsAttr = randomUUID();
  const nameAttr = randomUUID();
  const brandAttr = randomUUID();
  const firmaAttr = randomUUID();
  const nameFirma = randomUUID();
  const sent = randomUUID();
  const complaint = randomUUID();
  const konto = randomUUID();
  const kontakt = randomUUID();
  const gespraech = randomUUID();
  const ohneDeal = randomUUID();

  beforeAll(async () => {
    sql = postgres(url!, { max: 1 });
    const s = sql;
    await s`insert into workspaces (id, name, slug) values (${ws}, 'Scanner', ${`s-${ws}`})`;
    await s`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${deals}, ${ws}, 'deals', 'Deal', 'Deals')`;
    await s`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${firmen}, ${ws}, 'operating_companies', 'Firma', 'Firmen')`;
    await s`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${people}, ${ws}, 'people', 'Person', 'Personen')`;
    await s`insert into records (id, object_id) values (${deal}, ${deals})`;
    await s`insert into records (id, object_id) values (${person}, ${people})`;
    await s`insert into records (id, object_id) values (${oc}, ${firmen})`;

    const attr = async (id: string, objectId: string, slug: string, type: string) => {
      await s`insert into attributes (id, object_id, slug, title, type) values (${id}, ${objectId}, ${slug}, ${slug}, ${type}::text::attribute_type)`;
    };
    await attr(statusAttr, deals, "review_request_status", "status");
    await attr(hitsAttr, deals, "complaint_keywords_hit", "text");
    await attr(nameAttr, deals, "name", "text");
    await attr(brandAttr, deals, "brand", "text");
    await attr(firmaAttr, deals, "operating_company", "record_reference");
    await attr(nameFirma, firmen, "name", "text");
    await s`insert into statuses (id, attribute_id, title) values (${sent}, ${statusAttr}, 'sent_whatsapp')`;
    await s`insert into statuses (id, attribute_id, title) values (${complaint}, ${statusAttr}, 'complaint_routed')`;
    await s`insert into record_values (id, record_id, attribute_id, text_value, referenced_record_id) values (${randomUUID()}, ${deal}, ${statusAttr}, ${complaint}, ${person})`;
    await s`insert into record_values (id, record_id, attribute_id, text_value) values (${randomUUID()}, ${deal}, ${nameAttr}, 'Max Mustermann')`;
    await s`insert into record_values (id, record_id, attribute_id, text_value) values (${randomUUID()}, ${deal}, ${brandAttr}, 'kottke')`;
    await s`insert into record_values (id, record_id, attribute_id, referenced_record_id) values (${randomUUID()}, ${deal}, ${firmaAttr}, ${oc})`;
    await s`insert into record_values (id, record_id, attribute_id, text_value) values (${randomUUID()}, ${oc}, ${nameFirma}, 'Ceylan Umzüge')`;
    await s`insert into review_events (id, workspace_id, deal_record_id, event_type, channel, at) values (${randomUUID()}, ${ws}, ${deal}, 'sent_sms', 'sms', now())`;
    await s`insert into channel_accounts (id, workspace_id, channel_type, name, address) values (${konto}, ${ws}, ${"sms"}::text::channel_type, 'SMS', ${`sms-${konto}`})`;
    await s`insert into inbox_contacts (id, workspace_id, crm_record_id, display_name) values (${kontakt}, ${ws}, ${person}, 'Anna')`;
    await s`insert into inbox_conversations (id, workspace_id, channel_account_id, contact_id, deal_record_id) values (${gespraech}, ${ws}, ${konto}, ${kontakt}, ${deal})`;
    await s`insert into inbox_conversations (id, workspace_id, channel_account_id, contact_id) values (${ohneDeal}, ${ws}, ${konto}, ${kontakt})`;
  });

  afterAll(async () => {
    if (sql) {
      await sql`delete from workspaces where id = ${ws}`;
      await sql.end({ timeout: 5 });
    }
    await clientSchliessen();
  });

  it("nimmt den Deal aus dem Gespräch, liest den Status aus text_value und die Marke aus dem Firmennamen", async () => {
    const ohne = await scanInboundReply({
      workspaceId: ws,
      conversationId: ohneDeal,
      messageId: randomUUID(),
      channel: "sms",
      body: "Das Sofa ist kaputt",
      contactId: kontakt,
      customerAddress: "+491701234567",
      sentAt: new Date(),
    });
    expect(ohne).toMatchObject({ triggered: false, reason: "no_deal_link" });
    expect(ohne).not.toHaveProperty("dealRecordId");

    const schon = await scanInboundReply({
      workspaceId: ws,
      conversationId: gespraech,
      messageId: randomUUID(),
      channel: "sms",
      body: "Das Sofa ist kaputt",
      contactId: kontakt,
      customerAddress: "+491701234567",
      sentAt: new Date(),
    });
    expect(schon).toMatchObject({ triggered: false, reason: "status_already_complaint_routed", dealRecordId: deal });
    expect(held.sendSms).not.toHaveBeenCalled();

    await sql!`update record_values set text_value = ${sent} where record_id = ${deal} and attribute_id = ${statusAttr}`;

    const r = await scanInboundReply({
      workspaceId: ws,
      conversationId: gespraech,
      messageId: randomUUID(),
      channel: "sms",
      body: "Das Sofa ist kaputt",
      contactId: kontakt,
      customerAddress: "+491701234567",
      sentAt: new Date(),
    });
    expect(r).toMatchObject({ triggered: true, dealRecordId: deal });
    expect(r).not.toMatchObject({ dealRecordId: person });

    const [status] = await sql!<{ text_value: string | null; referenced_record_id: string | null }[]>`
      select text_value, referenced_record_id from record_values where record_id = ${deal} and attribute_id = ${statusAttr}
    `;
    expect(status!.text_value).toBe(complaint);
    expect(status!.referenced_record_id).toBeNull();
    const [hits] = await sql!<{ text_value: string | null }[]>`
      select text_value from record_values where record_id = ${deal} and attribute_id = ${hitsAttr}
    `;
    expect(hits!.text_value).toContain("kaputt");
    expect(held.sendSms).toHaveBeenCalled();
    const body = String((held.sendSms.mock.calls as unknown[][]).at(-1)?.[1] ?? "");
    expect(body).toContain("Ceylan-Team");
    expect(body).not.toContain("Kottke-Team");
  });
});
