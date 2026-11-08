import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Wegwerf-DB. Eine WhatsApp von vor zwei Stunden öffnet das 24-Stunden-Fenster
 * und ist zugleich die letzte Kundennachricht: `erinnerungFaellig` liefert
 * dann `kunde_schreibt` (Ruhe drei Tage), also keinen Entwurf. Der Entwurf
 * läuft über E-Mail, letzte eingehende Nachricht vier Tage vorher.
 */
const url = process.env.GELD_TEST_DATABASE_URL;
const TOKEN = "statuslinktokenvalue1";
const NOV = new Date("2026-11-10T09:00:00Z");

const gate = vi.hoisted(() => ({
  workspaces: new Set<string>(),
  draftId: "",
  calls: [] as { key: string; text: string }[],
  endDb: (async () => {}) as () => Promise<void>,
}));

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.GELD_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 1 });
  gate.endDb = () => client.end({ timeout: 5 });
  return { db: drizzle(client, { schema }) };
});

vi.mock("@/services/agent/agent-drafts", () => ({
  createAgentDraft: async (input: { workspaceId: string; idempotencyKey?: string; draftText?: string }) => {
    if (!gate.workspaces.has(input.workspaceId)) {
      return { ok: false, status: 404, error: "conversation_not_found", message: "fremd" };
    }
    gate.calls.push({ key: input.idempotencyKey ?? "", text: input.draftText ?? "" });
    return {
      ok: true,
      created: true,
      draft: {
        id: gate.draftId,
        conversationId: null,
        dealRecordId: "",
        messageClass: "followup",
        status: "pending",
        expiresAt: new Date().toISOString(),
        gateAllowed: null,
        gateReasons: [],
        priceFlag: false,
      },
    };
  },
}));

vi.mock("@/services/customer-portal-data", () => ({
  ensureCustomerStatusLink: async () => ({ token: TOKEN, created: false, skipped: false }),
  loadContextByToken: async () => ({
    customerDisplayName: "Anna Berger",
    branding: { displayName: "Kottke Umzüge" },
  }),
}));

import { erinnerungSchluessel, erinnerungText } from "@/lib/geld";
import { runZahlungserinnerung } from "./lauf";

describe.skipIf(!url)("Zahlungserinnerung gegen Postgres", () => {
  let sql!: postgres.Sql;
  const ws = randomUUID();
  const dealsObj = randomUUID();
  const ocObj = randomUUID();
  const attrStage = randomUUID();
  const attrOc = randomUUID();
  const attrName = randomUUID();
  const statusId = randomUUID();
  const ocAn = randomUUID();
  const ocAus = randomUUID();
  const dealMail = randomUUID();
  const dealWa = randomUUID();
  const dealAus = randomUUID();
  const invMail = randomUUID();
  const invWa = randomUUID();
  const invAus = randomUUID();
  const draftId = randomUUID();

  beforeAll(async () => {
    sql = postgres(url!, { max: 1 });
    gate.workspaces.add(ws);
    gate.draftId = draftId;
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'P9 Zahlung', ${`p9c-${ws}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values
      (${dealsObj}, ${ws}, 'deals', 'Deal', 'Deals'),
      (${ocObj}, ${ws}, 'operating_companies', 'Firma', 'Firmen')`;
    await sql`insert into attributes (id, object_id, slug, title, type) values
      (${attrStage}, ${dealsObj}, 'stage', 'Stufe', 'status'),
      (${attrOc}, ${dealsObj}, 'operating_company', 'Firma', 'record_reference'),
      (${attrName}, ${ocObj}, 'name', 'Name', 'text')`;
    await sql`insert into statuses (id, attribute_id, title, color, stage_category) values
      (${statusId}, ${attrStage}, 'Durchgeführt', '#888888', 'done_unpaid')`;
    await sql`insert into records (id, object_id) values
      (${ocAn}, ${ocObj}), (${ocAus}, ${ocObj}),
      (${dealMail}, ${dealsObj}), (${dealWa}, ${dealsObj}), (${dealAus}, ${dealsObj})`;
    await sql`insert into record_values (id, record_id, attribute_id, text_value) values
      (${randomUUID()}, ${ocAn}, ${attrName}, 'Kottke Umzüge'),
      (${randomUUID()}, ${ocAus}, ${attrName}, 'Kottke Still')`;
    for (const [deal, oc] of [
      [dealMail, ocAn],
      [dealWa, ocAn],
      [dealAus, ocAus],
    ] as const) {
      await sql`insert into record_values (id, record_id, attribute_id, text_value) values
        (${randomUUID()}, ${deal}, ${attrStage}, ${statusId})`;
      await sql`insert into record_values (id, record_id, attribute_id, referenced_record_id) values
        (${randomUUID()}, ${deal}, ${attrOc}, ${oc})`;
    }
    await sql`insert into company_settings (operating_company_record_id, workspace_id, erinnerung_modus) values
      (${ocAn}, ${ws}, 'entwurf'),
      (${ocAus}, ${ws}, 'aus')`;
    await sql`insert into deal_invoices (
      id, workspace_id, deal_record_id, operating_company_id, nummer, herkunft, status, brutto_cent, rechnungstag, faellig_am
    ) values
      (${invMail}, ${ws}, ${dealMail}, ${ocAn}, 'RE-2026-0001', 'crm', 'gestellt', 50000, '2026-10-31', '2026-10-31'),
      (${invWa}, ${ws}, ${dealWa}, ${ocAn}, 'RE-2026-0002', 'crm', 'gestellt', 50000, '2026-10-31', '2026-10-31'),
      (${invAus}, ${ws}, ${dealAus}, ${ocAus}, 'RE-2026-0003', 'crm', 'gestellt', 50000, '2026-10-31', '2026-10-31')`;

    await gespraech(sql, ws, dealMail, ocAn, "email", "mail@kottke.test", "2026-11-06T08:00:00Z", "Bis bald");
    await gespraech(sql, ws, dealWa, ocAn, "whatsapp", "+491700000001", "2026-11-10T07:00:00Z", "Danke");
    await gespraech(sql, ws, dealAus, ocAus, "email", "still@kottke.test", "2026-11-06T08:00:00Z", "Bis bald");

    await sql`insert into agent_drafts (id, workspace_id, deal_record_id, message_class, draft_text, status)
      values (${draftId}, ${ws}, ${dealMail}, 'followup', 'platzhalter', 'pending')`;
  });

  afterAll(async () => {
    try {
      if (sql) await sql`delete from workspaces where id = ${ws}`;
    } finally {
      await sql?.end({ timeout: 5 });
      await gate.endDb();
    }
  });

  it("legt einen Entwurf an, wiederholt ihn nicht und stoppt ihn nach Zahlung", async () => {
    const draussen = await runZahlungserinnerung(new Date("2026-07-07T06:30:00Z"));
    expect(draussen).toMatchObject({ workspaces: 0, geprueft: 0, entwuerfe: 0, gestoppt: 0, fehler: 0 });

    const sommer = await runZahlungserinnerung(new Date("2026-07-07T07:30:00Z"));
    expect(sommer.workspaces).toBeGreaterThan(0);
    expect(sommer.entwuerfe).toBe(0);
    expect(await erinnerungen(sql, invMail)).toHaveLength(0);

    gate.calls = [];
    const erster = await runZahlungserinnerung(NOV);
    expect(erster.entwuerfe).toBe(1);
    expect(await erinnerungen(sql, invMail)).toEqual([
      expect.objectContaining({ stufe: 1, status: "entwurf", kanal: "email", draft_id: draftId }),
    ]);
    expect(await erinnerungen(sql, invWa)).toHaveLength(0);
    expect(await erinnerungen(sql, invAus)).toHaveLength(0);
    expect(gate.calls).toHaveLength(1);
    expect(gate.calls[0]?.key).toBe(erinnerungSchluessel(invMail, 1));
    expect(gate.calls[0]?.text).toBe(
      erinnerungText({
        anrede: "du",
        stufe: 1,
        name: "Anna",
        nummer: "RE-2026-0001",
        rechnungstag: "2026-10-31",
        betragCent: 50000,
        faelligAm: "2026-10-31",
        portalLink: `https://openclaw-crm-web.vercel.app/s/${TOKEN}`,
        signatur: "Kottke Umzüge",
      })
    );
    expect((await sql`select status from agent_drafts where id = ${draftId}`)[0]?.status).toBe("pending");

    const zweiter = await runZahlungserinnerung(NOV);
    expect(zweiter.entwuerfe).toBe(0);
    expect(gate.calls).toHaveLength(1);
    expect(await erinnerungen(sql, invMail)).toHaveLength(1);

    await sql`insert into payments (id, workspace_id, deal_record_id, operating_company_id, date, amount, tax_treatment)
      values (${randomUUID()}, ${ws}, ${dealMail}, ${ocAn}, '2026-11-10', '500.00', 'betriebseinnahme')`;
    const dritter = await runZahlungserinnerung(NOV);
    expect(dritter.gestoppt).toBeGreaterThanOrEqual(1);
    const nachZahlung = await erinnerungen(sql, invMail);
    expect(nachZahlung).toHaveLength(1);
    expect(nachZahlung[0]).toMatchObject({ status: "gestoppt", stopp_grund: "bezahlt" });
    expect((await sql`select status from agent_drafts where id = ${draftId}`)[0]?.status).toBe("superseded");
    expect(gate.calls).toHaveLength(1);
  });
});

async function erinnerungen(sql: postgres.Sql, invoiceId: string) {
  return sql<{ stufe: number; status: string; kanal: string | null; draft_id: string | null; stopp_grund: string | null }[]>`
    select stufe, status, kanal, draft_id, stopp_grund
    from payment_reminders
    where invoice_id = ${invoiceId}
    order by stufe
  `;
}

async function gespraech(
  sql: postgres.Sql,
  ws: string,
  deal: string,
  oc: string,
  kanal: "email" | "whatsapp",
  adresse: string,
  gesendet: string,
  body: string
) {
  const account = randomUUID();
  const contact = randomUUID();
  const conv = randomUUID();
  await sql`insert into channel_accounts (id, workspace_id, operating_company_record_id, channel_type, name, address)
    values (${account}, ${ws}, ${oc}, ${kanal}, ${kanal}, ${adresse})`;
  await sql`insert into inbox_contacts (id, workspace_id, display_name) values (${contact}, ${ws}, 'Anna Berger')`;
  await sql`insert into inbox_conversations (
    id, workspace_id, channel_account_id, contact_id, deal_record_id, external_thread_id, last_message_at
  ) values (
    ${conv}, ${ws}, ${account}, ${contact}, ${deal}, ${conv}, ${gesendet}
  )`;
  await sql`insert into inbox_messages (id, workspace_id, conversation_id, direction, status, body, sent_at)
    values (${randomUUID()}, ${ws}, ${conv}, 'inbound', 'received', ${body}, ${gesendet})`;
}
