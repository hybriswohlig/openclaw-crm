import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { KvEditorHaken, KvStandKopf } from "@/lib/kv-editor";

/**
 * KV über den CRM-Renderer mit dem KV-Editor gegen eine echte Postgres-DB (Plan 2c, Kimi 1 und 5):
 * Dokument und Stand in einer Transaktion unter `angebotSperren`, Versionswechsel zwischen Rendern
 * und Ablegen, Push dazwischen. Läuft nur mit KV_DRUCK_TEST_DATABASE_URL (Wegwerf-DB, nie Neon).
 * Der Haken ist ein Test-Haken, der den Stand wirklich in `kv_staende` schreibt (Aufgabe 3 baut den echten).
 */
const url = process.env.KV_DRUCK_TEST_DATABASE_URL;
const stand = vi.hoisted(() => ({ deal: "", firma: "", beimRendern: null as null | (() => Promise<void>) }));

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.KV_DRUCK_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 4 });
  return { db: drizzle(client, { schema }), __client: client };
});
vi.mock("./activity-events", () => ({ emitEvent: async () => {} }));
vi.mock("./wartet", () => ({ aktualisiereWartet: async () => {}, aktualisiereWartetNachBesuch: async () => {} }));
vi.mock("./customer-portal-notifications", () => ({ maybeNotifyPortalEvent: async () => {} }));
vi.mock("./deal-attribution", () => ({ advanceDealToQuotedIfEarlier: async () => {} }));
vi.mock("@/services/records", () => ({
  getRecord: async (_o: string, id: string) =>
    id === stand.deal
      ? { values: { name: "Umzug Beispiel", operating_company: { id: stand.firma, displayName: "Ceylan Umzüge" }, move_date: "2026-12-15" } }
      : { values: { name: "Ceylan Umzüge" } },
}));
vi.mock("@/services/doc-customer-name", () => ({
  resolveDocCustomerName: async () => ({ vorname: "Mira", nachname: "Beispiel", fullName: "Mira Beispiel", source: "person" }),
}));
vi.mock("@/services/customer-portal-emails", () => ({ loadCustomerEmail: async () => null }));
vi.mock("@/services/agent/agent-suppress", () => ({ ladeGespeicherteAnrede: async () => ({}), anredeFuerOptOut: () => "sie" }));
vi.mock("@openclaw-crm/document-templates", async (orig) => {
  const echt = await orig<typeof import("@openclaw-crm/document-templates")>();
  return {
    ...echt,
    renderPdf: async (m: Parameters<typeof echt.renderPdf>[0]) => {
      if (stand.beimRendern) await stand.beimRendern();
      return echt.renderPdf(m);
    },
  };
});

describe.skipIf(!url)("CRM-KV mit KV-Editor (DB, Plan 2c)", { timeout: 30_000 }, () => {
  let sql: postgres.Sql;
  let docs: typeof import("./commercial-documents");
  let schema: typeof import("@/db/schema/kv-editor");
  const ws = randomUUID();
  const objDeals = randomUUID();
  const objFirmen = randomUUID();
  const attrFirma = randomUUID();
  const attrName = randomUUID();
  const firma = randomUUID();
  let v1 = "";
  let v2 = "";
  let deal = "";
  let quelle: { id: string; aenderungen: []; offen: [] } | null = null;
  let standFehler = false;

  /** Test-Haken: schreibt den Stand über `ex` (dieselbe Transaktion wie das Dokument). */
  const haken: KvEditorHaken = {
    kvEditorBeimNeuenKv: async () => ({ quelle }),
    kvEditorStandZumNeuenKv: async (ex, w, d, e) => {
      if (standFehler) throw new Error("Stand kaputt");
      const [{ n }] = await sql<{ n: number }[]>`select coalesce(max(nummer), 0)::int + 1 as n from kv_staende where deal_record_id = ${d}`;
      const [row] = await ex
        .insert(schema.kvStaende)
        .values({
          workspaceId: w,
          dealRecordId: d,
          nummer: n,
          vorgaengerId: e.quelleId,
          renderer: e.renderer,
          calculationVersionId: e.calculationVersionId,
          grundlage: e.grundlage,
          aenderungen: e.aenderungen,
          offen: e.offen,
          quelle: e.aenderungen.length > 0 ? "mitgewandert" : "neu",
          status: "fertig",
          dealDocumentId: e.dealDocumentId,
          fileName: e.datei?.fileName ?? null,
          fileSize: e.datei?.fileSize ?? null,
          fileContent: e.datei?.fileContent ?? null,
        })
        .returning({ id: schema.kvStaende.id });
      return { id: row.id } as KvStandKopf;
    },
  };

  const zaehlen = async () => {
    const [{ d }] = await sql<{ d: number }[]>`select count(*)::int as d from deal_documents where deal_record_id = ${deal}`;
    const [{ s }] = await sql<{ s: number }[]>`select count(*)::int as s from kv_staende where deal_record_id = ${deal}`;
    return { dokumente: d, staende: s };
  };

  beforeAll(async () => {
    sql = postgres(url!, { max: 2 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'KV-Druck', ${`t-${ws}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${objDeals}, ${ws}, 'deals', 'Deal', 'Deals'), (${objFirmen}, ${ws}, 'operating_companies', 'Firma', 'Firmen')`;
    await sql`insert into attributes (id, object_id, slug, title, type) values
      (${attrFirma}, ${objDeals}, 'operating_company', 'Firma', 'record_reference'),
      (${attrName}, ${objFirmen}, 'name', 'Name', 'text')`;
    await sql`insert into records (id, object_id) values (${firma}, ${objFirmen})`;
    await sql`insert into record_values (id, record_id, attribute_id, text_value) values (${randomUUID()}, ${firma}, ${attrName}, 'Ceylan Umzüge')`;
    stand.firma = firma;
    docs = await import("./commercial-documents");
    schema = await import("@/db/schema/kv-editor");
  });

  beforeEach(async () => {
    stand.beimRendern = null;
    quelle = null;
    standFehler = false;
    deal = randomUUID();
    stand.deal = deal;
    await sql`insert into records (id, object_id) values (${deal}, ${objDeals})`;
    await sql`insert into record_values (id, record_id, attribute_id, referenced_record_id) values (${randomUUID()}, ${deal}, ${attrFirma}, ${firma})`;
    v1 = randomUUID();
    v2 = randomUUID();
    for (const [id, nr] of [[v1, 1], [v2, 2]] as const) {
      await sql`insert into deal_calculation_versions (id, workspace_id, deal_record_id, version, status, reference_date)
        values (${id}, ${ws}, ${deal}, ${nr}, 'gesperrt', '2026-11-07')`;
    }
    const q = randomUUID();
    await sql`insert into quotations (id, deal_record_id, is_variable, fixed_price, calculation_version_id)
      values (${q}, ${deal}, false, '900.00', ${v1})`;
    await sql`insert into quotation_line_items (id, quotation_id, type, description, quantity, unit_rate, sort_order)
      values (${randomUUID()}, ${q}, 'other', 'Umzug', 1, '900.00', 0)`;
  });

  afterAll(async () => {
    await sql?.end();
    await ((await import("@/db")) as unknown as { __client: postgres.Sql }).__client.end();
  });

  const speichern = () => docs.storeCommercialDocument({ workspaceId: ws, dealRecordId: deal, kind: "KV", kvEditor: haken });

  it("Dokument und Stand in einer Transaktion, Stand verweist auf das Dokument und behält die Datei", async () => {
    const r = await speichern();
    const [s] = await sql`select deal_document_id, calculation_version_id, file_size, renderer from kv_staende where deal_record_id = ${deal}`;
    expect(s).toMatchObject({ deal_document_id: r.document.id, calculation_version_id: v1, renderer: "crm" });
    expect(s.file_size).toBeGreaterThan(0);
    expect(await zaehlen()).toEqual({ dokumente: 1, staende: 1 });
  });

  it("Versionswechsel zwischen Rendern und Ablegen: 409, weder Dokument noch Stand (Kimi 5)", async () => {
    stand.beimRendern = async () => {
      await sql`update quotations set calculation_version_id = ${v2} where deal_record_id = ${deal}`;
    };
    await expect(speichern()).rejects.toMatchObject({ status: 409, code: "KALKULATION_NEU" });
    expect(await zaehlen()).toEqual({ dokumente: 0, staende: 0 });
  });

  it("Stand scheitert: auch das Dokument wird zurückgerollt", async () => {
    standFehler = true;
    await expect(speichern()).rejects.toThrow("Stand kaputt");
    expect(await zaehlen()).toEqual({ dokumente: 0, staende: 0 });
  });

  it("älterer KV nach einem Push von Hand: verworfen (Kimi 1); mit dem gepushten Stand als Quelle: abgelegt", async () => {
    const erst = await speichern();
    // Stand 1 wird „von Hand“ gepusht (wie Aufgabe 3 es täte).
    const [s1] = await sql`update kv_staende set quelle = 'hand', gepusht_am = now() where deal_document_id = ${erst.document.id} returning id, nummer`;
    // Ein KV, der vor dem Push gestartet wurde (Quelle null), darf den Push nicht überschreiben.
    await expect(speichern()).rejects.toMatchObject({
      status: 409,
      message: `Inzwischen wurde Stand ${s1.nummer} gepusht. KV neu erstellen, die Änderungen wandern mit.`,
    });
    expect(await zaehlen()).toEqual({ dokumente: 1, staende: 1 });
    quelle = { id: s1.id, aenderungen: [], offen: [] };
    await speichern();
    expect(await zaehlen()).toEqual({ dokumente: 2, staende: 2 });
  });
});
