import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.BEWERTUNG_TEST_DATABASE_URL;

const held = vi.hoisted(() => ({
  client: null as { end: (opts?: { timeout?: number }) => Promise<void> } | null,
}));

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.BEWERTUNG_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 1 });
  held.client = client;
  return { db: drizzle(client, { schema }) };
});

import { tokenFreigeben } from "./bewertung-token";

async function clientSchliessen(): Promise<void> {
  const client = held.client;
  held.client = null;
  await client?.end({ timeout: 5 });
}

afterAll(async () => {
  await clientSchliessen();
});

describe.skipIf(!url)("tokenFreigeben gegen Postgres", () => {
  let sql: postgres.Sql | undefined;
  const ws = randomUUID();
  const obj = randomUUID();
  const deal = randomUUID();
  const anderer = randomUUID();
  const user = "user-freigabe";
  const tok = {
    unklar: `unklar-${randomUUID()}`,
    anspruchAlt: `alt-${randomUUID()}`,
    anspruchJung: `jung-${randomUUID()}`,
    gesendet: `gesendet-${randomUUID()}`,
    geklickt: `geklickt-${randomUUID()}`,
    fremd: `fremd-${randomUUID()}`,
  };

  beforeAll(async () => {
    sql = postgres(url!, { max: 1 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Token', ${`t-${ws}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${obj}, ${ws}, 'deals', 'Deal', 'Deals')`;
    await sql`insert into records (id, object_id) values (${deal}, ${obj})`;
    await sql`insert into records (id, object_id) values (${anderer}, ${obj})`;
    const ziel = "https://g.page/r/kottke/review";
    await sql`insert into review_tokens (token, workspace_id, deal_record_id, destination_url, zustand, quelle, created_at) values (${tok.unklar}, ${ws}, ${deal}, ${ziel}, 'unklar', 'alt', now())`;
    await sql`insert into review_tokens (token, workspace_id, deal_record_id, destination_url, zustand, quelle, created_at) values (${tok.anspruchAlt}, ${ws}, ${deal}, ${ziel}, 'anspruch', 'hand', now() - interval '30 minutes')`;
    await sql`insert into review_tokens (token, workspace_id, deal_record_id, destination_url, zustand, quelle, created_at) values (${tok.anspruchJung}, ${ws}, ${deal}, ${ziel}, 'anspruch', 'hand', now() - interval '1 minute')`;
    await sql`insert into review_tokens (token, workspace_id, deal_record_id, destination_url, zustand, quelle, created_at) values (${tok.gesendet}, ${ws}, ${deal}, ${ziel}, 'gesendet', 'hand', now() - interval '2 hours')`;
    await sql`insert into review_tokens (token, workspace_id, deal_record_id, destination_url, zustand, quelle, created_at, clicked_at) values (${tok.geklickt}, ${ws}, ${deal}, ${ziel}, 'unklar', 'alt', now(), now())`;
    await sql`insert into review_tokens (token, workspace_id, deal_record_id, destination_url, zustand, quelle, created_at) values (${tok.fremd}, ${ws}, ${anderer}, ${ziel}, 'unklar', 'alt', now())`;
  });

  afterAll(async () => {
    if (sql) {
      await sql`delete from workspaces where id = ${ws}`;
      await sql.end({ timeout: 5 });
    }
    await clientSchliessen();
  });

  it("gibt nur unklar und alten Anspruch frei und schreibt das Ereignis", async () => {
    const erst = await tokenFreigeben(ws, deal, user, new Date());
    expect(erst.freigegeben).toBe(2);
    const nochmal = await tokenFreigeben(ws, deal, user, new Date());
    expect(nochmal.freigegeben).toBe(0);

    const tokens = await sql!<{ token: string }[]>`select token from review_tokens where workspace_id = ${ws} order by token`;
    expect(tokens.map((t) => t.token).sort()).toEqual([tok.anspruchJung, tok.fremd, tok.geklickt, tok.gesendet].sort());

    const events = await sql!<{ meta: { token?: string; user_id?: string }; channel: string | null }[]>`
      select meta, channel from review_events where workspace_id = ${ws} and event_type = 'token_freigegeben'
    `;
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.meta).sort((a, b) => (a.token ?? "").localeCompare(b.token ?? ""))).toEqual(
      [
        { token: tok.anspruchAlt, user_id: user },
        { token: tok.unklar, user_id: user },
      ].sort((a, b) => a.token.localeCompare(b.token))
    );
    expect(events.every((e) => e.channel === null)).toBe(true);
  });
});
