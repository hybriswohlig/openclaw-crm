import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanEintrag } from "@/lib/plan-heute";

/**
 * Auftrags-Tabelle gegen die Wegwerf-Postgres (EINSATZ_TEST_DATABASE_URL):
 * Export mit Team, Vorschau schreibt nichts, Übernehmen über „Team bestätigen“,
 * Wechsel einer Person zwischen zwei Umzügen am selben Tag. Plan aus Fixture.
 */
const url = process.env.EINSATZ_TEST_DATABASE_URL;

const h = vi.hoisted(() => ({ eintraege: [] as unknown[], client: null as null | { end: () => Promise<void> } }));

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.EINSATZ_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 6, onnotice: () => {} });
  h.client = client;
  return { db: drizzle(client, { schema }) };
});
vi.mock("./plan", async (orig) => ({
  ...(await orig<typeof import("./plan")>()),
  ladePlanEintraege: async (_ws: string, a: { von: string; bis: string }) => {
    const e = (h.eintraege as PlanEintrag[]).filter((x) => x.tag <= a.bis && x.bisTag >= a.von);
    return { eintraege: e, alle: e, roh: {} };
  },
}));
vi.mock("./einsatz-geo", () => ({ anfahrtenLaden: async () => [] }));

function eintrag(dealId: string, titel: string, tag: string, ton: PlanEintrag["ton"] = "jade"): PlanEintrag {
  return {
    id: `move:${dealId}`, dealId, art: "umzug", label: "Umzug", tag, bisTag: tag, von: "08:00", bis: null, zeitText: null,
    ton, fehlt: [], titel, zeile: "", betragText: null, strecke: null, team: [], teamFehlt: false, transporter: null,
    firma: null, stufe: { id: null, label: "", kategorie: "booked" }, datumQuelle: "feld", ziehbar: true, annahmeAm: null,
    href: `/app/leads/${dealId}`,
  };
}

const KOPF = "Auftrag-ID (nicht ändern);Datum;Uhrzeit;Firma;Kunde;Strecke;Teamleitung;Helfer (Namen mit Komma)";
const TAG = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
const TAG2 = new Date(Date.now() + 11 * 864e5).toISOString().slice(0, 10);

describe.skipIf(!url)("Auftrags-Tabelle (DB)", { timeout: 20_000 }, () => {
  let sql: postgres.Sql;
  let svc: typeof import("./auftraege-import");
  const ws = randomUUID();
  const obj = randomUUID();
  const [dealA, dealB, dealAlt, dealOffen] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const [x, y, z] = [randomUUID(), randomUUID(), randomUUID()];
  const team = async (deal: string) =>
    (await sql`select e.name, de.role, de.confirmed_by from deal_employees de join employees e on e.id = de.employee_id
      where de.deal_record_id = ${deal} order by de.role desc, e.name`) as postgres.RowList<postgres.Row[]>;

  beforeAll(async () => {
    sql = postgres(url!, { max: 1, onnotice: () => {} });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Test', ${`t-${ws}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${obj}, ${ws}, 'deals', 'Deal', 'Deals')`;
    for (const d of [dealA, dealB, dealAlt, dealOffen]) await sql`insert into records (id, object_id) values (${d}, ${obj})`;
    for (const [id, name] of [[x, "Xaver Kaya"], [y, "Yusuf"], [z, "Zoe"]] as const) {
      await sql`insert into employees (id, workspace_id, name, hourly_rate, rate_work_cents) values (${id}, ${ws}, ${name}, 20.00, 2000)`;
    }
    h.eintraege = [
      eintrag(dealA, "Anna", TAG),
      eintrag(dealB, "Bruno", TAG),
      eintrag(dealAlt, "Vorbei", "2020-01-05"),
      eintrag(dealOffen, "Offen", TAG2, "gestrichelt"),
    ];
    svc = await import("./auftraege-import");
  });

  beforeEach(async () => {
    await sql`delete from employee_time_entries where workspace_id = ${ws}`;
    await sql`delete from deal_employees where deal_record_id in (${dealA}, ${dealB}, ${dealAlt}, ${dealOffen})`;
    await sql`insert into deal_employees (id, deal_record_id, employee_id, role, created_at) values (gen_random_uuid()::text, ${dealA}, ${x}, 'lead', now() - interval '1 minute'), (gen_random_uuid()::text, ${dealA}, ${y}, 'helper', now())`;
  });

  afterAll(async () => {
    await sql`delete from workspaces where id = ${ws}`;
    await sql.end();
    await h.client?.end();
  });

  it("nur anstehende feste Umzüge, mit Team und Rollen", async () => {
    const a = await svc.anstehendeAuftraege(ws);
    expect(a.map((x) => x.titel).sort()).toEqual(["Anna", "Bruno"]);
    expect(a.find((x) => x.dealId === dealA)!.team).toEqual([
      { employeeId: x, role: "lead" },
      { employeeId: y, role: "helper" },
    ]);
  });

  it("Vorschau schreibt nichts; Übernehmen: Yusuf wechselt von Anna zu Bruno, Zoe kommt zu Anna, ohne WhatsApp", async () => {
    const csv = [KOPF, `${dealA};;;;;;Xaver;Zoe`, `${dealB};;;;;;Yusuf;`].join("\r\n");
    const v = await svc.auftraegeImport(ws, csv, false, "u1");
    expect(v.zeilen.map((z) => z.art)).toEqual(["aendern", "aendern"]);
    expect(await team(dealB)).toHaveLength(0);

    const r = await svc.auftraegeImport(ws, csv, true, "u1");
    expect(r.zeilen.map((z) => [z.art, z.fehler])).toEqual([
      ["aendern", []],
      ["aendern", []],
    ]);
    expect(r.uebernommen).toBe(2);
    expect((await team(dealA)).map((t) => [t.name, t.role, t.confirmed_by])).toEqual([
      ["Xaver Kaya", "lead", "u1"],
      ["Zoe", "helper", "u1"],
    ]);
    expect((await team(dealB)).map((t) => [t.name, t.role])).toEqual([["Yusuf", "lead"]]);
  });

  it("doppelt am Tag ist ein Hinweis: Xaver bleibt auf Anna und kommt zusätzlich auf Bruno", async () => {
    const csv = [KOPF, `${dealB};;;;;;Zoe;Xaver`].join("\r\n");
    const r = await svc.auftraegeImport(ws, csv, true, "u1");
    expect(r.zeilen[0]).toMatchObject({ art: "aendern", fehler: [] });
    expect(r.zeilen[0]!.hinweise[0]).toContain("Xaver Kaya ist am selben Tag auch bei Anna");
    expect((await team(dealB)).map((t) => [t.name, t.role])).toEqual([
      ["Zoe", "lead"],
      ["Xaver Kaya", "helper"],
    ]);
    expect((await team(dealA)).map((t) => t.name)).toEqual(["Xaver Kaya", "Yusuf"]);
  });

  it("Review: scheitert der alte Auftrag (Stempel), bleibt er ganz unverändert, nichts halb gespeichert", async () => {
    // Anna soll nur noch Zoe haben (Xaver stempelt gerade, darf nicht raus), Yusuf wechselt zu Bruno.
    await sql`insert into employee_time_entries (id, workspace_id, deal_record_id, employee_id, date, start_at) values (${randomUUID()}, ${ws}, ${dealA}, ${x}, ${TAG}, now())`;
    const csv = [KOPF, `${dealA};;;;;;Zoe;`, `${dealB};;;;;;Yusuf;`].join("\r\n");
    const r = await svc.auftraegeImport(ws, csv, true, "u1");
    expect(r.zeilen.map((z) => z.art)).toEqual(["fehler", "aendern"]);
    expect(r.zeilen[0]!.fehler[0]).toContain("eingestempelt");
    expect((await team(dealA)).map((t) => t.name)).toEqual(["Xaver Kaya", "Yusuf"]);
    expect((await team(dealB)).map((t) => t.name)).toEqual(["Yusuf"]);
  });

  it("„-“ leert das Team; Wiederholen ändert nichts mehr", async () => {
    const csv = [KOPF, `${dealA};;;;;;-;`].join("\r\n");
    expect((await svc.auftraegeImport(ws, csv, true, "u1")).uebernommen).toBe(1);
    expect(await team(dealA)).toHaveLength(0);
    const zwei = await svc.auftraegeImport(ws, csv, true, "u1");
    expect(zwei.zeilen[0]!.art).toBe("gleich");
    expect(zwei.uebernommen).toBe(0);
  });
});
