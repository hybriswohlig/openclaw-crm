import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RENDER_JOB_RESERVIERUNG_MS, type RenderJob } from "@/lib/angebot-wahl";

/**
 * Ablage unter Deal-Sperre gegen eine echte Postgres-Datenbank (Fix-Welle 5a,
 * Funde 2 und 3). Läuft nur mit KV_ABLAGE_TEST_DATABASE_URL (Wegwerf-DB mit
 * Schema inkl. 0060, nie Neon). Eigene Datenbank empfohlen: der Test leert
 * `document_render_jobs` seiner Deals.
 */
const url = process.env.KV_ABLAGE_TEST_DATABASE_URL;

// Nachläufe gehen ins Netz und sind hier nicht Gegenstand.
vi.mock("./customer-portal-notifications", () => ({ maybeNotifyPortalEvent: async () => {} }));
vi.mock("./wartet", () => ({ aktualisiereWartet: async () => {} }));

const pdf = {
  fileName: "KV-KO-20261107-TEST.pdf",
  mimeType: "application/pdf",
  fileSize: 9,
  fileContent: Buffer.from("%PDF-1.7\n").toString("base64"),
  documentType: "quotation" as const,
};

describe.skipIf(!url)("kv-job-ablage (DB)", () => {
  let sql: postgres.Sql;
  let ablage: typeof import("./kv-job-ablage");
  let jobs: typeof import("./render-jobs");
  const ws = randomUUID();
  const obj = randomUUID();
  const deal = randomUUID();
  const v1 = randomUUID();
  const v2 = randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    sql = postgres(url!, { max: 3 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Ablage', ${`t-${ws}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${obj}, ${ws}, 'deals', 'Deal', 'Deals')`;
    await sql`insert into records (id, object_id) values (${deal}, ${obj})`;
    for (const [id, nr] of [[v1, 1], [v2, 2]] as const) {
      await sql`insert into deal_calculation_versions (id, workspace_id, deal_record_id, version, status, reference_date)
        values (${id}, ${ws}, ${deal}, ${nr}, 'gesperrt', '2026-11-07')`;
    }
    await sql`insert into quotations (id, deal_record_id, fixed_price, calculation_version_id) values (${randomUUID()}, ${deal}, 1720, ${v1})`;
    ablage = await import("./kv-job-ablage");
    jobs = await import("./render-jobs");
  });

  beforeEach(async () => {
    await sql`delete from document_render_jobs where deal_record_id = ${deal}`;
    await sql`delete from deal_documents where deal_record_id = ${deal}`;
    await sql`update quotations set calculation_version_id = ${v1} where deal_record_id = ${deal}`;
  });

  afterAll(async () => {
    await sql`delete from workspaces where id = ${ws}`;
    await sql.end();
  });

  async function reserviert(jetzt: Date, teil: Partial<RenderJob> = {}) {
    const vpsJobId = teil.vpsJobId ?? randomUUID();
    await jobs.jobAnlegen({
      vpsJobId,
      workspaceId: ws,
      dealRecordId: deal,
      documentType: "quotation",
      calculationVersionId: v1,
      priceCents: 172000,
      createdBy: null,
      ...teil,
    });
    const j = await jobs.jobReservieren(ws, vpsJobId, jetzt);
    return { ...j!, claimedAt: j!.claimedAt! };
  }

  const dokumente = async () =>
    (await sql<{ n: number }[]>`select count(*)::int as n from deal_documents where deal_record_id = ${deal}`)[0].n;

  it("legt mit Version ab und schließt den Job in derselben Transaktion ab", async () => {
    const job = await reserviert(new Date());
    const r = await ablage.ablegenUnterSperre(job, pdf);
    expect(r.art).toBe("abgelegt");
    const [doc] = await sql`select id, calculation_version_id from deal_documents where deal_record_id = ${deal}`;
    expect(doc.calculation_version_id).toBe(v1);
    const nachher = await jobs.jobLaden(ws, job.vpsJobId);
    expect(nachher).toMatchObject({ status: "abgelegt", dealDocumentId: doc.id });
    expect(nachher?.storedAt).not.toBeNull();
  });

  it("zwei Abschlüsse gleichzeitig: genau ein Dokument", async () => {
    const job = await reserviert(new Date());
    const ergebnisse = await Promise.all([ablage.ablegenUnterSperre(job, pdf), ablage.ablegenUnterSperre(job, pdf)]);
    expect(ergebnisse.map((e) => e.art).sort()).toEqual(["abgelegt", "verloren"]);
    expect(await dokumente()).toBe(1);
  });

  it("abgelaufene eigene Reservierung, ein anderer hat neu reserviert: der Alte legt nichts ab", async () => {
    const t0 = new Date(Date.now() - RENDER_JOB_RESERVIERUNG_MS - 60_000);
    const alt = await reserviert(t0);
    const neu = await jobs.jobReservieren(ws, alt.vpsJobId, new Date());
    expect(neu).not.toBeNull();

    // Beide gleichzeitig: nur der Neue legt ab.
    const [a, b] = await Promise.all([
      ablage.ablegenUnterSperre(alt, pdf),
      ablage.ablegenUnterSperre({ ...neu!, claimedAt: neu!.claimedAt! }, pdf),
    ]);
    expect(a.art).toBe("verloren");
    expect(b.art).toBe("abgelegt");
    expect(await dokumente()).toBe(1);

    // Auch Fehler darf der Alte nicht mehr schreiben.
    expect(await ablage.abschliessenMitAnspruch(ws, alt.vpsJobId, alt.claimedAt, { status: "fehler", fehler: "x" })).toBe(false);
    expect((await jobs.jobLaden(ws, alt.vpsJobId))?.status).toBe("abgelegt");
  });

  it("Versionswechsel zwischen Holen und Ablegen: verworfen, nichts abgelegt", async () => {
    const job = await reserviert(new Date());
    await sql`update quotations set calculation_version_id = ${v2} where deal_record_id = ${deal}`;
    expect((await ablage.ablegenUnterSperre(job, pdf)).art).toBe("verworfen");
    expect(await dokumente()).toBe(0);
    expect((await jobs.jobLaden(ws, job.vpsJobId))?.status).toBe("verworfen");
  });

  it("Sperren einer neuen Version läuft gerade: Ablage wartet auf die Sperre und verwirft danach", async () => {
    const job = await reserviert(new Date());
    let freigeben!: () => void;
    const gesperrt = new Promise<void>((ok) => (freigeben = ok));
    let haltSperre!: () => void;
    const sperreGehalten = new Promise<void>((ok) => (haltSperre = ok));

    // Ein „Sperren“ hält die Deal-Sperre und setzt v2, committet erst später.
    const sperren = sql.begin(async (tx) => {
      await tx.unsafe(`select pg_advisory_xact_lock(hashtext('angebot:' || $1::text))`, [deal]);
      await tx.unsafe(`update quotations set calculation_version_id = $1 where deal_record_id = $2`, [v2, deal]);
      haltSperre();
      await gesperrt;
    });
    await sperreGehalten;

    const ablegen = ablage.ablegenUnterSperre(job, pdf);
    // Kurz warten: die Ablage muss an der Sperre hängen, nicht vorbeilaufen.
    await new Promise((ok) => setTimeout(ok, 300));
    expect(await dokumente()).toBe(0);
    freigeben();
    await sperren;

    expect((await ablegen).art).toBe("verworfen");
    expect(await dokumente()).toBe(0);
  });

  it("KV ohne Version (Altbestand): legt ohne Bezug ab, auch nach Versionswechsel", async () => {
    const job = await reserviert(new Date(), { calculationVersionId: null });
    await sql`update quotations set calculation_version_id = ${v2} where deal_record_id = ${deal}`;
    expect((await ablage.ablegenUnterSperre(job, pdf)).art).toBe("abgelegt");
    const [doc] = await sql`select calculation_version_id from deal_documents where deal_record_id = ${deal}`;
    expect(doc.calculation_version_id).toBeNull();
  });
});
