import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Stammdaten, Sätze und Ausnahmen gegen eine Wegwerf-Datenbank.
 * Nur mit EINSATZ_TEST_DATABASE_URL (nie die Anwendungsdatenbank).
 */
const url = process.env.EINSATZ_TEST_DATABASE_URL;

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.EINSATZ_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 4 });
  return { db: drizzle(client, { schema }), __client: client };
});

import {
  abwesenheitAnlegen,
  abwesenheitLoeschen,
  ladeAbwesenheiten,
  ladeAbwesenheitenPerson,
  personAendern,
  personAnlegen,
} from "./einsatz-personen";
import { assignEmployeeToDeal, createEmployee, deleteEmployee, getEmployee, listEmployees, updateEmployee } from "./employees";

afterAll(async () => {
  const mod = (await import("@/db")) as { __client?: { end: (opts?: { timeout?: number }) => Promise<void> } };
  await mod.__client?.end({ timeout: 5 });
});

describe.skipIf(!url)("Einsatz-Personen auf Postgres", () => {
  let sql: postgres.Sql;
  const ws = randomUUID();

  beforeAll(async () => {
    sql = postgres(url!, { max: 1 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Einsatz-Test', ${`t-${ws}`})`;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from workspaces where id = ${ws}`;
    await sql.end({ timeout: 5 });
  });

  it("personAnlegen setzt Vorgaben 1500/2000 und hourly_rate 20.00", async () => {
    const person = await personAnlegen(ws, { name: " Ada Lovelace " });
    expect(person.satzFahrtCent).toBe(1500);
    expect(person.satzArbeitCent).toBe(2000);
    expect(person.aktiv).toBe(true);
    expect(person.kannSprinter).toBe(false);
    expect(person.eigenerPkw).toBe(false);
    expect(person.name).toBe("Ada Lovelace");
    const [row] = await sql`select hourly_rate::text as h, rate_drive_cents, rate_work_cents from employees where id = ${person.id}`;
    expect(row!.h).toBe("20.00");
    expect(row!.rate_drive_cents).toBe(1500);
    expect(row!.rate_work_cents).toBe(2000);
  });

  it("personAendern satzArbeitCent 2250 schreibt hourly_rate 22.50", async () => {
    const person = await personAnlegen(ws, { name: "Ben" });
    const geaendert = await personAendern(ws, person.id, { satzArbeitCent: 2250 });
    expect(geaendert?.satzArbeitCent).toBe(2250);
    const [row] = await sql`select hourly_rate::text as h, rate_work_cents from employees where id = ${person.id}`;
    expect(row!.h).toBe("22.50");
    expect(row!.rate_work_cents).toBe(2250);
  });

  it("updateEmployee „18,5“ und createEmployee „25“ halten den CHECK", async () => {
    const alt = await personAnlegen(ws, { name: "Cem" });
    await updateEmployee(ws, alt.id, { hourlyRate: "18,5" });
    const [nach] = await sql`select hourly_rate::text as h, rate_work_cents from employees where id = ${alt.id}`;
    expect(nach!.rate_work_cents).toBe(1850);
    expect(nach!.h).toBe("18.50");

    const neu = await createEmployee(ws, { name: "Dora", hourlyRate: "25" });
    const [row] = await sql`select hourly_rate::text as h, rate_work_cents, rate_drive_cents from employees where id = ${neu.id}`;
    expect(row!.rate_work_cents).toBe(2500);
    expect(row!.h).toBe("25.00");
    expect(row!.rate_drive_cents).toBe(1500);
    expect(neu.hourlyRate).toBe("25.00");
  });

  it("deleteEmployee deaktiviert, die Zeile bleibt", async () => {
    const person = await createEmployee(ws, { name: "Eva", hourlyRate: "20" });
    const antwort = await deleteEmployee(ws, person.id);
    expect(antwort?.active).toBe(false);
    const [row] = await sql`select active, deactivated_at from employees where id = ${person.id}`;
    expect(row!.active).toBe(false);
    expect(row!.deactivated_at).toBeTruthy();
  });

  it("assignEmployeeToDeal zweimal ist dieselbe Zeile", async () => {
    const person = await personAnlegen(ws, { name: "Fritz" });
    const obj = randomUUID();
    const deal = randomUUID();
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${obj}, ${ws}, ${`deals-${obj}`}, 'Deal', 'Deals')`;
    await sql`insert into records (id, object_id) values (${deal}, ${obj})`;
    const erste = await assignEmployeeToDeal(deal, person.id, "helper");
    const zweite = await assignEmployeeToDeal(deal, person.id, "lead");
    expect(zweite.id).toBe(erste.id);
    expect((await sql`select count(*)::int as n from deal_employees where deal_record_id = ${deal}`)[0]!.n).toBe(1);
  });

  it("Liste, Lesen, Ändern und Deaktivieren enthalten keinen Wohnort", async () => {
    const person = await personAnlegen(ws, { name: "Greta", plz: "70173", wohnort: "Stuttgart" });
    await sql`update employees set home_plz = '70173', home_town = 'Stuttgart' where id = ${person.id}`;
    const ohne = (wert: unknown) => {
      const text = JSON.stringify(wert);
      expect(text).not.toContain("homePlz");
      expect(text).not.toContain("homeTown");
      expect(text).not.toContain("home_plz");
      expect(text).not.toContain("70173");
    };
    ohne(await listEmployees(ws));
    ohne(await getEmployee(ws, person.id));
    ohne(await updateEmployee(ws, person.id, { name: "Greta Held" }));
    ohne(await deleteEmployee(ws, person.id));
  });

  it("Abwesenheit anlegen, im Fenster finden, löschen", async () => {
    const person = await personAnlegen(ws, { name: "Hans" });
    const angelegt = await abwesenheitAnlegen(ws, person.id, { von: "2026-11-30", bis: "2026-12-02", art: "urlaub", notiz: "  Ski  " }, "usr_1");
    expect(angelegt.notiz).toBe("Ski");
    const imFenster = await ladeAbwesenheitenPerson(ws, person.id, "2026-12-01", "2026-12-31");
    expect(imFenster.map((a) => a.id)).toContain(angelegt.id);
    expect((await ladeAbwesenheiten(ws, "2026-12-01", "2026-12-31")).map((a) => a.id)).toContain(angelegt.id);
    expect(await ladeAbwesenheitenPerson(ws, person.id, "2026-12-03", "2026-12-31")).toEqual([]);
    expect(await abwesenheitLoeschen(randomUUID(), angelegt.id)).toBe(false);
    expect(await abwesenheitLoeschen(ws, angelegt.id)).toBe(true);
    expect(await abwesenheitLoeschen(ws, angelegt.id)).toBe(false);
    expect(await ladeAbwesenheitenPerson(ws, person.id, "2026-12-01", "2026-12-31")).toEqual([]);
    await expect(
      abwesenheitAnlegen(ws, randomUUID(), { von: "2026-12-01", bis: "2026-12-01", art: "krank" }, "usr_1"),
    ).rejects.toThrow(/Workspace/);
  });
});
