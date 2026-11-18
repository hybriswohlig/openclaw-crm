import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Kunden-Link über zwei Workspaces (Review kv-danach I3): ein Token aus Workspace A
 * geht nie an jemanden in Workspace B, weder über GET noch über POST noch über
 * `ensureCustomerStatusLink`. Läuft nur mit PORTAL_SETTINGS_TEST_DATABASE_URL
 * (Wegwerf-DB, nie Neon).
 */
const url = process.env.PORTAL_SETTINGS_TEST_DATABASE_URL;

const mocks = vi.hoisted(() => ({ getAuthContext: vi.fn() }));
vi.mock("@/lib/api-utils", async (orig) => ({ ...(await orig<typeof import("@/lib/api-utils")>()), getAuthContext: mocks.getAuthContext }));
vi.mock("@/services/customer-portal-data", async (orig) => ({
  ...(await orig<typeof import("@/services/customer-portal-data")>()),
  resolveCustomerLinkOrigin: async () => "https://status.test",
  loadVisitTelemetry: async () => null,
}));
vi.mock("@/services/kva-widerruf", () => ({ laufendeWiderrufsfrist: async () => null }));

describe.skipIf(!url)("Kunden-Link: Workspace-Grenze (DB)", () => {
  let sql: postgres.Sql;
  let route: typeof import("./route");
  let svc: typeof import("@/services/customer-portal-data");
  const wsA = randomUUID();
  const wsB = randomUUID();
  const objA = randomUUID();
  const objB = randomUUID();
  const dealA = randomUUID();
  const dealB = randomUUID();
  const tokenA = `tokA${randomUUID().replace(/-/g, "").slice(0, 28)}`;
  // kv-danach M1: Deal in A, dessen Firma das Portal aus hat, mit vorhandenem Link.
  const objFirma = randomUUID();
  const attrFirma = randomUUID();
  const firmaAus = randomUUID();
  const dealAus = randomUUID();
  const tokenAus = `tokX${randomUUID().replace(/-/g, "").slice(0, 28)}`;

  const ctx = (ws: string) => ({ userId: "usr_1", workspaceId: ws, workspaceRole: "admin", permissions: {}, authMethod: "session" });
  const aufruf = (methode: "GET" | "POST", deal: string) =>
    route[methode](new NextRequest(`https://crm.test/api/v1/customer-link/${deal}`, { method: methode }), {
      params: Promise.resolve({ dealRecordId: deal }),
    });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    sql = postgres(url!, { max: 1 });
    await sql`insert into workspaces (id, name, slug) values (${wsA}, 'A', ${`t-${wsA}`}), (${wsB}, 'B', ${`t-${wsB}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${objA}, ${wsA}, 'deals', 'Deal', 'Deals'), (${objB}, ${wsB}, 'deals', 'Deal', 'Deals')`;
    await sql`insert into records (id, object_id) values (${dealA}, ${objA}), (${dealB}, ${objB})`;
    await sql`insert into customer_status_links (id, workspace_id, deal_record_id, token) values (${randomUUID()}, ${wsA}, ${dealA}, ${tokenA})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${objFirma}, ${wsA}, 'operating_companies', 'Firma', 'Firmen')`;
    await sql`insert into attributes (id, object_id, slug, title, type) values (${attrFirma}, ${objA}, 'operating_company', 'Firma', 'record_reference')`;
    await sql`insert into records (id, object_id) values (${firmaAus}, ${objFirma}), (${dealAus}, ${objA})`;
    await sql`insert into record_values (id, record_id, attribute_id, referenced_record_id) values (${randomUUID()}, ${dealAus}, ${attrFirma}, ${firmaAus})`;
    await sql`insert into operating_company_portal_settings (workspace_id, operating_company_record_id, enabled) values (${wsA}, ${firmaAus}, false)`;
    await sql`insert into customer_status_links (id, workspace_id, deal_record_id, token) values (${randomUUID()}, ${wsA}, ${dealAus}, ${tokenAus})`;
    route = await import("./route");
    svc = await import("@/services/customer-portal-data");
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from customer_status_links where workspace_id in (${wsA}, ${wsB})`;
    await sql`delete from operating_company_portal_settings where workspace_id = ${wsA}`;
    await sql`delete from record_values where record_id = ${dealAus}`;
    await sql`delete from attributes where id = ${attrFirma}`;
    await sql`delete from records where id in (${dealA}, ${dealB}, ${dealAus}, ${firmaAus})`;
    await sql`delete from objects where id in (${objA}, ${objB}, ${objFirma})`;
    await sql`delete from workspaces where id in (${wsA}, ${wsB})`;
    await sql.end();
  });

  beforeEach(() => mocks.getAuthContext.mockReset());

  it("Workspace A bekommt seinen Link", async () => {
    mocks.getAuthContext.mockResolvedValue(ctx(wsA));
    const res = await aufruf("GET", dealA);
    expect(res.status).toBe(200);
    const data = (await res.json()).data;
    expect(data.url).toBe(`https://status.test/s/${tokenA}`);
    expect(data.portalAn).toBe(true);
  });

  it("Portal der Firma aus: GET meldet portalAn false, der Kopierweg gibt den Link nicht heraus (kv-danach M1)", async () => {
    mocks.getAuthContext.mockResolvedValue(ctx(wsA));
    const res = await aufruf("GET", dealAus);
    expect(res.status).toBe(200);
    const data = (await res.json()).data;
    expect(data.portalAn).toBe(false);
    const { statusLinkAusGet } = await import("@/lib/kv-danach");
    expect(statusLinkAusGet({ ok: true, data })).toEqual({ art: "portal_aus" });
    expect(await svc.portalAnFuerDeal(wsA, dealAus)).toBe(false);
    expect(await svc.portalAnFuerDeal(wsA, dealA)).toBe(true);
  });

  it("Workspace B sieht den Deal aus A nicht: GET und POST 404 ohne Token, kein neuer Link", async () => {
    mocks.getAuthContext.mockResolvedValue(ctx(wsB));
    for (const methode of ["GET", "POST"] as const) {
      const res = await aufruf(methode, dealA);
      expect(res.status).toBe(404);
      const text = await res.text();
      expect(text).not.toContain(tokenA);
      expect(JSON.parse(text).error.code).toBe("NOT_FOUND");
    }
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from customer_status_links where deal_record_id = ${dealA}`;
    expect(n).toBe(1);
  });

  it("ensureCustomerStatusLink gibt einem fremden Workspace nie den Token", async () => {
    const r = await svc.ensureCustomerStatusLink({ workspaceId: wsB, dealRecordId: dealA, createdBy: null });
    expect(r.token).toBeNull();
    const eigen = await svc.ensureCustomerStatusLink({ workspaceId: wsA, dealRecordId: dealA, createdBy: null });
    expect(eigen).toEqual({ token: tokenA, created: false, skipped: false });
  });

  it("Deal im eigenen Workspace ohne Link: GET 404 mit KEIN_LINK (nur dann legt der Kopierweg an)", async () => {
    mocks.getAuthContext.mockResolvedValue(ctx(wsB));
    const res = await aufruf("GET", dealB);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("KEIN_LINK");
  });
});
