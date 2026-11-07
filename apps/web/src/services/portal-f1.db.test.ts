import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildDocumentModel, priceSourceFromStored } from "@openclaw-crm/document-templates";

/**
 * Fix-Welle F1 zu Plan 5b gegen eine echte Postgres-Datenbank:
 * - Kalkulationsgrundlagen im Portal-Kontext ohne Rechner-Hinweise (Beträge, Spannen, Mietstation).
 * - Stunden-KV aus der Version: die AB aus dem echten Annahme-Schnappschuss nennt die Schätzung (K2).
 *
 * Läuft nur mit ANNAHME_TEST_DATABASE_URL (Wegwerf-DB mit Schema bis 0061).
 */
const url = process.env.ANNAHME_TEST_DATABASE_URL;

vi.mock("./agb", () => ({ ladeAgbHtml: async () => `<h1>AGB</h1>${"Text der AGB. ".repeat(60)}` }));
vi.mock("./activity-events", () => ({ emitEvent: async () => {} }));
vi.mock("./wartet", () => ({ aktualisiereWartet: async () => {}, aktualisiereWartetNachBesuch: async () => {} }));

const RECHNER_HINWEIS =
  "Mietstation SIXT Sindelfingen (Anfahrt 12 Min, Rückfahrt 14 Min). Schnellschätzung 670 bis 1180 €, übernommen: Obergrenze.";

describe.skipIf(!url)("Portal und AB nach F1 (DB)", { timeout: 20_000 }, () => {
  let sql: postgres.Sql;
  let portal: typeof import("./customer-portal-data");
  let dokumente: typeof import("./commercial-documents");
  const ws = randomUUID();
  const obj = randomUUID();

  async function deal() {
    const id = randomUUID();
    const token = randomUUID().replace(/-/g, "");
    await sql`insert into records (id, object_id) values (${id}, ${obj})`;
    await sql`insert into customer_status_links (id, workspace_id, deal_record_id, token) values (${randomUUID()}, ${ws}, ${id}, ${token})`;
    return { id, token };
  }

  async function festpreis(dealId: string, annahmen: unknown) {
    const q = randomUUID();
    await sql`insert into quotations (id, deal_record_id, fixed_price, is_variable, service_type, calculation_assumptions)
      values (${q}, ${dealId}, '1180.00', false, 'move', ${sql.json(annahmen as never)})`;
    await sql`insert into quotation_line_items (id, quotation_id, type, description, quantity, unit_rate, sort_order)
      values (${randomUUID()}, ${q}, 'other', 'Umzug', 1, '1180.00', 0)`;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    sql = postgres(url!, { max: 3 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Test', ${`t-${ws}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${obj}, ${ws}, 'deals', 'Deal', 'Deals')`;
    portal = await import("./customer-portal-data");
    dokumente = await import("./commercial-documents");
  });

  afterAll(async () => {
    await sql`delete from workspaces where id = ${ws}`;
    await sql.end();
  });

  it("Kalkulationsgrundlagen: Rechner-Hinweis aus einer alten Übernahme fehlt im Kontext, die Angaben bleiben", async () => {
    const d = await deal();
    await festpreis(d.id, {
      anfahrtMinuten: 55,
      anfahrtQuelle: "berechnet",
      etageVon: "3",
      hinweis: RECHNER_HINWEIS,
      selbstkosten: 700,
      uebernommenVon: "mensch",
      uebernommenAm: "2026-11-01T10:00:00.000Z",
    });
    const c = (await portal.loadContextByToken(d.token))!;
    const json = JSON.stringify(c);
    for (const wort of ["Schnellschätzung", "Mietstation", "670 bis 1180", "Obergrenze", "selbstkosten"]) {
      expect(json).not.toContain(wort);
    }
    expect(c.kva?.calculationAssumptions).toMatchObject({ anfahrtMinuten: 55, etageVon: "3", hinweis: null });
  });

  it("Kalkulationsgrundlagen: bleibt nur der Rechner-Hinweis, entfällt der Abschnitt (null im Kontext)", async () => {
    const d = await deal();
    await festpreis(d.id, { hinweis: RECHNER_HINWEIS, selbstkosten: 700, uebernommenVon: "agent" });
    const c = (await portal.loadContextByToken(d.token))!;
    expect(c.kva?.calculationAssumptions).toBeNull();
    expect(JSON.stringify(c)).not.toContain("Schnellschätzung");
  });

  it("Kalkulationsgrundlagen: neue Übernahme schreibt den Rechner-Hinweis intern, nicht in den Kontext", async () => {
    const d = await deal();
    await festpreis(d.id, { anfahrtMinuten: 40, hinweis: null, rechnerHinweis: RECHNER_HINWEIS, uebernommenVon: "mensch" });
    const c = (await portal.loadContextByToken(d.token))!;
    expect(JSON.stringify(c)).not.toContain("Schnellschätzung");
    expect(JSON.stringify(c)).not.toContain("rechnerHinweis");
    expect(c.kva?.calculationAssumptions).toMatchObject({ anfahrtMinuten: 40 });
  });

  it("Stunden-KV aus der Version: die AB aus dem Annahme-Schnappschuss nennt die Schätzung wie der KV (K2)", async () => {
    const d = await deal();
    const v = randomUUID();
    await sql`insert into deal_calculation_versions (id, workspace_id, deal_record_id, version, status, pricing_mode, reference_date, price_cents)
      values (${v}, ${ws}, ${d.id}, 1, 'gesperrt', 'stunden', '2099-01-10', 71500)`;
    await sql`insert into deal_documents (id, workspace_id, deal_record_id, document_type, file_name, file_size, mime_type, file_content, calculation_version_id)
      values (${randomUUID()}, ${ws}, ${d.id}, 'quotation', 'KV.pdf', 10, 'application/pdf', ${Buffer.from("%PDF test").toString("base64")}, ${v})`;
    const stunden = {
      helfer: 3, transporter: 1, stundenGeschaetzt: 5.5, mindestStunden: 3, satzHelferEur: 35, satzTransporterEur: 25,
      summeGeschaetztCent: 71500, mindestbetragCent: 39000, quelle: "version",
    };
    const q = randomUUID();
    await sql`insert into quotations (id, deal_record_id, fixed_price, is_variable, service_type, calculation_version_id, document_details)
      values (${q}, ${d.id}, null, true, 'kitchen_installation', ${v}, ${sql.json({ stunden })})`;
    for (const [i, [typ, text, menge, satz]] of ([["helper", "Helfer", 3, "35.00"], ["transporter", "Transporter", 1, "25.00"]] as const).entries()) {
      await sql`insert into quotation_line_items (id, quotation_id, type, description, quantity, unit_rate, sort_order)
        values (${randomUUID()}, ${q}, ${typ}, ${text}, ${menge}, ${satz}, ${i})`;
    }
    // Küche: die Annahme verlangt keinen Termin.
    const antwort = await portal.confirmKvaForToken(
      d.token,
      {
        acceptedOffer: true,
        acceptedAgb: true,
        haftungshinweisBestaetigt: false,
        versicherungGewuenscht: false,
        vorzeitigerBeginnVerlangt: false,
        expectedTotalCents: 71500,
        fullName: "Anna Muster",
      },
      { ipAddress: "203.0.113.5", userAgent: "test" }
    );
    expect(antwort).toMatchObject({ ok: true });
    const [a] = await sql`select quotation_snapshot from kva_confirmations where deal_record_id = ${d.id}`;

    const quelle = priceSourceFromStored({
      isVariable: true,
      fixedPrice: null,
      lineItems: [
        { type: "helper", description: "Helfer", quantity: 3, unitRate: "35.00" },
        { type: "transporter", description: "Transporter", quantity: 1, unitRate: "25.00" },
      ],
      depositRequiredCents: null,
      paymentMethodPreference: null,
      validUntil: null,
      serviceType: "move",
      documentDetails: { stunden },
      calculationVersionId: v,
    });
    const facts = { firma: "ceylan" as const, customerName: "Anna Muster", documentDate: "2099-01-10" };
    const kv = buildDocumentModel({ kind: "KV", deal: facts, quotation: quelle });
    const ab = buildDocumentModel({ kind: "AB", deal: facts, quotation: quelle, accepted: dokumente.acceptedPriceFor("AB", a.quotation_snapshot) });
    expect(kv.totalCents).toBe(71500);
    // Vorher: 3 × 35 + 25 = 130 € als „Voraussichtlicher Gesamtbetrag“.
    expect(ab.totalCents).toBe(71500);
    expect(ab.totalCaption).toBe("Voraussichtlicher Gesamtbetrag");
    expect(ab.positions.map((p) => p.quantityLabel)).not.toContain("1 Std.");
  });
});
