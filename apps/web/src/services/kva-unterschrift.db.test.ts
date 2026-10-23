import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Reservierung und Ablage der Unterschrift gegen eine echte Postgres-Datenbank.
 * Läuft nur mit UNTERSCHRIFT_TEST_DATABASE_URL: eine Wegwerf-DB mit aktuellem
 * Schema (z. B. Docker postgres:16 plus `drizzle-kit push`). Nie gegen eine
 * echte Datenbank, der Test legt Zeilen an und löscht sie wieder.
 */
const url = process.env.UNTERSCHRIFT_TEST_DATABASE_URL;

describe.skipIf(!url)("Unterschrift: Reservierung und Ablage (DB)", () => {
  let sql: postgres.Sql;
  let svc: typeof import("./kva-unterschrift");
  const ws = randomUUID();
  const obj = randomUUID();
  const deal = randomUUID();
  const link = randomUUID();
  let confirmationId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    sql = postgres(url!, { max: 1 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Test', ${`t-${ws}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${obj}, ${ws}, 'deals', 'Deal', 'Deals')`;
    await sql`insert into records (id, object_id) values (${deal}, ${obj})`;
    await sql`insert into customer_status_links (id, workspace_id, deal_record_id, token) values (${link}, ${ws}, ${deal}, ${`tok-${link}`})`;
    svc = await import("./kva-unterschrift");
  });

  beforeEach(async () => {
    confirmationId = randomUUID();
    await sql`delete from kva_confirmations where deal_record_id = ${deal}`;
    await sql`delete from deal_documents where deal_record_id = ${deal}`;
    await sql`insert into kva_confirmations (id, workspace_id, deal_record_id, customer_link_id, quotation_snapshot, confirmed_total_cents, agb_version_accepted, ip_address, user_agent)
      values (${confirmationId}, ${ws}, ${deal}, ${link}, ${sql.json({})}, 100000, 'test', '203.0.113.5', 'test')`;
  });

  afterAll(async () => {
    await sql`delete from workspaces where id = ${ws}`;
    await sql.end();
  });

  const payload = { art: "getippt" as const, name: "Anna Muster", bildDataUrl: null, annahmeAm: "2026-10-22T08:15:00.000Z" };
  const reservieren = () =>
    svc.reservieren({ confirmationId, payload, ipAddress: "203.0.113.5", userAgent: "test", bildSha256: "x" });
  const ablegen = (reservedAt: Date) =>
    svc.vertragAblegen({
      confirmationId,
      reservedAt,
      workspaceId: ws,
      dealRecordId: deal,
      fileName: "Vertrag-Test.pdf",
      pdf: Buffer.from("%PDF-1.4 test"),
      vertragSha256: "abc",
    });
  const anzahlDokumente = async () =>
    (await sql`select count(*)::int as n from deal_documents where deal_record_id = ${deal}`)[0].n as number;
  const zeile = async () =>
    (await sql`select unterschrift_at, unterschrift_name, vertrag_document_id from kva_confirmations where id = ${confirmationId}`)[0];

  it("Doppelklick: die zweite Reservierung scheitert", async () => {
    expect(await reservieren()).toBeInstanceOf(Date);
    expect(await reservieren()).toBeNull();
  });

  it("alter Request nach Übernahme: Freigabe und Ablage treffen die neue Reservierung nicht", async () => {
    await reservieren();
    // Request A hängt: seine Reservierung ist älter als zwei Minuten.
    const [{ unterschrift_at: aAlt }] = await sql`update kva_confirmations set unterschrift_at = unterschrift_at - interval '3 minutes'
      where id = ${confirmationId} returning unterschrift_at`;
    const b = await reservieren();
    expect(b).toBeInstanceOf(Date);

    await svc.freigeben(confirmationId, aAlt as Date);
    expect((await zeile()).unterschrift_name).toBe("Anna Muster");

    expect(await ablegen(aAlt as Date)).toBeNull();
    expect(await anzahlDokumente()).toBe(0);

    const id = await ablegen(b!);
    expect(typeof id).toBe("string");
    expect(await anzahlDokumente()).toBe(1);
    expect((await zeile()).vertrag_document_id).toBe(id);
  });

  it("Aufhebung während der Unterschrift: kein Vertrag wird abgelegt", async () => {
    const at = (await reservieren())!;
    await sql`update kva_confirmations set superseded_at = now() where id = ${confirmationId}`;
    expect(await ablegen(at)).toBeNull();
    expect(await anzahlDokumente()).toBe(0);
  });

  it("Fehler beim Bauen: die eigene Reservierung wird freigegeben", async () => {
    const at = (await reservieren())!;
    await svc.freigeben(confirmationId, at);
    expect((await zeile()).unterschrift_at).toBeNull();
    expect(await reservieren()).toBeInstanceOf(Date);
  });
});
