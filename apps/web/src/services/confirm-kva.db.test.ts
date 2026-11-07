import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * KV-Annahme gegen eine echte Postgres-Datenbank (Plan 5a, Entscheidungen 3
 * und 4): Annahme und Sperren einer Kalkulationsversion laufen unter derselben
 * Deal-Sperre, das KV-PDF muss zur Version der Quotation passen.
 *
 * Läuft nur mit ANNAHME_TEST_DATABASE_URL: eine Wegwerf-DB mit aktuellem
 * Schema (z. B. Docker postgres:16 plus `drizzle-kit push`, inkl. 0060). Nie
 * gegen eine echte Datenbank, der Test legt Zeilen an und löscht sie wieder.
 *
 * Die Rennen laufen über echte Verbindungen: eine Torverbindung hält die
 * Sperre, bis Annahme und Sperren in der gewünschten Reihenfolge warten;
 * Postgres vergibt die Sperre dann in dieser Reihenfolge.
 */
const url = process.env.ANNAHME_TEST_DATABASE_URL;

vi.mock("./agb", () => ({ ladeAgbHtml: async () => `<h1>AGB</h1>${"Text der AGB. ".repeat(60)}` }));
vi.mock("./activity-events", () => ({ emitEvent: async () => {} }));
vi.mock("./wartet", () => ({ aktualisiereWartet: async () => {}, aktualisiereWartetNachBesuch: async () => {} }));

describe.skipIf(!url)("Annahme unter der Deal-Sperre (DB)", { timeout: 20_000 }, () => {
  let sql: postgres.Sql;
  let portal: typeof import("./customer-portal-data");
  let speicher: typeof import("./kalkulation-versionen-speicher");
  let annahme: typeof import("./kva-annahme");
  const ws = randomUUID();
  const obj = randomUUID();
  const deal = randomUUID();
  const link = randomUUID();
  const token = randomUUID().replace(/-/g, "");
  let v1 = "";
  let v2 = "";

  const body = (expectedTotalCents: number) => ({
    acceptedOffer: true,
    acceptedAgb: true,
    haftungshinweisBestaetigt: false,
    versicherungGewuenscht: false,
    vorzeitigerBeginnVerlangt: false,
    expectedTotalCents,
    fullName: "Anna Muster",
  });
  const ctx = { ipAddress: "203.0.113.5", userAgent: "test" };
  const annehmen = (cent: number) => portal.confirmKvaForToken(token, body(cent), ctx);
  /** Sperrt v2 mit 1.500 € (ein Posten), wie die Kalkulationsseite. */
  const sperren = () =>
    speicher.dbVersionsSpeicher.sperrenUndAngebot(
      ws,
      deal,
      v2,
      {
        lineItems: [{ description: "Küchenmontage", quantity: 1, unitRate: "1500" }],
        validUntil: null,
        calculationAssumptions: null,
        documentDetails: null,
        notes: null,
      } as never,
      [{ type: "other", description: "Küchenmontage", quantity: 1, unitRate: 1500 }] as never,
      "user-1"
    );

  const annahmen = async () =>
    sql`select confirmed_total_cents, calculation_version_id, quotation_document_id from kva_confirmations where deal_record_id = ${deal}`;
  const quotation = async () =>
    (await sql`select fixed_price, calculation_version_id from quotations where deal_record_id = ${deal}`)[0];
  const kvPdf = async (versionId: string | null, alterSekunden = 0) => {
    const id = randomUUID();
    await sql`insert into deal_documents (id, workspace_id, deal_record_id, document_type, file_name, file_size, mime_type, file_content, calculation_version_id, uploaded_at)
      values (${id}, ${ws}, ${deal}, 'quotation', 'KV.pdf', 10, 'application/pdf', ${Buffer.from(`%PDF ${id}`).toString("base64")}, ${versionId}, now() - make_interval(secs => ${alterSekunden}))`;
    return id;
  };

  /** Hält die Deal-Sperre, bis `frei()` aufgerufen wird. */
  async function tor() {
    let frei!: () => void;
    const offen = new Promise<void>((r) => (frei = r));
    let gehalten!: () => void;
    const haelt = new Promise<void>((r) => (gehalten = r));
    const fertig = sql.begin(async (t) => {
      await t.unsafe("select pg_advisory_xact_lock(hashtext('angebot:' || $1::text))", [deal]);
      gehalten();
      await offen;
    });
    await haelt;
    return { frei: async () => (frei(), await fertig) };
  }
  /**
   * `erst` und `dann` warten in dieser Reihenfolge auf die Deal-Sperre, die
   * das Tor hält; danach gibt das Tor frei. Wartet einer nicht (Sperre fehlt),
   * scheitert der Test, statt hängen zu bleiben.
   */
  async function rennen<A, B>(erst: () => Promise<A>, dann: () => Promise<B>) {
    const t = await tor();
    const laeufe: Promise<unknown>[] = [];
    try {
      laeufe.push(erst());
      await wartende(1);
      laeufe.push(dann());
      await wartende(2);
    } finally {
      await t.frei();
    }
    return Promise.allSettled(laeufe) as Promise<[PromiseSettledResult<Awaited<A>>, PromiseSettledResult<Awaited<B>>]>;
  }

  /** Wartet, bis so viele Verbindungen auf eine Advisory-Sperre warten. */
  async function wartende(n: number) {
    for (let i = 0; i < 200; i++) {
      const [{ c }] = await sql`select count(*)::int as c from pg_locks where locktype = 'advisory' and not granted`;
      if (c >= n) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`nicht ${n} Wartende`);
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    sql = postgres(url!, { max: 3 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Test', ${`t-${ws}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${obj}, ${ws}, 'deals', 'Deal', 'Deals')`;
    await sql`insert into records (id, object_id) values (${deal}, ${obj})`;
    await sql`insert into customer_status_links (id, workspace_id, deal_record_id, token) values (${link}, ${ws}, ${deal}, ${token})`;
    portal = await import("./customer-portal-data");
    speicher = await import("./kalkulation-versionen-speicher");
    annahme = await import("./kva-annahme");
  });

  beforeEach(async () => {
    await sql`delete from kva_confirmations where deal_record_id = ${deal}`;
    await sql`delete from deal_documents where deal_record_id = ${deal}`;
    await sql`delete from quotations where deal_record_id = ${deal}`;
    await sql`delete from deal_calculation_versions where deal_record_id = ${deal}`;
    v1 = randomUUID();
    v2 = randomUUID();
    // v1 gesperrt (1.000 €), v2 als Entwurf. Küchenmontage: kein Termin nötig.
    await sql`insert into deal_calculation_versions (id, workspace_id, deal_record_id, version, status, reference_date, price_cents)
      values (${v1}, ${ws}, ${deal}, 1, 'gesperrt', '2026-12-01', 100000), (${v2}, ${ws}, ${deal}, 2, 'entwurf', '2026-12-01', null)`;
    await sql`insert into quotations (id, deal_record_id, fixed_price, is_variable, service_type, calculation_version_id)
      values (${randomUUID()}, ${deal}, '1000.00', false, 'kitchen_installation', ${v1})`;
  });

  afterAll(async () => {
    await sql`delete from workspaces where id = ${ws}`;
    await sql.end();
  });

  it("ohne Rennen: Annahme bindet Preis, PDF und Version der Quotation", async () => {
    const pdf = await kvPdf(v1);
    const r = await annehmen(100000);
    expect(r.ok).toBe(true);
    expect(await annahmen()).toEqual([{ confirmed_total_cents: 100000, calculation_version_id: v1, quotation_document_id: pdf }]);
  });

  it("Sperren zuerst: die Annahme sieht den neuen Preis → price_changed, nichts angenommen", async () => {
    await kvPdf(v1);
    const [sr, ar] = await rennen(sperren, () => annehmen(100000));
    expect(sr.status).toBe("fulfilled");
    expect(ar).toEqual({ status: "fulfilled", value: { ok: false, reason: "price_changed" } });
    expect(await annahmen()).toEqual([]);
    expect(await quotation()).toEqual({ fixed_price: "1500.00", calculation_version_id: v2 });
  });

  it("Annahme zuerst: das Sperren endet mit KVA_ACCEPTED, Annahme und Quotation bleiben bei 1.000 €", async () => {
    await kvPdf(v1);
    const [ar, sr] = await rennen(() => annehmen(100000), sperren);
    expect(ar.status === "fulfilled" && ar.value.ok).toBe(true);
    expect(sr.status).toBe("rejected");
    expect((sr as PromiseRejectedResult).reason).toBeInstanceOf(annahme.AngebotAngenommenError);
    expect((sr as PromiseRejectedResult).reason.code).toBe("KVA_ACCEPTED");
    const zeilen = await annahmen();
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]).toMatchObject({ confirmed_total_cents: 100000, calculation_version_id: v1 });
    expect(await quotation()).toEqual({ fixed_price: "1000.00", calculation_version_id: v1 });
    const [{ status }] = await sql`select status from deal_calculation_versions where id = ${v2}`;
    expect(status).toBe("entwurf");
  });

  it("Doppelklick gleichzeitig: beide ok, genau eine Annahme, kein Deadlock", async () => {
    await kvPdf(v1);
    const [ar, br] = await rennen(() => annehmen(100000), () => annehmen(100000));
    expect(ar).toMatchObject({ status: "fulfilled", value: { ok: true } });
    expect(br).toMatchObject({ status: "fulfilled", value: { ok: true } });
    expect(await annahmen()).toHaveLength(1);
    // Dritter Klick danach: weiter ok, keine zweite Zeile.
    expect((await annehmen(100000)).ok).toBe(true);
    expect(await annahmen()).toHaveLength(1);
  });

  it("kv_veraltet: Quotation mit Version, neuestes PDF aus der alten Version", async () => {
    await kvPdf(v1);
    await sperren();
    expect(await annehmen(150000)).toEqual({ ok: false, reason: "kv_veraltet" });
    expect(await annahmen()).toEqual([]);

    // Kontext: kein veraltetes PDF, Stand für Dialog und Stufe 1.
    const c = await portal.loadContextByToken(token);
    expect(c?.annahmeRecht.kvStand).toBe("veraltet");
    expect(c?.documents.quotationUrl).toBeNull();
    expect(c?.kva?.totalCents).toBe(150000);

    // Das PDF der neuen Version ist da: Annahme geht und bindet genau dieses.
    const pdf2 = await kvPdf(v2);
    const c2 = await portal.loadContextByToken(token);
    expect(c2?.annahmeRecht.kvStand).toBe("passt");
    expect(c2?.documents.quotationUrl).toBe(`/api/public/${token}/documents/${pdf2}`);
    expect((await annehmen(150000)).ok).toBe(true);
    expect(await annahmen()).toEqual([{ confirmed_total_cents: 150000, calculation_version_id: v2, quotation_document_id: pdf2 }]);
  });

  it("kv_veraltet auch ohne jedes PDF, wenn die Quotation eine Version trägt", async () => {
    expect(await annehmen(100000)).toEqual({ ok: false, reason: "kv_veraltet" });
  });

  it("neuestes PDF ohne Version, Quotation mit Version: veraltet", async () => {
    await kvPdf(v1, 60);
    await kvPdf(null);
    expect(await annehmen(100000)).toEqual({ ok: false, reason: "kv_veraltet" });
  });

  it("Altbestand: Quotation ohne Version, Annahme wie bisher mit jedem PDF oder ohne", async () => {
    await sql`update quotations set calculation_version_id = null where deal_record_id = ${deal}`;
    const c = await portal.loadContextByToken(token);
    expect(c?.annahmeRecht.kvStand).toBe("ohne_version");
    const pdf = await kvPdf(v1);
    expect((await annehmen(100000)).ok).toBe(true);
    expect(await annahmen()).toEqual([{ confirmed_total_cents: 100000, calculation_version_id: null, quotation_document_id: pdf }]);
  });

  it("Altbestand ohne PDF: Annahme ohne gebundenes Dokument", async () => {
    await sql`update quotations set calculation_version_id = null where deal_record_id = ${deal}`;
    expect((await annehmen(100000)).ok).toBe(true);
    expect(await annahmen()).toEqual([{ confirmed_total_cents: 100000, calculation_version_id: null, quotation_document_id: null }]);
  });

  it("aktivBedingung mit Workspace: fremder Workspace sieht die Annahme nicht", async () => {
    await kvPdf(v1);
    expect((await annehmen(100000)).ok).toBe(true);
    const { db } = await import("@/db");
    const { kvaConfirmations } = await import("@/db/schema/customer-portal");
    const eigene = await db.select({ id: kvaConfirmations.id }).from(kvaConfirmations).where(annahme.aktivBedingung(deal, ws));
    const fremde = await db.select({ id: kvaConfirmations.id }).from(kvaConfirmations).where(annahme.aktivBedingung(deal, randomUUID()));
    expect(eigene).toHaveLength(1);
    expect(fremde).toHaveLength(0);
  });
});
