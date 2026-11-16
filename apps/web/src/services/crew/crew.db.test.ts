import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CrewJob } from "@/lib/crew/contract";

/**
 * Crew-Dienste gegen die Wegwerf-Postgres (EINSATZ_TEST_DATABASE_URL): eigenes
 * Schema mit dem Stand vor 0066 (nur die Spalten, die die Dienste lesen), dann
 * die echte Migration 0066. Jobs-Laden ist gemockt (eigene Tests für die
 * Regeln in lib/crew/logik.test.ts); hier zählen Token, Zähler, Link-Lebenslauf
 * und die Antwort-Transaktion.
 */
const url = process.env.EINSATZ_TEST_DATABASE_URL;
const h = vi.hoisted(() => ({
  schema: `crew_${Date.now().toString(36)}`,
  job: null as null | { job: CrewJob; workerCount: number | null },
}));

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
vi.mock("./jobs", () => ({
  CREW_FOTO_TYPEN: ["image/jpeg"],
  ladeCrewJobsIntern: async () => (h.job ? [{ ...h.job, sicht: { a: true, b: false } }] : []),
  ladeCrewJobs: async () => [],
}));

const TOKEN = "Tok_en-0123456789abcdefghijklmnop".slice(0, 32);

function jobFake(): CrewJob {
  return {
    id: "d1", company: "kottke", type: "move", date: "2026-11-20", dateEnd: null, start: null, end: null,
    town: "Stuttgart", district: "70176", need: 2, crew: [], openRequests: 0, tasks: [], sprinterNeeded: false,
    note: null, pay: null, photos: [], my: { status: "offen", answeredAt: null }, isLead: false, full: false,
    conflictSameDay: false, address: null,
  };
}

describe.skipIf(!url)("Crew-Dienste (DB)", { timeout: 20_000 }, () => {
  let sql: postgres.Sql;
  let auth: typeof import("./auth");
  let links: typeof import("./links");
  let antwort: typeof import("./antwort");

  beforeAll(async () => {
    sql = postgres(url!, { max: 1, onnotice: () => {} });
    await sql.unsafe(`CREATE SCHEMA ${h.schema}`);
    await sql.unsafe(`SET search_path TO ${h.schema}`);
    await sql.unsafe(`
      CREATE TABLE workspaces (id text PRIMARY KEY);
      CREATE TABLE records (id text PRIMARY KEY);
      CREATE TABLE employees (id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), name text NOT NULL,
        active boolean NOT NULL DEFAULT true, can_drive_sprinter boolean NOT NULL DEFAULT false,
        rate_work_cents integer NOT NULL DEFAULT 2000, rate_drive_cents integer NOT NULL DEFAULT 1500,
        updated_at timestamp NOT NULL DEFAULT now());
      CREATE TABLE deal_employees (id text PRIMARY KEY DEFAULT gen_random_uuid()::text, deal_record_id text NOT NULL REFERENCES records(id),
        employee_id text NOT NULL REFERENCES employees(id), role text NOT NULL DEFAULT 'helper', created_at timestamp NOT NULL DEFAULT now());
      CREATE TABLE inbox_message_attachments (id text PRIMARY KEY, deal_record_id text);
      CREATE TABLE deal_internal_photos (id text PRIMARY KEY, deal_record_id text NOT NULL);
      CREATE TABLE job_media (id text PRIMARY KEY, deal_record_id text);
      INSERT INTO workspaces VALUES ('w1'), ('w2');
      INSERT INTO records VALUES ('d1');
      INSERT INTO employees (id, workspace_id, name) VALUES ('e1', 'w1', 'Mehmet Ali Yilmaz'), ('e2', 'w1', 'Ben Bauer'), ('e3', 'w1', 'Cem Can'), ('x1', 'w2', 'Fremd');
      UPDATE employees SET active = false WHERE id = 'e3';
    `);
    const mig = readFileSync(new URL("../../db/migrations/0066_crew_portal.sql", import.meta.url), "utf8");
    for (const s of mig.split("--> statement-breakpoint").map((x) => x.trim()).filter(Boolean)) await sql.unsafe(s);
    auth = await import("./auth");
    links = await import("./links");
    antwort = await import("./antwort");
  });

  afterAll(async () => {
    await sql?.unsafe(`DROP SCHEMA ${h.schema} CASCADE`);
    await sql?.end();
  });

  beforeEach(() => {
    h.job = { job: jobFake(), workerCount: 2 };
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

  describe("Antwort-Transaktion", () => {
    const k = {
      workspaceId: "w1",
      linkId: "l1",
      employee: { id: "e1", name: "Mehmet", locale: "de" as const, canDriveSprinter: false, rateWorkCents: 2000, rateDriveCents: 1500 },
    };
    const gespeichert = async () => (await sql`SELECT answer, source FROM crew_job_responses WHERE deal_record_id = 'd1' AND employee_id = 'e1'`)[0] ?? null;

    it("unsichtbarer Job 404", async () => {
      h.job = null;
      expect(await antwort.antwortSetzen(k, "d1", "ja")).toEqual({ ok: false, code: "JOB_NICHT_SICHTBAR" });
    });

    it("ja → gespeichert als ja; null nimmt zurück", async () => {
      expect((await antwort.antwortSetzen(k, "d1", "ja")).ok).toBe(true);
      expect(await gespeichert()).toEqual({ answer: "ja", source: "portal" });
      await antwort.antwortSetzen(k, "d1", null);
      expect(await gespeichert()).toBeNull();
    });

    it("ja auf vollen Job wird warteliste; vielleicht und nein bleiben", async () => {
      await sql`INSERT INTO deal_employees (deal_record_id, employee_id) VALUES ('d1', 'e2'), ('d1', 'e3')`;
      await antwort.antwortSetzen(k, "d1", "ja");
      expect((await gespeichert())!.answer).toBe("warteliste");
      await antwort.antwortSetzen(k, "d1", "vielleicht");
      expect((await gespeichert())!.answer).toBe("vielleicht");
      await antwort.antwortSetzen(k, "d1", "nein");
      expect((await gespeichert())!.answer).toBe("nein");
      // Ohne worker_count nie voll.
      h.job = { job: jobFake(), workerCount: null };
      await antwort.antwortSetzen(k, "d1", "ja");
      expect((await gespeichert())!.answer).toBe("ja");
      await sql`DELETE FROM deal_employees WHERE deal_record_id = 'd1'`;
    });

    it("eingeteilt: 409 BEREITS_BESTAETIGT für jede Antwort, gespeicherte Antwort bleibt", async () => {
      await antwort.antwortSetzen(k, "d1", "ja");
      await sql`INSERT INTO deal_employees (deal_record_id, employee_id) VALUES ('d1', 'e1')`;
      for (const a of ["ja", "nein", null] as const) {
        expect(await antwort.antwortSetzen(k, "d1", a)).toEqual({ ok: false, code: "BEREITS_BESTAETIGT" });
      }
      expect((await gespeichert())!.answer).toBe("ja");
      await sql`DELETE FROM deal_employees WHERE deal_record_id = 'd1'`;
    });

    it("nie ein Eintrag in deal_employees", async () => {
      await antwort.antwortSetzen(k, "d1", "ja");
      expect((await sql`SELECT count(*)::int AS n FROM deal_employees WHERE employee_id = 'e1'`)[0]!.n).toBe(0);
    });

    it("gleichzeitige Antworten derselben Person: eine Zeile, keine Ausnahme", async () => {
      await antwort.antwortSetzen(k, "d1", null);
      await Promise.all([antwort.antwortSetzen(k, "d1", "ja"), antwort.antwortSetzen(k, "d1", "vielleicht"), antwort.antwortSetzen(k, "d1", "nein")]);
      expect((await sql`SELECT count(*)::int AS n FROM crew_job_responses WHERE employee_id = 'e1'`)[0]!.n).toBe(1);
    });
  });
});
