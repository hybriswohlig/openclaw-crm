import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { crewTestSchemaAnlegen } from "./testdb";

/**
 * Crew-Link und Anmeldung gegen die Wegwerf-Postgres (EINSATZ_TEST_DATABASE_URL):
 * eigenes Schema aus `./testdb.ts` mit der echten Migration 0066. Jobs, Antwort
 * und Fotos stehen in `jobs.db.test.ts`.
 */
const url = process.env.EINSATZ_TEST_DATABASE_URL;
const h = vi.hoisted(() => ({ schema: `crew_${Date.now().toString(36)}` }));

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.EINSATZ_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", {
    max: 4,
    onnotice: () => {},
    connection: { search_path: h.schema },
  });
  return { db: drizzle(client, { schema }) };
});

describe.skipIf(!url)("Crew-Link und Anmeldung (DB)", { timeout: 20_000 }, () => {
  let sql: postgres.Sql;
  let auth: typeof import("./auth");
  let links: typeof import("./links");

  beforeAll(async () => {
    sql = postgres(url!, { max: 1, onnotice: () => {} });
    await crewTestSchemaAnlegen(sql, h.schema);
    await sql.unsafe(`
      INSERT INTO workspaces VALUES ('w1'), ('w2');
      INSERT INTO employees (id, workspace_id, name) VALUES ('e1', 'w1', 'Mehmet Ali Yilmaz'), ('e2', 'w1', 'Ben Bauer'), ('e3', 'w1', 'Cem Can'), ('x1', 'w2', 'Fremd');
      UPDATE employees SET active = false WHERE id = 'e3';
    `);
    auth = await import("./auth");
    links = await import("./links");
  });

  afterAll(async () => {
    await sql?.unsafe(`DROP SCHEMA ${h.schema} CASCADE`);
    await sql?.end();
  });

  describe("Link-Lebenslauf", () => {
    it("anlegen ist idempotent, fremder Workspace und Inaktive nicht", async () => {
      const a = await links.crewLinkAnlegen("w1", "e1", "u1");
      const b = await links.crewLinkAnlegen("w1", "e1", "u1");
      expect(a.ok && b.ok && a.link?.url === b.link?.url).toBe(true);
      expect(a.ok && a.link?.url).toMatch(/^http:\/\/localhost:3100\/l\/[A-Za-z0-9_-]{32}$/);
      expect(await links.crewLinkAnlegen("w2", "e1", "u1")).toEqual({ ok: false, code: "NICHT_GEFUNDEN" });
      expect(await links.crewLinkAnlegen("w1", "e3", "u1")).toEqual({ ok: false, code: "INAKTIV" });
    });

    it("erneuern tötet den alten Token, sperren und wieder anlegen gibt einen neuen", async () => {
      const [alt] = await sql`SELECT token FROM crew_links WHERE employee_id = 'e1'`;
      const neu = await links.crewLinkErneuern("w1", "e1");
      const [jetzt] = await sql`SELECT token FROM crew_links WHERE employee_id = 'e1'`;
      expect(neu.ok && neu.link?.aktiv).toBe(true);
      expect(jetzt!.token).not.toBe(alt!.token);
      expect(await auth.crewLinkAufloesen(alt!.token)).toBeNull();

      const gesperrt = await links.crewLinkSperren("w1", "e1");
      expect(gesperrt.ok && gesperrt.link?.aktiv).toBe(false);
      expect(await auth.crewLinkAufloesen(jetzt!.token)).toBeNull();
      const wieder = await links.crewLinkAnlegen("w1", "e1", "u1");
      const [danach] = await sql`SELECT token, revoked_at FROM crew_links WHERE employee_id = 'e1'`;
      expect(wieder.ok && wieder.link?.aktiv).toBe(true);
      expect(danach!.token).not.toBe(jetzt!.token);
      expect(danach!.revoked_at).toBeNull();
    });
  });

  describe("requireCrew", () => {
    const geheimnis = "g".repeat(40);
    const req = (h: Record<string, string>) => new Request("http://x/api/crew/v1/me", { headers: h });
    const ok = async () => ((await sql`SELECT token FROM crew_links WHERE employee_id = 'e1'`)[0]!.token as string);

    it("falsches oder fehlendes Geheimnis 401 ohne Hinweis auf den Token", async () => {
      const token = await ok();
      const koepfe: Array<Record<string, string>> = [{}, { "x-crew-secret": "falsch" }, { "x-crew-secret": `${geheimnis}x` }];
      for (const kopf of koepfe) {
        for (const t of [token, "nicht-da"]) {
          const r = await auth.requireCrew(req({ ...kopf, "x-crew-token": t }), { geheimnis });
          expect(r.ok).toBe(false);
          if (!r.ok) {
            expect(r.antwort.status).toBe(401);
            expect(await r.antwort.json()).toEqual({ error: "UNAUTHORIZED" });
          }
        }
      }
    });

    it("zu kurzes oder fehlendes Geheimnis in der Umgebung: alles 401 (fail closed)", async () => {
      const token = await ok();
      for (const g of ["kurz", ""]) {
        const r = await auth.requireCrew(req({ "x-crew-secret": g, "x-crew-token": token }), { geheimnis: g });
        expect(!r.ok && r.antwort.status).toBe(401);
      }
    });

    it("falsche Form, unbekannt, gesperrt, inaktiv → 404 LINK_UNGUELTIG", async () => {
      const pruefe = async (t: string) => {
        const r = await auth.requireCrew(req({ "x-crew-secret": geheimnis, "x-crew-token": t }), { geheimnis });
        expect(r.ok).toBe(false);
        if (!r.ok) {
          expect(r.antwort.status).toBe(404);
          expect(await r.antwort.json()).toEqual({ error: "LINK_UNGUELTIG" });
        }
      };
      await pruefe("zu-kurz");
      await pruefe("A".repeat(32));
      // Gesperrt
      await sql`INSERT INTO crew_links (id, workspace_id, employee_id, token, revoked_at) VALUES ('l2', 'w1', 'e2', ${"B".repeat(32)}, now())`;
      await pruefe("B".repeat(32));
      // Inaktive Person mit gültigem Link
      await sql`INSERT INTO crew_links (id, workspace_id, employee_id, token) VALUES ('l3', 'w1', 'e3', ${"C".repeat(32)})`;
      await pruefe("C".repeat(32));
    });

    it("gültig: Kontext der Person; zuletzt gesehen höchstens einmal je Minute", async () => {
      const token = await ok();
      const t0 = new Date("2026-11-16T10:00:00Z");
      await sql`UPDATE crew_links SET last_seen_at = NULL, view_count = 0 WHERE employee_id = 'e1'`;
      const r = await auth.requireCrew(req({ "x-crew-secret": geheimnis, "x-crew-token": token }), { geheimnis, jetzt: t0 });
      expect(r.ok && r.k).toMatchObject({ workspaceId: "w1", employee: { id: "e1", name: "Mehmet Ali Yilmaz", locale: "de", rateWorkCents: 2000 } });
      await auth.requireCrew(req({ "x-crew-secret": geheimnis, "x-crew-token": token }), { geheimnis, jetzt: new Date(t0.getTime() + 30_000) });
      let [z] = await sql`SELECT last_seen_at, view_count FROM crew_links WHERE employee_id = 'e1'`;
      expect(z!.view_count).toBe(1);
      expect(new Date(z!.last_seen_at).toISOString()).toBe(t0.toISOString());
      await auth.requireCrew(req({ "x-crew-secret": geheimnis, "x-crew-token": token }), { geheimnis, jetzt: new Date(t0.getTime() + 61_000) });
      [z] = await sql`SELECT view_count FROM crew_links WHERE employee_id = 'e1'`;
      expect(z!.view_count).toBe(2);
    });
  });

});
