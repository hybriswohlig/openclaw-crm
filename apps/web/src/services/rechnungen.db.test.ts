import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Plan 9, Task A gegen eine echte Postgres-DB: Prüfung, Nummer, Rollback,
 * Gleichzeitigkeit, Upload, Storno und der CRM-Renderer für RE.
 * Läuft nur mit GELD_TEST_DATABASE_URL (Wegwerf-DB, z. B.
 * postgres://postgres@127.0.0.1:54351/p9_geld). Nie gegen eine echte DB.
 */
const url = process.env.GELD_TEST_DATABASE_URL;
const stand = vi.hoisted(() => ({ deal: "", firma: "", renderFehler: false, ws: "" }));
vi.mock("@/lib/api-utils", async (orig) => ({
  ...(await orig<typeof import("@/lib/api-utils")>()),
  getAuthContext: async () => ({ userId: "u1", workspaceId: stand.ws, workspaceRole: "admin", authMethod: "cookie" }),
}));

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.GELD_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 4 });
  return { db: drizzle(client, { schema }), __client: client };
});
vi.mock("./activity-events", () => ({ emitEvent: async () => {} }));
vi.mock("./wartet", () => ({ aktualisiereWartet: async () => {}, aktualisiereWartetNachBesuch: async () => {} }));
vi.mock("./nach-zahlung", () => ({ nachZahlung: async () => ({ stufeGesetzt: false }) }));
vi.mock("./customer-portal-notifications", () => ({ maybeNotifyPortalEvent: async () => {} }));
vi.mock("@/services/records", () => ({
  getRecord: async (_o: string, id: string) =>
    id === stand.deal
      ? { values: { name: "Umzug Muster", operating_company: { id: stand.firma, displayName: "Ceylan Umzüge" }, move_date: "2026-11-21" } }
      : { values: { name: "Ceylan Umzüge" } },
  updateRecord: async () => ({ id: "x" }),
}));
vi.mock("@/services/doc-customer-name", () => ({
  resolveDocCustomerName: async () => ({ vorname: "Anna", nachname: "Muster", fullName: "Anna Muster", source: "person" }),
}));
vi.mock("@/services/customer-portal-emails", () => ({ loadCustomerEmail: async () => null }));
vi.mock("@/services/agent/agent-suppress", () => ({ ladeGespeicherteAnrede: async () => ({}), anredeFuerOptOut: () => "sie" }));
vi.mock("@openclaw-crm/document-templates", async (orig) => {
  const echt = await orig<typeof import("@openclaw-crm/document-templates")>();
  return {
    ...echt,
    renderPdf: async (m: Parameters<typeof echt.renderPdf>[0]) => {
      if (stand.renderFehler) throw new Error("Render kaputt");
      return echt.renderPdf(m);
    },
  };
});

describe.skipIf(!url)("Rechnung als Datensatz (DB, Plan 9 Task A)", { timeout: 30_000 }, () => {
  let sql: postgres.Sql;
  let r: typeof import("./rechnungen");
  let docs: typeof import("./commercial-documents");
  let db: typeof import("@/db")["db"];
  const ws = randomUUID();
  const objDeals = randomUUID();
  const objFirmen = randomUUID();
  const attrFirma = randomUUID();
  const attrMove = randomUUID();
  const attrName = randomUUID();
  const firma = randomUUID();
  const firma2 = randomUUID();
  let deal = "";
  const jetzt = new Date("2026-11-07T10:00:00Z");

  async function neuerDeal(opt: { festpreis?: string | null; annahmeCent?: number | null; stunden?: boolean; ohneFirma?: boolean; f?: string } = {}) {
    const id = randomUUID();
    await sql`insert into records (id, object_id) values (${id}, ${objDeals})`;
    if (!opt.ohneFirma) {
      await sql`insert into record_values (id, record_id, attribute_id, referenced_record_id) values (${randomUUID()}, ${id}, ${attrFirma}, ${opt.f ?? firma})`;
    }
    await sql`insert into record_values (id, record_id, attribute_id, date_value) values (${randomUUID()}, ${id}, ${attrMove}, '2026-11-21')`;
    const q = randomUUID();
    await sql`insert into quotations (id, deal_record_id, is_variable, fixed_price) values (${q}, ${id}, ${opt.stunden ?? false}, ${opt.festpreis === undefined ? "900.00" : opt.festpreis})`;
    if (opt.festpreis !== null && !opt.stunden) {
      await sql`insert into quotation_line_items (id, quotation_id, type, description, quantity, unit_rate, sort_order)
        values (${randomUUID()}, ${q}, 'other', 'Umzug', 1, ${opt.festpreis ?? "900.00"}, 0)`;
    }
    if (opt.annahmeCent != null) {
      const link = randomUUID();
      await sql`insert into customer_status_links (id, workspace_id, deal_record_id, token) values (${link}, ${ws}, ${id}, ${randomUUID().replace(/-/g, "")})`;
      await sql`insert into kva_confirmations (id, workspace_id, deal_record_id, customer_link_id, quotation_snapshot, confirmed_total_cents, agb_version_accepted, ip_address, user_agent)
        values (${randomUUID()}, ${ws}, ${id}, ${link}, ${sql.json({})}, ${opt.annahmeCent}, 'v1', '203.0.113.1', 'test')`;
    }
    return id;
  }

  async function reservieren(d: string, e: Partial<Parameters<typeof r.rechnungPruefenUndReservieren>[1]> = {}) {
    return db.transaction((tx) =>
      r.rechnungPruefenUndReservieren(tx, {
        ws,
        deal: d,
        herkunft: "crm",
        pdfBetragCent: 90000,
        eingabe: null,
        durchAgent: false,
        userId: "u1",
        jetzt,
        ...e,
      })
    );
  }

  beforeAll(async () => {
    sql = postgres(url!, { max: 2 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Test', ${`t-${ws}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${objDeals}, ${ws}, 'deals', 'Deal', 'Deals'), (${objFirmen}, ${ws}, 'operating_companies', 'Firma', 'Firmen')`;
    await sql`insert into attributes (id, object_id, slug, title, type) values
      (${attrFirma}, ${objDeals}, 'operating_company', 'Firma', 'record_reference'),
      (${attrMove}, ${objDeals}, 'move_date', 'Umzug', 'date'),
      (${attrName}, ${objFirmen}, 'name', 'Name', 'text')`;
    await sql`insert into records (id, object_id) values (${firma}, ${objFirmen}), (${firma2}, ${objFirmen})`;
    await sql`insert into record_values (id, record_id, attribute_id, text_value) values (${randomUUID()}, ${firma}, ${attrName}, 'Ceylan Umzüge'), (${randomUUID()}, ${firma2}, ${attrName}, 'Kottke')`;
    stand.firma = firma;
    stand.ws = ws;
    db = (await import("@/db")).db;
    r = await import("./rechnungen");
    docs = await import("./commercial-documents");
  });

  beforeEach(async () => {
    stand.renderFehler = false;
    deal = await neuerDeal({ annahmeCent: 90000 });
    stand.deal = deal;
  });

  afterAll(async () => {
    await sql?.end();
    // Pool des gemockten `@/db` ebenfalls schließen (Verbindungslimit der Wegwerf-DB).
    await ((await import("@/db")) as unknown as { __client: postgres.Sql }).__client.end();
  });

  it("vergibt fortlaufende Nummern je Firma und Berliner Jahr, Fälligkeit am Umzugstag", async () => {
    const a = await reservieren(deal);
    const b = await reservieren(await neuerDeal({ annahmeCent: 90000 }));
    const k = await reservieren(await neuerDeal({ annahmeCent: 90000, f: firma2 }));
    expect(b.laufnummer).toBe(a.laufnummer! + 1);
    expect(a.nummer).toMatch(/^RE-2026-\d{4}$/);
    expect(k.laufnummer).toBe(1);
    expect(a.faelligAm).toBe("2026-11-21");
    expect(a.status).toBe("entwurf");
    expect(a.bruttoCent).toBe(90000);
    // 23:30 UTC am 31.12. ist in Berlin schon 2027.
    const neujahr = await reservieren(await neuerDeal({ annahmeCent: 90000, f: firma2 }), { jetzt: new Date("2026-12-31T23:30:00Z") });
    expect(neujahr.nummer).toBe("RE-2027-0001");
    expect(neujahr.rechnungstag).toBe("2027-01-01");
  });

  it("Rollback: scheitert die Transaktion, bleibt der Zähler stehen", async () => {
    const vorher = await reservieren(await neuerDeal({ annahmeCent: 90000, f: firma2 }));
    await expect(
      db.transaction(async (tx) => {
        await r.rechnungPruefenUndReservieren(tx, { ws, deal, herkunft: "crm", pdfBetragCent: 90000, eingabe: null, durchAgent: false, userId: "u1", jetzt });
        throw new Error("Rendern gescheitert");
      })
    ).rejects.toThrow("Rendern gescheitert");
    const d2 = await neuerDeal({ annahmeCent: 90000, f: firma2 });
    const danach = await reservieren(d2);
    expect(danach.laufnummer).toBe(vorher.laufnummer! + 1);
    expect(await r.aktiveRechnung(ws, deal)).toBeNull();
  });

  it("Prüfung: Abweichung nur mit Grund und nie durch Bots, Stunden nur mit Betrag, ohne Firma nie", async () => {
    await expect(reservieren(deal, { pdfBetragCent: 95000 })).rejects.toMatchObject({ code: "RECHNUNG_WEICHT_AB" });
    await expect(reservieren(deal, { pdfBetragCent: 95000, durchAgent: true, eingabe: { abweichungGrund: "Mehr Möbel vor Ort" } })).rejects.toMatchObject({ code: "NUR_MENSCH" });
    const mitGrund = await reservieren(deal, { pdfBetragCent: 95000, eingabe: { abweichungGrund: "Mehr Möbel vor Ort" } });
    expect(mitGrund).toMatchObject({ bruttoCent: 95000, abweichungGrund: "Mehr Möbel vor Ort" });
    await expect(reservieren(deal)).rejects.toMatchObject({ code: "AKTIVE_RECHNUNG" });

    const stunden = await neuerDeal({ stunden: true, festpreis: null });
    await expect(reservieren(stunden, { pdfBetragCent: null })).rejects.toMatchObject({ code: "STUNDEN_BETRAG_FEHLT" });
    await expect(reservieren(stunden, { pdfBetragCent: null, durchAgent: true, eingabe: { bruttoCent: 50000 } })).rejects.toMatchObject({ code: "NUR_MENSCH" });
    expect(await reservieren(stunden, { pdfBetragCent: null, eingabe: { bruttoCent: 50000 } })).toMatchObject({ bruttoCent: 50000 });

    await expect(reservieren(await neuerDeal({ ohneFirma: true }))).rejects.toMatchObject({ code: "FIRMA_FEHLT" });
  });

  it("gleichzeitig: zwei Deals zwei Nummern, derselbe Deal genau eine aktive Rechnung", async () => {
    const { angebotSperren } = await import("./quotations");
    const d2 = await neuerDeal({ annahmeCent: 90000 });
    const [x, y] = await Promise.all([reservieren(deal), reservieren(d2)]);
    expect(new Set([x.nummer, y.nummer]).size).toBe(2);

    const d3 = await neuerDeal({ annahmeCent: 90000 });
    const versuch = () =>
      db.transaction(async (tx) => {
        await angebotSperren(tx, d3);
        return r.rechnungPruefenUndReservieren(tx, { ws, deal: d3, herkunft: "crm", pdfBetragCent: 90000, eingabe: null, durchAgent: false, userId: "u1", jetzt });
      });
    const ergebnisse = await Promise.allSettled([versuch(), versuch()]);
    expect(ergebnisse.filter((e) => e.status === "fulfilled")).toHaveLength(1);
    const abgelehnt = ergebnisse.find((e) => e.status === "rejected") as PromiseRejectedResult;
    expect(abgelehnt.reason).toMatchObject({ code: "AKTIVE_RECHNUNG" });
    const [{ n }] = await sql`select count(*)::int as n from deal_invoices where deal_record_id = ${d3} and status in ('entwurf','gestellt')`;
    expect(n).toBe(1);
  });

  it("Upload ohne Nummer, Betrag aus der Annahme; Storno blendet im Portal aus, zweites Storno 409", async () => {
    const { document, rechnung } = await r.rechnungHochladen(
      { workspaceId: ws, dealRecordId: deal, documentType: "invoice", fileName: "RE.pdf", fileSize: 9, mimeType: "application/pdf", fileContent: Buffer.from("%PDF-1.4\n").toString("base64") },
      { bruttoCent: null, abweichungGrund: null, faelligAm: null, durchAgent: false, userId: "u1", jetzt }
    );
    expect(rechnung).toMatchObject({ herkunft: "upload", nummer: null, bruttoCent: 90000, status: "gestellt", dealDocumentId: document.id });
    expect((await r.aktiveRechnung(ws, deal))?.status).toBe("gestellt");
    expect((await r.stornierteRechnungsDokumente(deal)).size).toBe(0);

    await expect(r.rechnungStornieren(ws, deal, rechnung.id, "kurz", "u1")).rejects.toMatchObject({ code: "GRUND_FEHLT" });
    const storno = await r.rechnungStornieren(ws, deal, rechnung.id, "Falscher Betrag gedruckt", "u1");
    expect(storno).toMatchObject({ status: "storniert", stornoGrund: "Falscher Betrag gedruckt", storniertVon: "u1" });
    expect(await r.aktiveRechnung(ws, deal)).toBeNull();
    expect((await r.stornierteRechnungsDokumente(deal)).has(document.id)).toBe(true);
    await expect(r.rechnungStornieren(ws, deal, rechnung.id, "Noch einmal bitte", "u1")).rejects.toMatchObject({ code: "SCHON_STORNIERT" });
    // Danach ist eine neue Rechnung möglich.
    expect((await reservieren(deal)).status).toBe("entwurf");
  });

  it("Storno stoppt offene Erinnerungen und nur deren Entwurf", async () => {
    const zeile = await reservieren(deal);
    await sql`update deal_invoices set status = 'gestellt' where id = ${zeile.id}`;
    await sql`insert into payment_reminders (id, workspace_id, deal_record_id, invoice_id, stufe, faellig_am, rest_cent, status, draft_id)
      values (${randomUUID()}, ${ws}, ${deal}, ${zeile.id}, 1, '2026-11-21', 90000, 'entwurf', 'kein-entwurf')`;
    await r.rechnungStornieren(ws, deal, zeile.id, "Kunde hat storniert", "u1");
    const [rem] = await sql`select status, stopp_grund from payment_reminders where invoice_id = ${zeile.id}`;
    expect(rem).toMatchObject({ status: "gestoppt", stopp_grund: "rechnung_storniert" });
  });

  it("CRM-Renderer: Nummer im PDF und Dateinamen, Datensatz gestellt; Renderfehler rollt alles zurück", async () => {
    stand.renderFehler = true;
    await expect(docs.storeCommercialDocument({ workspaceId: ws, dealRecordId: deal, kind: "RE", now: jetzt })).rejects.toThrow("Render kaputt");
    expect(await r.aktiveRechnung(ws, deal)).toBeNull();
    const [{ n: ohne }] = await sql`select count(*)::int as n from deal_documents where deal_record_id = ${deal}`;
    expect(ohne).toBe(0);
    const [zaehler] = await sql`select last_number from beleg_number_counters where operating_company_id = ${firma} and kind = 'invoice' and year = 2026`;

    stand.renderFehler = false;
    const gespeichert = await docs.storeCommercialDocument({ workspaceId: ws, dealRecordId: deal, kind: "RE", now: jetzt });
    expect(gespeichert.rechnung?.laufnummer).toBe(zaehler.last_number + 1);
    expect(gespeichert.fileName).toBe(`${gespeichert.rechnung!.nummer}-ceylan.pdf`);
    expect(gespeichert.rechnungFaelligAm).toBe("2026-11-21");
    const aktiv = await r.aktiveRechnung(ws, deal);
    expect(aktiv).toMatchObject({ status: "gestellt", herkunft: "crm", bruttoCent: 90000, dealDocumentId: gespeichert.document.id });
  });

  it("CRM-Renderer: abweichendes Angebot ohne Grund wird nicht gespeichert, Stunden-KV mit Betrag als eine Zeile", async () => {
    await sql`update quotations set fixed_price = '950.00' where deal_record_id = ${deal}`;
    await sql`update quotation_line_items set unit_rate = '950.00' where quotation_id = (select id from quotations where deal_record_id = ${deal})`;
    await expect(docs.storeCommercialDocument({ workspaceId: ws, dealRecordId: deal, kind: "RE", now: jetzt })).rejects.toMatchObject({ code: "RECHNUNG_WEICHT_AB" });
    expect(await r.aktiveRechnung(ws, deal)).toBeNull();
    const mitGrund = await docs.storeCommercialDocument({
      workspaceId: ws,
      dealRecordId: deal,
      kind: "RE",
      now: jetzt,
      rechnung: { abweichungGrund: "Zusätzlicher Schrank" },
    });
    expect(mitGrund.rechnung).toMatchObject({ bruttoCent: 95000, abweichungGrund: "Zusätzlicher Schrank" });

    const stunden = await neuerDeal({ stunden: true, festpreis: null });
    stand.deal = stunden;
    await expect(docs.storeCommercialDocument({ workspaceId: ws, dealRecordId: stunden, kind: "RE", now: jetzt })).rejects.toMatchObject({ code: "STUNDEN_BETRAG_FEHLT" });
    const st = await docs.storeCommercialDocument({ workspaceId: ws, dealRecordId: stunden, kind: "RE", now: jetzt, rechnung: { bruttoCent: 61250 } });
    expect(st.rechnung).toMatchObject({ bruttoCent: 61250, status: "gestellt" });
    await expect(
      docs.storeCommercialDocument({ workspaceId: ws, dealRecordId: stunden, kind: "RE", now: jetzt, rechnung: { bruttoCent: 61250 } })
    ).rejects.toMatchObject({ code: "AKTIVE_RECHNUNG" });
  });

  it("Vorschlag: Annahme, Abweichung, Fälligkeit, Sperrgrund", async () => {
    await sql`update quotations set fixed_price = '950.00' where deal_record_id = ${deal}`;
    const v = await r.rechnungsVorschlag(ws, deal, jetzt);
    expect(v).toMatchObject({ istStunden: false, annahmeCent: 90000, pdfBetragCent: 95000, abweichung: true, faelligAm: "2026-11-21", sperrgrund: null });
    const ohne = await r.rechnungsVorschlag(ws, await neuerDeal({ ohneFirma: true }), jetzt);
    expect(ohne.sperrgrund).toBe("FIRMA_FEHLT");
  });

  it("VPS-Job: Ablage stellt die Rechnung, Fehler und Ablauf verwerfen sie (Nummer bleibt)", async () => {
    const ablage = await import("./kv-job-ablage");
    const jobs = await import("./render-jobs");
    const neu = async (d: string) => {
      const z = await reservieren(d, { herkunft: "vps" });
      const job = `job-${randomUUID()}`;
      await jobs.jobAnlegen({ vpsJobId: job, workspaceId: ws, dealRecordId: d, documentType: "invoice", calculationVersionId: null, priceCents: z.bruttoCent, createdBy: "u1", invoiceId: z.id });
      const res = await jobs.jobReservieren(ws, job, new Date());
      return { z, job: { ...res!, claimedAt: res!.claimedAt! } };
    };
    const a = await neu(deal);
    expect(a.job.invoiceId).toBe(a.z.id);
    const erg = await ablage.ablegenUnterSperre(a.job, {
      fileName: "RE.pdf",
      mimeType: "application/pdf",
      fileSize: 9,
      fileContent: Buffer.from("%PDF-1.4\n").toString("base64"),
      documentType: "invoice",
    });
    expect(erg.art).toBe("abgelegt");
    expect(await r.aktiveRechnung(ws, deal)).toMatchObject({ status: "gestellt", nummer: a.z.nummer });

    const d2 = await neuerDeal({ annahmeCent: 90000 });
    const b = await neu(d2);
    await ablage.abschliessenMitAnspruch(ws, b.job.vpsJobId, b.job.claimedAt, { status: "fehler", fehler: "Skill-Fehler" });
    const [vb] = await sql`select status, verworfen_grund, nummer from deal_invoices where id = ${b.z.id}`;
    expect(vb).toMatchObject({ status: "verworfen", verworfen_grund: "Skill-Fehler", nummer: b.z.nummer });

    const d3 = await neuerDeal({ annahmeCent: 90000 });
    const c = await neu(d3);
    await sql`update document_render_jobs set created_at = now() - interval '2 days' where vps_job_id = ${c.job.vpsJobId}`;
    await jobs.jobsAbgelaufenMarkieren(new Date());
    const [vc] = await sql`select status from deal_invoices where id = ${c.z.id}`;
    expect(vc.status).toBe("verworfen");
    expect(await r.aktiveRechnung(ws, d3)).toBeNull();
  });

  it("DELETE eines Rechnungs-PDFs: gestellt und storniert 409, ohne Datensatz wie bisher", async () => {
    const { DELETE } = await import("@/app/api/v1/deals/[recordId]/documents/[documentId]/route");
    const { NextRequest } = await import("next/server");
    const loeschen = (d: string, id: string) =>
      DELETE(new NextRequest(`https://crm.test/api/v1/deals/${d}/documents/${id}`, { method: "DELETE" }), {
        params: Promise.resolve({ recordId: d, documentId: id }),
      });
    const { document, rechnung } = await r.rechnungHochladen(
      { workspaceId: ws, dealRecordId: deal, documentType: "invoice", fileName: "RE.pdf", fileSize: 9, mimeType: "application/pdf", fileContent: Buffer.from("%PDF-1.4\n").toString("base64") },
      { bruttoCent: null, abweichungGrund: null, faelligAm: null, durchAgent: false, userId: "u1", jetzt }
    );
    const gestellt = await loeschen(deal, document.id);
    expect(gestellt.status).toBe(409);
    expect((await gestellt.json()).code).toBe("NUR_STORNO");
    await r.rechnungStornieren(ws, deal, rechnung.id, "Falscher Kunde drauf", "u1");
    expect((await loeschen(deal, document.id)).status).toBe(409);

    const alt = randomUUID();
    await sql`insert into deal_documents (id, workspace_id, deal_record_id, document_type, file_name, file_size, mime_type, file_content)
      values (${alt}, ${ws}, ${deal}, 'invoice', 'alt.pdf', 1, 'application/pdf', 'eA==')`;
    expect((await loeschen(deal, alt)).status).toBe(200);
  });
});
