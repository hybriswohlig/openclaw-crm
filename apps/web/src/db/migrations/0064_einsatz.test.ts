import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sql = readFileSync(new URL("./0064_einsatz.sql", import.meta.url), "utf8");
const kompakt = sql.replace(/\s+/g, " ");
const schritte = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);

describe("Migration 0064 Einsatz (Text)", () => {
  it("nur additiv und idempotent", () => {
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/home_street/);
    for (const zeile of sql.split("\n")) {
      if (/^\s*ALTER TABLE .* ADD COLUMN/.test(zeile)) expect(zeile).toContain("ADD COLUMN IF NOT EXISTS");
      if (/^\s*CREATE (UNIQUE )?INDEX/.test(zeile)) expect(zeile).toMatch(/INDEX IF NOT EXISTS/);
      if (/^\s*CREATE TABLE/.test(zeile)) expect(zeile).toContain("CREATE TABLE IF NOT EXISTS");
    }
    for (const c of [
      "employees_home_plz_format",
      "employees_satz_abgeleitet",
      "employee_absences_art_check",
      "employee_absences_zeitraum_check",
      "einsatz_wege_km_check",
      "vehicle_bookings_miete_check",
      "vehicle_bookings_auftraege_check",
      "vehicle_bookings_status_check",
      "vehicle_bookings_zeitraum_check",
      "deal_calculation_versions_vehicle_booking_fk",
      "quotation_date_offers_vehicle_booking_fk",
    ]) {
      expect(kompakt).toMatch(new RegExp(`WHERE conname = '${c}' AND conrelid = '"[a-z_]+"'::regclass`));
    }
  });

  it("Cache-Tabellen ohne Personen- und Minutenspalte", () => {
    for (const t of ["einsatz_wege", "einsatz_orte"]) {
      const block = sql.slice(sql.indexOf(`CREATE TABLE IF NOT EXISTS "${t}"`)).split(");")[0]!;
      expect(block).not.toMatch(/employee/);
      expect(block).not.toMatch(/min/i);
    }
  });

  it("steht im Journal als idx 64", () => {
    const journal = JSON.parse(readFileSync(new URL("./meta/_journal.json", import.meta.url), "utf8"));
    expect(journal.entries.find((e: { idx: number }) => e.idx === 64)).toMatchObject({ tag: "0064_einsatz", when: 1793750400000 });
  });
});

/**
 * Gegen die Wegwerf-Postgres (EINSATZ_TEST_DATABASE_URL): eigenes Schema mit
 * dem Stand vor 0064 (nur die Spalten, die 0064 liest), dann zweimal laufen.
 */
const url = process.env.EINSATZ_TEST_DATABASE_URL;

describe.skipIf(!url)("Migration 0064 Einsatz (DB)", () => {
  let db: postgres.Sql;
  const schema = `m0064_${Date.now().toString(36)}`;

  const lauf = async () => {
    for (const s of schritte) await db.unsafe(s);
  };

  beforeAll(async () => {
    db = postgres(url!, { max: 1, onnotice: () => {} });
    await db.unsafe(`CREATE SCHEMA ${schema}`);
    await db.unsafe(`SET search_path TO ${schema}`);
    await db.unsafe(`
      CREATE TABLE workspaces (id text PRIMARY KEY);
      CREATE TABLE records (id text PRIMARY KEY);
      CREATE TABLE employees (id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id),
        name text NOT NULL, hourly_rate numeric(10,2) NOT NULL);
      CREATE TABLE deal_employees (id text PRIMARY KEY, deal_record_id text NOT NULL REFERENCES records(id),
        employee_id text NOT NULL REFERENCES employees(id), role text NOT NULL DEFAULT 'helper',
        created_at timestamp NOT NULL DEFAULT now());
      CREATE TABLE company_settings (operating_company_record_id text PRIMARY KEY, workspace_id text NOT NULL);
      CREATE TABLE deal_calculation_versions (id text PRIMARY KEY, vehicle_booking_id text);
      CREATE TABLE quotation_date_offers (id text PRIMARY KEY, vehicle_booking_id text);
      INSERT INTO workspaces VALUES ('w1');
      INSERT INTO records VALUES ('d1'), ('d2'), ('firma');
      INSERT INTO employees VALUES ('e1', 'w1', 'Anna', 20.00), ('e2', 'w1', 'Ben', 17.50), ('e3', 'w1', 'Cem', 22.55);
      INSERT INTO deal_employees (id, deal_record_id, employee_id, role, created_at) VALUES
        ('z1', 'd1', 'e1', 'helper', '2026-10-01 08:00'),
        ('z2', 'd1', 'e1', 'lead',   '2026-10-02 08:00'),
        ('z3', 'd1', 'e1', 'helper', '2026-10-03 08:00'),
        ('z4', 'd1', 'e2', 'lead',   '2026-10-01 08:00'),
        ('z5', 'd2', 'e2', 'helper', '2026-10-01 08:00'),
        ('z6', 'd2', 'e2', 'helper', '2026-10-01 08:00');
      INSERT INTO company_settings VALUES ('firma', 'w1');
      INSERT INTO deal_calculation_versions VALUES ('v1', NULL);
      INSERT INTO quotation_date_offers VALUES ('o1', NULL);
    `);
    await lauf();
  });

  afterAll(async () => {
    await db.unsafe(`DROP SCHEMA ${schema} CASCADE`);
    await db.end();
  });

  it("zweiter Lauf ändert nichts und scheitert nicht", async () => {
    const vorher = await db`SELECT id, role FROM deal_employees ORDER BY id`;
    await lauf();
    expect(await db`SELECT id, role FROM deal_employees ORDER BY id`).toEqual(vorher);
  });

  it("Backfill trifft jeden Satz genau, Vorgaben für neue Personen", async () => {
    const rows = await db`SELECT id, rate_work_cents, rate_drive_cents, active, can_drive_sprinter, own_car FROM employees ORDER BY id`;
    expect(rows.map((r) => [r.id, r.rate_work_cents])).toEqual([["e1", 2000], ["e2", 1750], ["e3", 2255]]);
    expect(rows.every((r) => r.rate_drive_cents === 1500 && r.active === true && !r.can_drive_sprinter && !r.own_car)).toBe(true);
    await db`INSERT INTO employees (id, workspace_id, name, hourly_rate) VALUES ('e4', 'w1', 'Dora', 20.00)`;
    expect((await db`SELECT rate_work_cents FROM employees WHERE id = 'e4'`)[0]!.rate_work_cents).toBe(2000);
  });

  it("CHECK hält Satz und PLZ fest", async () => {
    await expect(db`INSERT INTO employees (id, workspace_id, name, hourly_rate) VALUES ('x1', 'w1', 'X', 25.00)`).rejects.toThrow(/employees_satz_abgeleitet/);
    await expect(db`UPDATE employees SET home_plz = '7017' WHERE id = 'e1'`).rejects.toThrow(/employees_home_plz_format/);
    await db`UPDATE employees SET home_plz = '01067', home_town = 'Dresden' WHERE id = 'e1'`;
    await db`UPDATE employees SET hourly_rate = 25.00, rate_work_cents = 2500 WHERE id = 'e1'`;
  });

  it("Dubletten aufgelöst: älteste bleibt, lead bleibt erhalten, Unique aktiv", async () => {
    const rows = await db`SELECT id, deal_record_id, employee_id, role FROM deal_employees ORDER BY id`;
    expect(rows.map((r) => [r.id, r.role])).toEqual([["z1", "lead"], ["z4", "lead"], ["z5", "helper"]]);
    await expect(db`INSERT INTO deal_employees (id, deal_record_id, employee_id) VALUES ('z9', 'd1', 'e1')`).rejects.toThrow(/deal_employees_deal_employee_uq/);
  });

  it("Ausnahmen, Buchungen, Fremdschlüssel und Firmen-Schalter", async () => {
    await expect(db`INSERT INTO employee_absences (id, workspace_id, employee_id, von, bis, art) VALUES ('a1', 'w1', 'e1', '2026-11-10', '2026-11-09', 'urlaub')`).rejects.toThrow(/zeitraum/);
    await expect(db`INSERT INTO employee_absences (id, workspace_id, employee_id, von, bis, art) VALUES ('a1', 'w1', 'e1', '2026-11-10', '2026-11-10', 'frei')`).rejects.toThrow(/art_check/);
    await db`INSERT INTO employee_absences (id, workspace_id, employee_id, von, bis, art) VALUES ('a1', 'w1', 'e1', '2026-11-30', '2026-12-02', 'krank')`;
    await expect(db`INSERT INTO einsatz_wege (workspace_id, ort_schluessel, adresse_schluessel, km) VALUES ('w1', 'a', 'b', -1)`).rejects.toThrow(/km_check/);
    const buchung = (id: string, auftraege: number, status = "geplant") =>
      db`INSERT INTO vehicle_bookings (id, workspace_id, operating_company_record_id, von, bis, station_id, station_name, klasse_id, klasse_name, miete_cents, geplante_auftraege, status)
         VALUES (${id}, 'w1', 'firma', '2026-11-17', '2026-11-23', 's', 'Sixt', 'k', 'Sprinter', 45000, ${auftraege}, ${status})`;
    await expect(buchung("b0", 0)).rejects.toThrow(/auftraege_check/);
    await expect(buchung("b0", 21)).rejects.toThrow(/auftraege_check/);
    await expect(buchung("b0", 2, "weg")).rejects.toThrow(/status_check/);
    await buchung("b1", 4);
    await db`INSERT INTO deal_vehicle_bookings (deal_record_id, booking_id, workspace_id) VALUES ('d1', 'b1', 'w1')`;
    await expect(db`INSERT INTO deal_vehicle_bookings (deal_record_id, booking_id, workspace_id) VALUES ('d1', 'b1', 'w1')`).rejects.toThrow();
    await expect(db`UPDATE deal_calculation_versions SET vehicle_booking_id = 'gibtsnicht' WHERE id = 'v1'`).rejects.toThrow(/vehicle_booking_fk/);
    await db`UPDATE deal_calculation_versions SET vehicle_booking_id = 'b1' WHERE id = 'v1'`;
    await db`UPDATE quotation_date_offers SET vehicle_booking_id = 'b1' WHERE id = 'o1'`;
    expect((await db`SELECT buchung_im_preis FROM company_settings`)[0]!.buchung_im_preis).toBe(false);
  });
});
