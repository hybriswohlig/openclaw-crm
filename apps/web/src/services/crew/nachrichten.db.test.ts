import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { neueJobsNachricht, zusageNachricht } from "@/lib/crew/crew-nachrichten";
import { crewTestSchemaAnlegen, wertSetzen } from "./testdb";

/** WhatsApp an die Crew (Zusage, neue Jobs) gegen die Wegwerf-Postgres; Versand ist eine Attrappe. */
const url = process.env.EINSATZ_TEST_DATABASE_URL;
const h = vi.hoisted(() => ({ schema: `crew_nachr_${Date.now().toString(36)}` }));

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
vi.mock("@/services/inbox-whatsapp", () => ({
  sendBaileysDirektText: () => {
    throw new Error("echter Versand im Test");
  },
}));

describe("Texte", () => {
  it("Zusage und neue Jobs: Vorname, Tag, Art, Ort, Link; nie Firmennamen", () => {
    const z = zusageNachricht("de", "Mehmet Ali", { date: "2026-11-19", type: "move", town: "Nagold", fix: true }, "https://x/l/T");
    expect(z).toBe("Hallo Mehmet! Du bist dabei: Do., 19.11. · Umzug · Nagold. Adresse und alle Infos findest du hier:\nhttps://x/l/T");
    const jobs = Array.from({ length: 7 }, (_, i) => ({ date: `2026-11-2${i}`, type: "clearance" as const, town: "Calw", fix: i !== 1 }));
    const n = neueJobsNachricht("de", "Ben Bauer", jobs, "https://x/l/T");
    expect(n.split("\n")[0]).toBe("Hallo Ben! 7 neue Jobs für dich:");
    expect(n).toContain("• Sa., 21.11. · Entrümpelung · Calw (noch nicht fix)");
    expect(n).toContain("• und 2 weitere");
    expect(n.endsWith("Sag einfach Ja oder Nein:\nhttps://x/l/T")).toBe(true);
    expect(neueJobsNachricht("tr", "Ali", jobs.slice(0, 1), "u")).toContain("yeni bir iş");
    for (const l of ["de", "en", "tr", "ar", "pl", "uk", "ru"] as const) {
      expect(neueJobsNachricht(l, "A", jobs, "u") + zusageNachricht(l, "A", jobs[0]!, "u")).not.toMatch(/Kottke|Rümpeltürken|Ceylan|Büro/i);
    }
  });
});

describe.skipIf(!url)("WhatsApp an die Crew (DB)", { timeout: 30_000 }, () => {
  let sql: postgres.Sql;
  let n: typeof import("./nachrichten");
  const senden = vi.fn();
  const absender = vi.fn();
  const pause = vi.fn(async () => {});
  const deps = () => ({ senden, absender, pause });
  const A: Record<string, string> = {};

  async function deal(id: string, datum: string, o: { stufe?: string; wc?: number } = {}) {
    await sql`INSERT INTO records (id, object_id) VALUES (${id}, 'od')`;
    await wertSetzen(sql, id, A["od.stage"]!, { text: o.stufe ?? "st_booked" });
    await wertSetzen(sql, id, A["od.move_date"]!, { datum });
    await wertSetzen(sql, id, A["od.move_from_address"]!, { json: { line1: "Hauptstraße 5", postcode: "72202", city: "Nagold" } });
    const au = `au_${id}`;
    await sql`INSERT INTO records (id, object_id) VALUES (${au}, 'oa')`;
    await wertSetzen(sql, au, A["oa.deal"]!, { ref: id });
    await wertSetzen(sql, au, A["oa.operating_company"]!, { ref: "k1" });
    await wertSetzen(sql, au, A["oa.worker_count"]!, { zahl: o.wc ?? 3 });
  }

  beforeAll(async () => {
    sql = postgres(url!, { max: 1, onnotice: () => {} });
    await crewTestSchemaAnlegen(sql, h.schema);
    await sql.unsafe(`
      INSERT INTO workspaces VALUES ('w1');
      INSERT INTO objects VALUES ('od', 'w1', 'deals'), ('oa', 'w1', 'auftraege'), ('oc', 'w1', 'operating_companies');
      INSERT INTO employees (id, workspace_id, name) VALUES ('e1', 'w1', 'Ali Kaya'), ('e2', 'w1', 'Ben Bauer'), ('e3', 'w1', 'Cem Can'), ('e4', 'w1', 'Dana Dorn');
      UPDATE employees SET phone_canonical = '+491511111111', locale = 'tr' WHERE id = 'e1';
      UPDATE employees SET phone_canonical = '+491522222222' WHERE id = 'e2';
      UPDATE employees SET phone_canonical = '+491533333333', active = false WHERE id = 'e3';
      INSERT INTO crew_links (id, workspace_id, employee_id, token) VALUES
        ('l1', 'w1', 'e1', '${"A".repeat(32)}'), ('l2', 'w1', 'e2', '${"B".repeat(32)}'), ('l3', 'w1', 'e3', '${"C".repeat(32)}'), ('l4', 'w1', 'e4', '${"D".repeat(32)}');
    `);
    for (const [obj, liste] of [
      ["od", ["stage", "move_date", "move_from_address", "move_to_address", "floors_from", "floors_to", "elevator_from", "elevator_to", "moving_lead_payload", "operating_company"]],
      ["oa", ["deal", "operating_company", "worker_count", "crew_ausschreiben", "time_window_start", "time_window_end", "transporter", "load_unload_minutes", "drive_minutes_total"]],
      ["oc", ["name"]],
    ] as const) {
      for (const s of liste) {
        await sql`INSERT INTO attributes VALUES (${`${obj}_${s}`}, ${obj}, ${s})`;
        A[`${obj}.${s}`] = `${obj}_${s}`;
      }
    }
    await sql`INSERT INTO statuses VALUES ('st_booked', ${A["od.stage"]!}, 'booked'), ('st_quoted', ${A["od.stage"]!}, 'quoted')`;
    await sql`INSERT INTO records (id, object_id) VALUES ('k1', 'oc')`;
    await wertSetzen(sql, "k1", A["oc.name"]!, { text: "Kottke-Umzüge" });
    await deal("dA", "2099-01-10");
    await deal("dB", "2099-01-11", { stufe: "st_quoted" });
    n = await import("./nachrichten");
  }, 60_000);

  afterAll(async () => {
    await sql?.unsafe(`DROP SCHEMA ${h.schema} CASCADE`);
    await sql?.end();
  });

  beforeEach(() => {
    senden.mockReset().mockResolvedValue({ externalMessageId: "m" });
    absender.mockReset().mockResolvedValue("konto-r");
    pause.mockClear();
  });

  it("neue Jobs: je Person eine Nachricht in ihrer Sprache, mit Pause; inaktiv und ohne Nummer nie", async () => {
    const r = await n.neueJobsRundschreiben({ deps: deps() });
    expect(r).toMatchObject({ workspaces: 1, gesendet: 2, fehler: 0 });
    expect(senden).toHaveBeenCalledTimes(2);
    const an = Object.fromEntries(senden.mock.calls.map((c) => [c[0].peerWaId, c[0].text as string]));
    expect(Object.keys(an).sort()).toEqual(["491511111111", "491522222222"]);
    expect(an["491511111111"]).toContain("Merhaba Ali! Senin için 2 yeni iş var:");
    expect(an["491522222222"]).toContain("Hallo Ben! 2 neue Jobs für dich:");
    expect(an["491522222222"]).toContain("(noch nicht fix)");
    expect(an["491522222222"]).toMatch(/\/l\/B{32}/);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it("am selben Tag nie zweimal; am nächsten Tag nur wirklich neue Jobs", async () => {
    expect(await n.neueJobsRundschreiben({ deps: deps() })).toMatchObject({ gesendet: 0 });
    expect(senden).not.toHaveBeenCalled();
    // Ein Tag später: alte Jobs schon angekündigt, nichts Neues.
    await sql`UPDATE crew_notifications SET created_at = created_at - interval '1 day'`;
    await sql`DELETE FROM workspace_settings WHERE key = 'crew_neue_jobs_lauf'`;
    expect(await n.neueJobsRundschreiben({ deps: deps() })).toMatchObject({ gesendet: 0, ohneNeues: 2 });
    // Neuer Job am nächsten Tag: nur der kommt.
    await sql`DELETE FROM workspace_settings WHERE key = 'crew_neue_jobs_lauf'`;
    await deal("dC", "2099-01-12");
    const r = await n.neueJobsRundschreiben({ deps: deps() });
    expect(r.gesendet).toBe(2);
    for (const c of senden.mock.calls) {
      expect(c[0].text).toMatch(/(1 yeni iş|yeni bir iş|Ein neuer Job)/);
      expect(c[0].text).toMatch(/12[./]01/);
    }
  });

  it("beantwortete Jobs werden nicht angekündigt; abgeschaltet oder ohne Absender: nichts", async () => {
    await sql`UPDATE crew_notifications SET created_at = created_at - interval '1 day'`;
    await sql`DELETE FROM workspace_settings WHERE key = 'crew_neue_jobs_lauf'`;
    await deal("dD", "2099-01-13");
    await sql`INSERT INTO crew_job_responses (id, workspace_id, deal_record_id, employee_id, answer) VALUES ('r1', 'w1', 'dD', 'e2', 'nein')`;
    absender.mockResolvedValue(null);
    expect(await n.neueJobsRundschreiben({ deps: deps() })).toMatchObject({ gesendet: 0, uebersprungen: 1 });
    absender.mockResolvedValue("konto-r");
    await sql`DELETE FROM workspace_settings WHERE key = 'crew_neue_jobs_lauf'`;
    await sql`INSERT INTO workspace_settings (workspace_id, key, value_plain) VALUES ('w1', 'crew_neue_jobs', 'aus')`;
    expect(await n.neueJobsRundschreiben({ deps: deps() })).toMatchObject({ workspaces: 0, gesendet: 0 });
    await sql`DELETE FROM workspace_settings WHERE key = 'crew_neue_jobs'`;
    const r = await n.neueJobsRundschreiben({ deps: deps() });
    expect(r.gesendet).toBe(1);
    expect(senden.mock.calls[0]![0].peerWaId).toBe("491511111111");
  });

  it("doppelt ausgelöst: gleichzeitige Läufe senden zusammen nur einmal; Zeitgrenze bricht sauber ab", async () => {
    await sql`DELETE FROM workspace_settings WHERE key = 'crew_neue_jobs_lauf'`;
    await sql`UPDATE crew_notifications SET created_at = created_at - interval '1 day'`;
    await deal("dE", "2099-01-14");
    const [a, b] = await Promise.all([n.neueJobsRundschreiben({ deps: deps() }), n.neueJobsRundschreiben({ deps: deps() })]);
    expect(a.gesendet + b.gesendet).toBe(2);
    expect(senden).toHaveBeenCalledTimes(2);
    // Zeitgrenze: nichts gesendet, nichts als angekündigt markiert.
    senden.mockClear();
    await sql`DELETE FROM workspace_settings WHERE key = 'crew_neue_jobs_lauf'`;
    await sql`UPDATE crew_notifications SET created_at = created_at - interval '1 day'`;
    await deal("dF", "2099-01-15");
    let t = 0;
    const r = await n.neueJobsRundschreiben({ deps: deps(), budgetMs: 10, uhr: () => (t += 100) });
    expect(r).toMatchObject({ abgebrochen: true, gesendet: 0 });
    expect(senden).not.toHaveBeenCalled();
    const ang = await sql`SELECT count(*)::int AS n FROM crew_job_announcements WHERE deal_record_id = 'dF'`;
    expect(ang[0]!.n).toBe(0);
  });

  it("Zusage: nur an die übergebenen Neuen, mit Tag, Art und Ort; Gründe vermerkt; Fehler stoppt nicht", async () => {
    await sql`INSERT INTO deal_employees (deal_record_id, employee_id, role) VALUES ('dA', 'e1', 'lead'), ('dA', 'e2', 'helper'), ('dA', 'e4', 'helper')`;
    senden.mockRejectedValueOnce(new Error("nicht verbunden")).mockResolvedValue({ externalMessageId: "m" });
    const r = await n.zusageSenden("w1", "dA", ["e1", "e2", "e4"], "u1", deps());
    expect(r).toEqual({ gesendet: 1, gesamt: 3 });
    expect(senden).toHaveBeenCalledTimes(2);
    expect(senden.mock.calls[1]![0].text).toBe(`Hallo Ben! Du bist dabei: Sa., 10.01. · Umzug · Nagold. Adresse und alle Infos findest du hier:\nhttp://localhost:3100/l/${"B".repeat(32)}`);
    const v = await sql`SELECT employee_id, status FROM crew_notifications WHERE kind = 'zusage' ORDER BY employee_id`;
    expect(v.map((z) => [z.employee_id, z.status])).toEqual([["e1", "fehler"], ["e2", "gesendet"], ["e4", "kein_telefon"]]);
    expect(await n.teamIdsLesen("dA")).toHaveLength(3);
    expect(await n.zusageSenden("w1", "dA", [], "u1", deps())).toEqual({ gesendet: 0, gesamt: 0 });
  });
});
