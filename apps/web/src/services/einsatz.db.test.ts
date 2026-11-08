import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanEintrag } from "@/lib/plan-heute";

/**
 * „Team bestätigen“ gegen die Wegwerf-Postgres (EINSATZ_TEST_DATABASE_URL):
 * Rennen zweier Bestätigungen, Sperren, Stempelung, Unique. Die Plan-Einträge
 * kommen aus einem Fixture (zwei feste Umzüge am selben Tag), alles andere echt.
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
  // Wie der echte Kalender: nur Einträge, die das Fenster schneiden.
  ladePlanEintraege: async (_ws: string, a: { von: string; bis: string }) => {
    const e = (h.eintraege as PlanEintrag[]).filter((x) => x.tag <= a.bis && x.bisTag >= a.von);
    return { eintraege: e, alle: e, roh: {} };
  },
}));
vi.mock("./einsatz-geo", () => ({ anfahrtenLaden: async () => [] }));

function eintrag(dealId: string, titel: string, tag: string, ton: PlanEintrag["ton"] = "jade"): PlanEintrag {
  return {
    id: `move:${dealId}`, dealId, art: "umzug", label: "Umzug", tag, bisTag: tag, von: null, bis: null, zeitText: null,
    ton, fehlt: [], titel, zeile: "", betragText: null, strecke: null, team: [], teamFehlt: false, transporter: null,
    firma: null, stufe: { id: null, label: "", kategorie: "booked" }, datumQuelle: "feld", ziehbar: true, annahmeAm: null,
    href: `/app/leads/${dealId}`,
  };
}

describe.skipIf(!url)("Team bestätigen (DB)", { timeout: 20_000 }, () => {
  let sql: postgres.Sql;
  let svc: typeof import("./einsatz");
  const ws = randomUUID();
  const obj = randomUUID();
  const [dealA, dealB, dealC] = [randomUUID(), randomUUID(), randomUUID()];
  const [x, y, z, inaktiv] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const wunsch = (employeeId: string, role: "lead" | "helper" = "helper") => ({ employeeId, role, plannedDriveMinutes: 60, plannedWorkMinutes: 300 });
  const zeilen = async (deal?: string) =>
    (deal
      ? await sql`select employee_id, role, planned_work_minutes, confirmed_by from deal_employees where deal_record_id = ${deal} order by employee_id`
      : await sql`select count(*)::int as n from deal_employees where deal_record_id in (${dealA}, ${dealB}, ${dealC})`) as postgres.RowList<postgres.Row[]>;

  beforeAll(async () => {
    sql = postgres(url!, { max: 1, onnotice: () => {} });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Test', ${`t-${ws}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${obj}, ${ws}, 'deals', 'Deal', 'Deals')`;
    for (const d of [dealA, dealB, dealC]) await sql`insert into records (id, object_id) values (${d}, ${obj})`;
    for (const [id, name] of [[x, "Xaver"], [y, "Yusuf"], [z, "Zoe"]] as const) {
      await sql`insert into employees (id, workspace_id, name, hourly_rate, rate_work_cents) values (${id}, ${ws}, ${name}, 20.00, 2000)`;
    }
    await sql`insert into employees (id, workspace_id, name, hourly_rate, rate_work_cents, active) values (${inaktiv}, ${ws}, 'Ina', 20.00, 2000, false)`;
    h.eintraege = [eintrag(dealA, "Anna", "2026-12-01"), eintrag(dealB, "Bruno", "2026-12-01"), eintrag(dealC, "Cora", "2026-12-01", "gestrichelt")];
    svc = await import("./einsatz");
  });

  beforeEach(async () => {
    await sql`delete from employee_time_entries where workspace_id = ${ws}`;
    await sql`delete from deal_employees where deal_record_id in (${dealA}, ${dealB}, ${dealC})`;
  });

  afterAll(async () => {
    await sql`delete from workspaces where id = ${ws}`;
    await sql.end();
    await h.client?.end();
  });

  it("legt an, ändert Rolle und Minuten, entfernt; leeres Team entfernt alle", async () => {
    const r1 = await svc.einsatzBestaetigen(ws, dealA, { team: [wunsch(x, "lead"), wunsch(y)] }, "u1");
    expect(r1.ok).toBe(true);
    expect((await zeilen(dealA)).map((r) => [r.employee_id, r.role, r.confirmed_by])).toEqual(
      [[x, "lead", "u1"], [y, "helper", "u1"]].sort((a, b) => a[0]!.localeCompare(b[0]!)),
    );
    const r2 = await svc.einsatzBestaetigen(ws, dealA, { team: [wunsch(x), { ...wunsch(y, "lead"), plannedWorkMinutes: 240 }] }, "u2");
    expect(r2.ok).toBe(true);
    const nachher = await zeilen(dealA);
    expect(nachher.find((r) => r.employee_id === y)).toMatchObject({ role: "lead", planned_work_minutes: 240 });
    expect(nachher.find((r) => r.employee_id === x)).toMatchObject({ role: "helper" });
    expect(await svc.einsatzBestaetigen(ws, dealA, { team: [] }, "u2")).toEqual({ ok: true, team: [] });
    expect(await zeilen(dealA)).toHaveLength(0);
  });

  it("Rennen: dieselbe Person für zwei feste Umzüge am selben Tag, genau eine bekommt DOPPELT_AM_TAG", async () => {
    for (let lauf = 0; lauf < 3; lauf++) {
      await sql`delete from deal_employees where deal_record_id in (${dealA}, ${dealB})`;
      const [a, b] = await Promise.all([
        svc.einsatzBestaetigen(ws, dealA, { team: [wunsch(x)] }, "u1"),
        svc.einsatzBestaetigen(ws, dealB, { team: [wunsch(x)] }, "u2"),
      ]);
      const codes = [a, b].map((r) => (r.ok ? "ok" : r.code)).sort();
      expect(codes).toEqual(["DOPPELT_AM_TAG", "ok"]);
      const fehler = [a, b].find((r) => !r.ok);
      expect(fehler && !fehler.ok && fehler.konflikte?.[0]).toMatchObject({ employeeId: x, tag: "2026-12-01" });
      expect((await zeilen()).at(0)?.n).toBe(1);
    }
  });

  it("überlappende Teams in umgekehrter Reihenfolge: kein Deadlock, mit bestaetigtAmTag beide eingeteilt", async () => {
    const [a, b] = await Promise.all([
      svc.einsatzBestaetigen(ws, dealA, { team: [wunsch(x), wunsch(y)], bestaetigtAmTag: [x, y] }, "u1"),
      svc.einsatzBestaetigen(ws, dealB, { team: [wunsch(y), wunsch(x)], bestaetigtAmTag: [x, y] }, "u2"),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect((await zeilen()).at(0)?.n).toBe(4);
  });

  it("gestrichelter Umzug am selben Tag ist kein Konflikt", async () => {
    // Ein Wunschtermin belegt niemanden: erst C (gestrichelt), dann A (fest) am selben Tag.
    expect((await svc.einsatzBestaetigen(ws, dealC, { team: [wunsch(z)] }, "u1")).ok).toBe(true);
    expect((await svc.einsatzBestaetigen(ws, dealA, { team: [wunsch(z)] }, "u1")).ok).toBe(true);
  });

  it("Entfernen bei offener Stempelung 409 STEMPELT_NOCH", async () => {
    await svc.einsatzBestaetigen(ws, dealA, { team: [wunsch(x), wunsch(y)] }, "u1");
    await sql`insert into employee_time_entries (id, workspace_id, deal_record_id, employee_id, date, start_at) values (${randomUUID()}, ${ws}, ${dealA}, ${y}, '2026-12-01', now())`;
    expect(await svc.einsatzBestaetigen(ws, dealA, { team: [wunsch(x)] }, "u1")).toEqual({ ok: false, code: "STEMPELT_NOCH" });
    expect(await zeilen(dealA)).toHaveLength(2);
  });

  it("inaktive Person lässt sich nicht neu einteilen, bestehende Zuteilung bleibt änderbar", async () => {
    expect(await svc.einsatzBestaetigen(ws, dealA, { team: [wunsch(inaktiv)] }, "u1")).toEqual({ ok: false, code: "INAKTIV" });
    await sql`insert into deal_employees (id, deal_record_id, employee_id, role) values (${randomUUID()}, ${dealA}, ${inaktiv}, 'helper')`;
    expect((await svc.einsatzBestaetigen(ws, dealA, { team: [wunsch(inaktiv, "lead")] }, "u1")).ok).toBe(true);
  });

  it("Unique-Verletzung (paralleler alter Schreiber) wird zu 409 DOPPELTE_PERSON", async () => {
    const { db } = await import("@/db");
    const fehler = Object.assign(new Error("duplicate key"), { cause: { code: "23505" } });
    const spy = vi.spyOn(db, "transaction").mockRejectedValueOnce(fehler);
    expect(await svc.einsatzBestaetigen(ws, dealA, { team: [wunsch(x)] }, "u1")).toEqual({ ok: false, code: "DOPPELTE_PERSON" });
    spy.mockRestore();
  });

  it("Review I1: Version sagt 01.12., der Plan steht am 08.01.: Schutz greift trotzdem", async () => {
    const [d1, d2] = [randomUUID(), randomUUID()];
    for (const d of [d1, d2]) await sql`insert into records (id, object_id) values (${d}, ${obj})`;
    await sql`insert into deal_calculation_versions (id, workspace_id, deal_record_id, version, status, reference_date, rechner_request)
      values (${randomUUID()}, ${ws}, ${d1}, 1, 'gesperrt', '2026-11-08', ${sql.json({ umzugsdatum: "2026-12-01" })})`;
    await sql`insert into deal_employees (id, deal_record_id, employee_id, role) values (${randomUUID()}, ${d2}, ${y}, 'helper')`;
    const vorher = h.eintraege;
    h.eintraege = [...vorher, eintrag(d1, "Neu", "2027-01-08"), eintrag(d2, "Alt", "2027-01-08")];
    try {
      const jetzt = new Date("2026-11-10T10:00:00Z");
      const ansicht = await svc.ladeEinsatz(ws, d1, { jetzt });
      expect(ansicht.tage).toEqual(["2027-01-08"]);
      expect(ansicht.personen.find((p) => p.id === y)?.lage).toBe("belegt");
      const r = await svc.einsatzBestaetigen(ws, d1, { team: [wunsch(y)] }, "u1", { jetzt });
      expect(r).toMatchObject({ ok: false, code: "DOPPELT_AM_TAG" });
    } finally {
      h.eintraege = vorher;
      await sql`delete from deal_employees where deal_record_id in (${d1}, ${d2})`;
    }
  });

  it("GET schreibt nichts", async () => {
    await svc.einsatzBestaetigen(ws, dealA, { team: [wunsch(x)] }, "u1");
    const vorher = (await zeilen()).at(0)?.n;
    const ansicht = await svc.ladeEinsatz(ws, dealA);
    expect(ansicht.tage).toEqual(["2026-12-01"]);
    expect(ansicht.team.map((t) => t.employeeId)).toEqual([x]);
    expect(ansicht.personen.find((p) => p.id === inaktiv)).toBeUndefined();
    const b = await svc.ladeEinsatz(ws, dealB);
    expect(b.personen.find((p) => p.id === x)?.lage).toBe("belegt");
    expect(b.teamVorschlag.team.some((t) => t.employeeId === x)).toBe(false);
    expect((await zeilen()).at(0)?.n).toBe(vorher);
  });
});
