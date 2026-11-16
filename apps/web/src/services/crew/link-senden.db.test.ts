import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { crewTestSchemaAnlegen } from "./testdb";

/** crewLinkSenden gegen die Wegwerf-Postgres; Absender und Versand sind Attrappen (nie echtes WhatsApp). */
const url = process.env.EINSATZ_TEST_DATABASE_URL;
const h = vi.hoisted(() => ({ schema: `crew_senden_${Date.now().toString(36)}` }));

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.EINSATZ_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", {
    max: 2,
    onnotice: () => {},
    connection: { search_path: h.schema },
  });
  return { db: drizzle(client, { schema }) };
});
vi.mock("@/services/inbox-whatsapp", () => ({
  sendBaileysDirektText: () => {
    throw new Error("echter Versand im Test");
  },
}));

describe.skipIf(!url)("crewLinkSenden (DB)", { timeout: 20_000 }, () => {
  let sql: postgres.Sql;
  let mod: typeof import("./link-senden");
  let links: typeof import("./links");
  const senden = vi.fn();
  const absender = vi.fn();
  const deps = () => ({ senden, absender });

  beforeAll(async () => {
    sql = postgres(url!, { max: 1, onnotice: () => {} });
    await crewTestSchemaAnlegen(sql, h.schema);
    await sql.unsafe(`
      INSERT INTO workspaces VALUES ('w1'), ('w2');
      INSERT INTO employees (id, workspace_id, name) VALUES ('e1', 'w1', 'Mehmet Ali Yilmaz'), ('e2', 'w1', 'Ben Bauer'), ('e3', 'w1', 'Cem Can'), ('e4', 'w1', 'Dana Dorn');
      UPDATE employees SET phone = '0151 2345678', phone_canonical = '+491512345678', locale = 'tr' WHERE id = 'e1';
      UPDATE employees SET phone_canonical = '+491700000003', active = false WHERE id = 'e3';
      UPDATE employees SET phone_canonical = '+491700000004' WHERE id = 'e4';
    `);
    mod = await import("./link-senden");
    links = await import("./links");
  }, 60_000);

  afterAll(async () => {
    await sql?.unsafe(`DROP SCHEMA ${h.schema} CASCADE`);
    await sql?.end();
  });

  beforeEach(() => {
    senden.mockReset().mockResolvedValue({ externalMessageId: "m1" });
    absender.mockReset().mockResolvedValue("konto-r");
  });

  it("legt den Link an und schickt ihn in der Sprache der Person an die Ziffern der Nummer", async () => {
    const r = await mod.crewLinkSenden("w1", "e1", "u1", deps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.an).toBe("+491512345678");
    expect(senden).toHaveBeenCalledTimes(1);
    const arg = senden.mock.calls[0][0];
    expect(arg.accountId).toBe("konto-r");
    expect(arg.peerWaId).toBe("491512345678");
    expect(arg.text).toContain("Merhaba Mehmet");
    expect(arg.text).toContain(r.link.url);
    // Zweites Senden: derselbe Link, kein neuer Token.
    const r2 = await mod.crewLinkSenden("w1", "e1", "u1", deps());
    expect(r2.ok && r2.link.url).toBe(r.link.url);
  });

  it("ohne Telefon, inaktiv, fremder Workspace: nichts gesendet, kein Link angelegt", async () => {
    expect(await mod.crewLinkSenden("w1", "e2", "u1", deps())).toEqual({ ok: false, code: "KEIN_TELEFON" });
    expect(await mod.crewLinkSenden("w1", "e3", "u1", deps())).toEqual({ ok: false, code: "INAKTIV" });
    expect(await mod.crewLinkSenden("w2", "e1", "u1", deps())).toEqual({ ok: false, code: "NICHT_GEFUNDEN" });
    expect(senden).not.toHaveBeenCalled();
    expect((await links.crewLinkLesen("w1", "e2")).ok && (await links.crewLinkLesen("w1", "e2"))).toMatchObject({ link: null });
  });

  it("gesperrter Link wird nicht still wieder freigegeben", async () => {
    await links.crewLinkAnlegen("w1", "e4", "u1");
    await links.crewLinkSperren("w1", "e4");
    expect(await mod.crewLinkSenden("w1", "e4", "u1", deps())).toEqual({ ok: false, code: "GESPERRT" });
    const l = await links.crewLinkLesen("w1", "e4");
    expect(l.ok && l.link?.aktiv).toBe(false);
    expect(senden).not.toHaveBeenCalled();
  });

  it("gleichzeitig gesperrt: Senden gibt den Link nicht wieder frei und schickt nichts", async () => {
    await sql.unsafe(`INSERT INTO ${h.schema}.employees (id, workspace_id, name, phone_canonical) VALUES ('e5', 'w1', 'Eda Ekin', '+491700000005')`);
    await links.crewLinkAnlegen("w1", "e5", "u1");
    // Gesperrt wird genau zwischen der frühen Prüfung und dem Anlegen.
    absender.mockImplementationOnce(async () => {
      await links.crewLinkSperren("w1", "e5");
      return "konto-r";
    });
    expect(await mod.crewLinkSenden("w1", "e5", "u1", deps())).toEqual({ ok: false, code: "GESPERRT" });
    const l = await links.crewLinkLesen("w1", "e5");
    expect(l.ok && l.link?.aktiv).toBe(false);
    expect(senden).not.toHaveBeenCalled();
  });

  it("kein verbundenes Absenderkonto: KEIN_ABSENDER, kein Link angelegt", async () => {
    await sql.unsafe(`UPDATE ${h.schema}.employees SET phone_canonical = '+491700000002' WHERE id = 'e2'`);
    absender.mockResolvedValueOnce(null);
    expect(await mod.crewLinkSenden("w1", "e2", "u1", deps())).toEqual({ ok: false, code: "KEIN_ABSENDER" });
    const l = await links.crewLinkLesen("w1", "e2");
    expect(l.ok && l.link).toBeNull();
  });

  it("Versandfehler kommt als VERSAND mit Meldung zurück", async () => {
    senden.mockRejectedValueOnce(new Error("bridge returned 500"));
    expect(await mod.crewLinkSenden("w1", "e1", "u1", deps())).toEqual({ ok: false, code: "VERSAND", message: "bridge returned 500" });
  });
});
