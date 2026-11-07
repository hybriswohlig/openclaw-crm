import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RENDER_JOB_ABLAUF_MS, RENDER_JOB_RESERVIERUNG_MS } from "@/lib/angebot-wahl";

/**
 * Job-Register gegen eine echte Postgres-Datenbank.
 * Läuft nur mit RENDER_JOBS_TEST_DATABASE_URL: Wegwerf-DB mit Schema inkl.
 * Migration 0060. Nie gegen Neon. Der Test leert `document_render_jobs`,
 * weil offeneJobs und jobsAbgelaufenMarkieren über alle Workspaces lesen.
 */
const url = process.env.RENDER_JOBS_TEST_DATABASE_URL;

describe.skipIf(!url)("Render-Jobs (DB)", () => {
  let sql: postgres.Sql;
  let svc: typeof import("./render-jobs");
  const ws = randomUUID();
  const ws2 = randomUUID();
  const obj = randomUUID();
  const obj2 = randomUUID();
  const deal = randomUUID();
  const deal2 = randomUUID();
  const v1 = randomUUID();
  const v2 = randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    sql = postgres(url!, { max: 1 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Test', ${`t-${ws}`})`;
    await sql`insert into workspaces (id, name, slug) values (${ws2}, 'Fremd', ${`t-${ws2}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${obj}, ${ws}, 'deals', 'Deal', 'Deals')`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${obj2}, ${ws2}, 'deals', 'Deal', 'Deals')`;
    await sql`insert into records (id, object_id) values (${deal}, ${obj})`;
    await sql`insert into records (id, object_id) values (${deal2}, ${obj2})`;
    await sql`insert into deal_calculation_versions (id, workspace_id, deal_record_id, version, status, reference_date)
      values (${v1}, ${ws}, ${deal}, 1, 'gesperrt', '2026-11-07')`;
    await sql`insert into deal_calculation_versions (id, workspace_id, deal_record_id, version, status, reference_date)
      values (${v2}, ${ws}, ${deal}, 2, 'gesperrt', '2026-11-07')`;
    // drizzle-kit push bildet check() aus text(enum) nicht ab. Die Migration
    // 0060 hat den CHECK. Fehlt er in der Wegwerf-DB, hier nachziehen.
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from pg_constraint where conname = 'document_render_jobs_status_check'`;
    if (n === 0) {
      await sql.unsafe(
        `alter table document_render_jobs add constraint document_render_jobs_status_check check (status in ('laeuft', 'abgelegt', 'verworfen', 'fehler'))`,
      );
    }
    svc = await import("./render-jobs");
  });

  beforeEach(async () => {
    await sql`delete from document_render_jobs`;
  });

  afterAll(async () => {
    await sql`delete from document_render_jobs`;
    await sql`delete from workspaces where id in (${ws}, ${ws2})`;
    await sql.end();
  });

  async function anlegen(teil: Partial<{
    vpsJobId: string;
    workspaceId: string;
    dealRecordId: string;
    documentType: string;
    calculationVersionId: string | null;
    priceCents: number | null;
    createdBy: string | null;
  }> = {}) {
    const vpsJobId = teil.vpsJobId ?? randomUUID();
    await svc.jobAnlegen({
      vpsJobId,
      workspaceId: teil.workspaceId ?? ws,
      dealRecordId: teil.dealRecordId ?? deal,
      documentType: teil.documentType ?? "quotation",
      calculationVersionId: "calculationVersionId" in teil ? teil.calculationVersionId ?? null : v1,
      priceCents: "priceCents" in teil ? teil.priceCents ?? null : 19900,
      createdBy: teil.createdBy ?? null,
    });
    return vpsJobId;
  }

  async function zeiten(id: string, createdAt: Date, claimedAt: Date | null = null) {
    await sql`update document_render_jobs set created_at = ${createdAt}, claimed_at = ${claimedAt} where vps_job_id = ${id}`;
  }

  it("legt an, lädt und lässt einen zweiten Insert unverändert", async () => {
    const id = await anlegen({ priceCents: 1500, createdBy: "user-1" });
    await svc.jobAnlegen({
      vpsJobId: id,
      workspaceId: ws,
      dealRecordId: deal,
      documentType: "invoice",
      calculationVersionId: v2,
      priceCents: 1,
      createdBy: "andere",
    });
    const job = await svc.jobLaden(ws, id);
    expect(job).toMatchObject({
      vpsJobId: id,
      workspaceId: ws,
      dealRecordId: deal,
      documentType: "quotation",
      calculationVersionId: v1,
      priceCents: 1500,
      status: "laeuft",
      createdBy: "user-1",
      claimedAt: null,
      storedAt: null,
      dealDocumentId: null,
      fehler: null,
    });
    expect(job?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it("fremder Workspace sieht den Job nicht und reserviert ihn nicht", async () => {
    const id = await anlegen();
    expect(await svc.jobLaden(ws2, id)).toBeNull();
    expect(await svc.jobReservieren(ws2, id, new Date("2026-11-07T10:00:00.000Z"))).toBeNull();
    expect((await svc.jobLaden(ws, id))?.claimedAt).toBeNull();
  });

  it("zwei gleichzeitige Reservierungen: genau eine gewinnt", async () => {
    const id = await anlegen();
    const jetzt = new Date("2026-11-07T10:00:00.000Z");
    const [a, b] = await Promise.all([
      svc.jobReservieren(ws, id, jetzt),
      svc.jobReservieren(ws, id, jetzt),
    ]);
    const gewinner = [a, b].filter((job) => job !== null);
    expect(gewinner).toHaveLength(1);
    expect(gewinner[0]?.claimedAt).toBe(jetzt.toISOString());
    expect((await svc.jobLaden(ws, id))?.claimedAt).toBe(jetzt.toISOString());
  });

  it("reserviert nach zwei Minuten neu, bei genau zwei Minuten nicht", async () => {
    const id = await anlegen();
    const start = new Date("2026-11-07T10:00:00.000Z");
    expect(await svc.jobReservieren(ws, id, start)).not.toBeNull();

    const genau = new Date(start.getTime() + RENDER_JOB_RESERVIERUNG_MS);
    expect(await svc.jobReservieren(ws, id, genau)).toBeNull();
    expect((await svc.jobLaden(ws, id))?.claimedAt).toBe(start.toISOString());

    const danach = new Date(start.getTime() + RENDER_JOB_RESERVIERUNG_MS + 1);
    const neu = await svc.jobReservieren(ws, id, danach);
    expect(neu?.claimedAt).toBe(danach.toISOString());
  });

  it("schließt ab: abgelegt mit stored_at, verworfen und fehler ohne, fremder Workspace ändert nichts", async () => {
    const abgelegt = await anlegen();
    const verworfen = await anlegen();
    const fehler = await anlegen();
    const doc = randomUUID();
    await sql`insert into deal_documents (id, workspace_id, deal_record_id, document_type, file_name, file_size, mime_type, file_content)
      values (${doc}, ${ws}, ${deal}, 'quotation', 'kv.pdf', 4, 'application/pdf', 'QQ==')`;

    await svc.jobAbschliessen(ws2, abgelegt, { status: "fehler", fehler: "fremd" });
    expect((await svc.jobLaden(ws, abgelegt))?.status).toBe("laeuft");

    await svc.jobAbschliessen(ws, abgelegt, { status: "abgelegt", dealDocumentId: doc });
    const fertig = await svc.jobLaden(ws, abgelegt);
    expect(fertig).toMatchObject({ status: "abgelegt", dealDocumentId: doc, fehler: null });
    expect(fertig?.storedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);

    await svc.jobAbschliessen(ws, verworfen, { status: "verworfen" });
    expect(await svc.jobLaden(ws, verworfen)).toMatchObject({ status: "verworfen", storedAt: null, fehler: null, dealDocumentId: null });

    await svc.jobAbschliessen(ws, fehler, { status: "fehler", fehler: "vps" });
    expect(await svc.jobLaden(ws, fehler)).toMatchObject({ status: "fehler", fehler: "vps", storedAt: null });
  });

  it("offeneJobs liefert laufende Jobs über Workspaces, älteste zuerst, ohne frische Reservierung", async () => {
    const grenze = new Date("2026-11-07T12:00:00.000Z");
    const a = await anlegen({ calculationVersionId: null });
    const b = await anlegen({ workspaceId: ws2, dealRecordId: deal2, calculationVersionId: null });
    const frisch = await anlegen({ calculationVersionId: null });
    const zu = await anlegen({ calculationVersionId: null });
    await zeiten(a, new Date("2026-11-07T09:00:00.000Z"));
    await zeiten(b, new Date("2026-11-07T10:00:00.000Z"), new Date("2026-11-07T11:00:00.000Z"));
    await zeiten(frisch, new Date("2026-11-07T08:00:00.000Z"), grenze);
    await zeiten(zu, new Date("2026-11-07T07:00:00.000Z"));
    await svc.jobAbschliessen(ws, zu, { status: "verworfen" });

    const liste = await svc.offeneJobs(grenze, 10);
    expect(liste.map((job) => job.vpsJobId)).toEqual([a, b]);
    expect(liste.map((job) => job.workspaceId)).toEqual([ws, ws2]);
    expect((await svc.offeneJobs(grenze, 1)).map((job) => job.vpsJobId)).toEqual([a]);
  });

  it("jobsAbgelaufenMarkieren setzt nur laufende Jobs älter als 24 Stunden auf fehler", async () => {
    const jetzt = new Date("2026-11-07T12:00:00.000Z");
    const alt = await anlegen();
    const grenze = await anlegen();
    const jung = await anlegen();
    const erledigt = await anlegen();
    await zeiten(alt, new Date(jetzt.getTime() - RENDER_JOB_ABLAUF_MS - 1));
    await zeiten(grenze, new Date(jetzt.getTime() - RENDER_JOB_ABLAUF_MS));
    await zeiten(jung, new Date(jetzt.getTime() - 60_000));
    await zeiten(erledigt, new Date(jetzt.getTime() - RENDER_JOB_ABLAUF_MS - 5_000));
    await svc.jobAbschliessen(ws, erledigt, { status: "abgelegt" });

    expect(await svc.jobsAbgelaufenMarkieren(jetzt)).toBe(1);
    expect(await svc.jobLaden(ws, alt)).toMatchObject({ status: "fehler", fehler: "abgelaufen" });
    expect((await svc.jobLaden(ws, grenze))?.status).toBe("laeuft");
    expect((await svc.jobLaden(ws, jung))?.status).toBe("laeuft");
    expect((await svc.jobLaden(ws, erledigt))?.status).toBe("abgelegt");
  });

  it("letzterKvJob nimmt den neuesten KV derselben Version", async () => {
    const alt = await anlegen({ calculationVersionId: v1 });
    const neu = await anlegen({ calculationVersionId: v1 });
    const andereVersion = await anlegen({ calculationVersionId: v2 });
    const rechnung = await anlegen({ calculationVersionId: v1, documentType: "invoice" });
    const fremd = await anlegen({ workspaceId: ws2, dealRecordId: deal2, calculationVersionId: null });
    await zeiten(alt, new Date("2026-11-01T08:00:00.000Z"));
    await zeiten(neu, new Date("2026-11-03T08:00:00.000Z"));
    await zeiten(andereVersion, new Date("2026-11-04T08:00:00.000Z"));
    await zeiten(rechnung, new Date("2026-11-05T08:00:00.000Z"));
    await zeiten(fremd, new Date("2026-11-06T08:00:00.000Z"));

    expect((await svc.letzterKvJob(ws, deal, v1))?.vpsJobId).toBe(neu);
    expect(await svc.letzterKvJob(ws, deal, v2)).toMatchObject({ vpsJobId: andereVersion });
    expect(await svc.letzterKvJob(ws2, deal, v1)).toBeNull();
    expect(await svc.letzterKvJob(ws, deal2, v1)).toBeNull();
  });

  it("CHECK lehnt einen unbekannten Status ab, ein fremder Deal die FK", async () => {
    const id = randomUUID();
    await expect(sql`insert into document_render_jobs (vps_job_id, workspace_id, deal_record_id, document_type, status)
      values (${id}, ${ws}, ${deal}, 'quotation', 'kaputt')`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`insert into document_render_jobs (vps_job_id, workspace_id, deal_record_id, document_type)
      values (${randomUUID()}, ${ws}, ${randomUUID()}, 'quotation')`).rejects.toMatchObject({ code: "23503" });
  });
});
