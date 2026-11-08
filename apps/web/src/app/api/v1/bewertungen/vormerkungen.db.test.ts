import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.BEWERTUNG_TEST_DATABASE_URL;

const held = vi.hoisted(() => ({
  client: null as { end: (opts?: { timeout?: number }) => Promise<void> } | null,
  auth: vi.fn(),
}));

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.BEWERTUNG_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 1 });
  held.client = client;
  return { db: drizzle(client, { schema }) };
});

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: held.auth };
});

import { PATCH } from "./vormerkungen/[id]/route";

async function clientSchliessen(): Promise<void> {
  const client = held.client;
  held.client = null;
  await client?.end({ timeout: 5 });
}

afterAll(async () => {
  await clientSchliessen();
});

describe.skipIf(!url)("PATCH Vormerkung gegen Postgres", () => {
  let sql: postgres.Sql | undefined;
  const ws = randomUUID();
  const fremd = randomUUID();
  const obj = randomUUID();
  const objF = randomUUID();
  const deal = randomUUID();
  const dealF = randomUUID();
  const eigene = randomUUID();
  const fremde = randomUUID();
  const schon = randomUUID();

  beforeAll(async () => {
    sql = postgres(url!, { max: 1 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Vorm', ${`v-${ws}`}), (${fremd}, 'Fremd', ${`v-${fremd}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${obj}, ${ws}, 'deals', 'Deal', 'Deals'), (${objF}, ${fremd}, 'deals', 'Deal', 'Deals')`;
    await sql`insert into records (id, object_id) values (${deal}, ${obj}), (${dealF}, ${objF})`;
    const faellig = new Date("2026-11-09T08:00:00.000Z");
    const frist = new Date("2026-11-20T08:00:00.000Z");
    await sql`insert into review_vormerkungen (id, workspace_id, deal_record_id, art, status, faellig_ab, frist_bis) values (${eigene}, ${ws}, ${deal}, 'entwurf', 'offen', ${faellig}, ${frist})`;
    await sql`insert into review_vormerkungen (id, workspace_id, deal_record_id, art, status, faellig_ab, frist_bis) values (${fremde}, ${fremd}, ${dealF}, 'entwurf', 'offen', ${faellig}, ${frist})`;
    await sql`insert into review_vormerkungen (id, workspace_id, deal_record_id, art, status, faellig_ab, frist_bis) values (${schon}, ${ws}, ${deal}, 'auto', 'gesendet', ${faellig}, ${frist})`;
    held.auth.mockResolvedValue({
      userId: "usr_1",
      workspaceId: ws,
      workspaceRole: "admin",
      authMethod: "cookie",
    });
  });

  afterAll(async () => {
    if (sql) {
      await sql`delete from workspaces where id in (${ws}, ${fremd})`;
      await sql.end({ timeout: 5 });
    }
    await clientSchliessen();
  });

  const patch = (id: string) =>
    PATCH(
      new NextRequest(`http://localhost/api/v1/bewertungen/vormerkungen/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ aktion: "verwerfen" }),
      }),
      { params: Promise.resolve({ id }) }
    );

  it("fremde und nicht offene Zeilen sind 404, die eigene offene wird verworfen", async () => {
    expect((await patch(fremde)).status).toBe(404);
    expect((await patch(schon)).status).toBe(404);
    const [fremdNoch] = await sql!<{ status: string }[]>`select status from review_vormerkungen where id = ${fremde}`;
    expect(fremdNoch!.status).toBe("offen");

    const ok = await patch(eigene);
    expect(ok.status).toBe(200);
    const [zeile] = await sql!<{ status: string; erledigt_von: string | null }[]>`
      select status, erledigt_von from review_vormerkungen where id = ${eigene}
    `;
    expect(zeile).toMatchObject({ status: "verworfen", erledigt_von: "usr_1" });
    expect((await patch(eigene)).status).toBe(404);
  });
});
