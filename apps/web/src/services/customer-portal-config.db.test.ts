import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Firmen-Schalter und Hebel je Paket gegen eine echte Postgres-Datenbank
 * (Plan 5b, Task U1). Läuft nur mit PORTAL_SETTINGS_TEST_DATABASE_URL:
 * Wegwerf-DB mit Schema inkl. Migration 0061. Nie gegen Neon.
 */
const url = process.env.PORTAL_SETTINGS_TEST_DATABASE_URL;

vi.mock("./vercel-domains", () => ({
  attachDomain: vi.fn(),
  getDomainStatus: vi.fn(),
  triggerVerify: vi.fn(),
  isConfigured: () => false,
}));

describe.skipIf(!url)("Portal-Einstellungen: Schalter und Hebel (DB)", () => {
  let sql: postgres.Sql;
  let svc: typeof import("./customer-portal-config");
  const ws = randomUUID();
  const fremd = randomUUID();
  const obj = randomUUID();
  const objFremd = randomUUID();
  const oc = randomUUID();
  const ocFremd = randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    sql = postgres(url!, { max: 1 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Test', ${`t-${ws}`})`;
    await sql`insert into workspaces (id, name, slug) values (${fremd}, 'Fremd', ${`t-${fremd}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${obj}, ${ws}, 'operating_companies', 'Firma', 'Firmen')`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${objFremd}, ${fremd}, 'operating_companies', 'Firma', 'Firmen')`;
    await sql`insert into records (id, object_id) values (${oc}, ${obj})`;
    await sql`insert into records (id, object_id) values (${ocFremd}, ${objFremd})`;
    svc = await import("./customer-portal-config");
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from offer_packages where workspace_id in (${ws}, ${fremd})`;
    await sql`delete from operating_company_portal_settings where workspace_id in (${ws}, ${fremd})`;
    await sql`delete from records where id in (${oc}, ${ocFremd})`;
    await sql`delete from objects where id in (${obj}, ${objFremd})`;
    await sql`delete from workspaces where id in (${ws}, ${fremd})`;
    await sql.end();
  });

  it("ohne Zeile: beide Schalter aus", async () => {
    const s = await svc.getOperatingCompanyPortalSettings(ws, oc);
    expect(s).toMatchObject({ angebotAusKalkulation: false, tagespreiseEnabled: false });
  });

  it("Schalter speichern und lesen", async () => {
    const s = await svc.upsertOperatingCompanyPortalSettings(ws, oc, { angebotAusKalkulation: true, tagespreiseEnabled: true });
    expect(s).toMatchObject({ angebotAusKalkulation: true, tagespreiseEnabled: true, signatureEnabled: false });
    const [row] = await sql`select angebot_aus_kalkulation, tagespreise_enabled from operating_company_portal_settings where workspace_id = ${ws} and operating_company_record_id = ${oc}`;
    expect(row).toEqual({ angebot_aus_kalkulation: true, tagespreise_enabled: true });
  });

  it("„Angebot aus Kalkulation“ aus schaltet die Tagespreise mit aus", async () => {
    const s = await svc.upsertOperatingCompanyPortalSettings(ws, oc, { angebotAusKalkulation: false });
    expect(s).toMatchObject({ angebotAusKalkulation: false, tagespreiseEnabled: false });
    const [row] = await sql`select tagespreise_enabled from operating_company_portal_settings where workspace_id = ${ws} and operating_company_record_id = ${oc}`;
    expect(row.tagespreise_enabled).toBe(false);
  });

  it("Tagespreise allein bleiben ohne „Angebot aus Kalkulation“ aus", async () => {
    const s = await svc.upsertOperatingCompanyPortalSettings(ws, oc, { tagespreiseEnabled: true });
    expect(s?.tagespreiseEnabled).toBe(false);
  });

  it("Firma eines fremden Workspace: weder lesen noch schreiben", async () => {
    expect(await svc.getOperatingCompanyPortalSettings(ws, ocFremd)).toBeNull();
    expect(await svc.upsertOperatingCompanyPortalSettings(ws, ocFremd, { angebotAusKalkulation: true })).toBeNull();
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from operating_company_portal_settings where operating_company_record_id = ${ocFremd}`;
    expect(n).toBe(0);
    expect(await svc.createOfferPackage(ws, ocFremd, { slug: "komfort", displayName: "Komfort" })).toBeNull();
  });

  it("Hebel je Paket: anlegen, ändern, lesen", async () => {
    const neu = await svc.createOfferPackage(ws, oc, { slug: "komfort", displayName: "Komfort", hebel: ["halteverbot", "montage"] });
    expect(neu?.hebel).toEqual(["halteverbot", "montage"]);
    const geaendert = await svc.updateOfferPackage(ws, oc, neu!.id, { hebel: ["halteverbot", "montage", "einpacken", "kueche"] });
    expect(geaendert?.hebel).toEqual(["halteverbot", "montage", "einpacken", "kueche"]);
    const ohne = await svc.updateOfferPackage(ws, oc, neu!.id, { displayName: "Komfort+" });
    expect(ohne?.hebel).toEqual(["halteverbot", "montage", "einpacken", "kueche"]);
    const basis = await svc.createOfferPackage(ws, oc, { slug: "basis", displayName: "Basis" });
    expect(basis?.hebel).toEqual([]);
    const liste = await svc.listOfferPackages(ws, oc);
    expect(liste.map((p) => [p.slug, p.hebel.length])).toEqual(
      expect.arrayContaining([
        ["komfort", 4],
        ["basis", 0],
      ])
    );
  });

  it("Paket eines fremden Workspace lässt sich nicht ändern", async () => {
    const [p] = await svc.listOfferPackages(ws, oc);
    expect(await svc.updateOfferPackage(fremd, oc, p.id, { hebel: [] })).toBeNull();
  });
});
