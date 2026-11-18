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
    await sql`delete from kv_staende where deal_record_id = ${deal}`;
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

  describe("KV-Editor: Ablage nach kv_stand_ziel (Spec 7.3)", () => {
    const betraege = { erwartetCent: [116000, 46000, 162000], erlaubtCent: [0] };
    const ok = { ...betraege, preis: "ok" as const, fehlt: [], fremd: [] };
    const abweichung = { ...betraege, preis: "abweichung" as const, fehlt: [46000], fremd: [56000] };
    let nummer = 0;

    async function stand(teil: { quelle?: string; aenderungen?: unknown[]; vorgaenger?: string | null; status?: string; jobId?: string; dokument?: string | null; gepusht?: boolean } = {}) {
      const id = randomUUID();
      await sql`insert into kv_staende (id, workspace_id, deal_record_id, nummer, vorgaenger_id, renderer, calculation_version_id, grundlage,
          aenderungen, quelle, status, render_job_id, deal_document_id, gepusht_am, pruefung)
        values (${id}, ${ws}, ${deal}, ${++nummer}, ${teil.vorgaenger ?? null}, 'vps', ${v1}, ${sql.json({ bildIds: [] })},
          ${sql.json((teil.aenderungen ?? []) as never)}, ${teil.quelle ?? "neu"}, ${teil.status ?? "druckt"}, ${teil.jobId ?? null},
          ${teil.dokument ?? null}, ${teil.gepusht ? sql`now()` : null}, ${sql.json({ ...betraege, preis: "offen", fehlt: [], fremd: [] })})`;
      return id;
    }

    async function mitStand(ziel: "entwurf" | "aktuell", teil: Parameters<typeof stand>[0] = {}) {
      const vpsJobId = randomUUID();
      const standId = await stand({ ...teil, jobId: vpsJobId });
      const job = await reserviert(new Date(), { vpsJobId, kvStandId: standId, kvStandZiel: ziel });
      return { job, standId };
    }

    const standLesen = async (id: string) =>
      (await sql`select status, fehler, file_name, deal_document_id, pruefung from kv_staende where id = ${id}`)[0];
    const AENDERUNG = [{ schluessel: "leistungen:transport:notiz", wert: "x", vorher: "", quelle: "hand", von: "u", am: "2026-11-18T10:00:00Z" }];

    it("Entwurf: PDF und Prüfung nur im Stand, nie in deal_documents; Job abgelegt ohne Dokument", async () => {
      const { job, standId } = await mitStand("entwurf");
      expect(await ablage.ablegenUnterSperre(job, pdf, { pruefung: ok })).toEqual({ art: "entwurf", status: "fertig" });
      expect(await dokumente()).toBe(0);
      expect(await standLesen(standId)).toMatchObject({ status: "fertig", fehler: null, file_name: pdf.fileName, pruefung: ok });
      expect(await jobs.jobLaden(ws, job.vpsJobId)).toMatchObject({ status: "abgelegt", dealDocumentId: null });
    });

    it("Entwurf mit Preisabweichung oder ohne Prüfung: Stand fehler mit Text", async () => {
      const a = await mitStand("entwurf");
      expect(await ablage.ablegenUnterSperre(a.job, pdf, { pruefung: abweichung })).toEqual({ art: "entwurf", status: "fehler" });
      expect(await standLesen(a.standId)).toMatchObject({
        status: "fehler",
        fehler: "Preis im Druck weicht von der Kalkulation ab. Bitte neu drucken; bleibt es so, Dario Bescheid sagen.",
        pruefung: abweichung,
      });
      const b = await mitStand("entwurf");
      expect(await ablage.ablegenUnterSperre(b.job, pdf)).toEqual({ art: "entwurf", status: "fehler" });
      expect((await standLesen(b.standId)).fehler).toBe("PDF nicht prüfbar. Bitte neu drucken.");
      expect(await dokumente()).toBe(0);
    });

    it("spätes Ergebnis ändert einen fertigen Stand nicht", async () => {
      const { job, standId } = await mitStand("entwurf", { status: "fertig" });
      expect((await ablage.ablegenUnterSperre(job, pdf, { pruefung: abweichung })).art).toBe("verworfen");
      expect(await standLesen(standId)).toMatchObject({ status: "fertig", fehler: null, file_name: null });
      expect(await dokumente()).toBe(0);
    });

    it("Ziel ohne Stand (Stand gelöscht): verworfen", async () => {
      const { job, standId } = await mitStand("entwurf");
      await sql`delete from kv_staende where id = ${standId}`;
      const nachLoeschen = { ...job, kvStandId: null };
      expect((await ablage.ablegenUnterSperre(nachLoeschen, pdf, { pruefung: ok })).art).toBe("verworfen");
      expect(await dokumente()).toBe(0);
      expect((await jobs.jobLaden(ws, job.vpsJobId))?.status).toBe("verworfen");
    });

    it("aktuell: legt ab wie heute und verknüpft den Stand mit Dokument und Datei", async () => {
      const { job, standId } = await mitStand("aktuell");
      const r = await ablage.ablegenUnterSperre(job, pdf, { pruefung: ok });
      expect(r.art).toBe("abgelegt");
      const [doc] = await sql`select id from deal_documents where deal_record_id = ${deal}`;
      expect(await standLesen(standId)).toMatchObject({ status: "fertig", deal_document_id: doc.id, file_name: pdf.fileName, pruefung: ok });
    });

    it("aktuell mit Preisabweichung: mit Änderungen verworfen, ohne Änderungen abgelegt mit Warnung", async () => {
      const mit = await mitStand("aktuell", { quelle: "mitgewandert", aenderungen: AENDERUNG });
      expect(await ablage.ablegenUnterSperre(mit.job, pdf, { pruefung: abweichung })).toMatchObject({ art: "verworfen" });
      expect(await standLesen(mit.standId)).toMatchObject({ status: "fehler", pruefung: abweichung });
      expect(await dokumente()).toBe(0);

      const ohne = await mitStand("aktuell");
      expect((await ablage.ablegenUnterSperre(ohne.job, pdf, { pruefung: abweichung })).art).toBe("abgelegt");
      // Aufgabe 8 (Grok 2): die Warnung steht als Text am fertigen Stand.
      expect(await standLesen(ohne.standId)).toMatchObject({
        status: "fertig",
        pruefung: abweichung,
        fehler: "Preis im Druck weicht von der Kalkulation ab. Bitte neu drucken; bleibt es so, Dario Bescheid sagen.",
      });
      expect(await dokumente()).toBe(1);
    });

    it("älterer KV-Job nach einem Push von Hand: verworfen mit Text (Kimi 1); Quelle selbst gepusht: abgelegt", async () => {
      // Aktuelles Dokument gehört zu einem gepushten Stand „hand“, der nicht die Quelle des Jobs ist.
      const [doc] = await sql`insert into deal_documents (id, workspace_id, deal_record_id, document_type, file_name, file_size, mime_type, file_content)
        values (${randomUUID()}, ${ws}, ${deal}, 'quotation', 'KV-alt.pdf', 9, 'application/pdf', ${pdf.fileContent}) returning id`;
      const gepusht = await stand({ quelle: "hand", status: "fertig", dokument: doc.id, gepusht: true });
      const alt = await mitStand("aktuell");
      const r = await ablage.ablegenUnterSperre(alt.job, pdf, { pruefung: ok });
      const n = (await sql`select nummer from kv_staende where id = ${gepusht}`)[0].nummer;
      const text = `Inzwischen wurde Stand ${n} gepusht. KV neu erstellen, die Änderungen wandern mit.`;
      expect(r).toEqual({ art: "verworfen", text });
      expect(await standLesen(alt.standId)).toMatchObject({ status: "fehler", fehler: text });
      expect(await dokumente()).toBe(1);

      // Der gepushte Stand war beim Start schon aktuell (Quelle): der neue KV gewinnt.
      const neu = await mitStand("aktuell", { quelle: "mitgewandert", vorgaenger: gepusht, aenderungen: AENDERUNG });
      expect((await ablage.ablegenUnterSperre(neu.job, pdf, { pruefung: ok })).art).toBe("abgelegt");
      expect(await dokumente()).toBe(2);
    });

    it("Fehler und Versionswechsel setzen einen druckenden Stand auf fehler", async () => {
      const a = await mitStand("entwurf");
      expect(await ablage.abschliessenMitAnspruch(ws, a.job.vpsJobId, a.job.claimedAt, { status: "fehler", fehler: "Skill-Fehler auf dem VPS" })).toBe(true);
      expect(await standLesen(a.standId)).toMatchObject({ status: "fehler", fehler: "Skill-Fehler auf dem VPS" });

      const b = await mitStand("aktuell");
      await sql`update quotations set calculation_version_id = ${v2} where deal_record_id = ${deal}`;
      expect((await ablage.ablegenUnterSperre(b.job, pdf, { pruefung: ok })).art).toBe("verworfen");
      expect(await standLesen(b.standId)).toMatchObject({ status: "fehler", fehler: "KV verworfen, Kalkulation neuer" });
    });

    it("kvStandPruefungLaden liest die erwarteten Beträge, nur im eigenen Workspace", async () => {
      const id = await stand();
      expect(await ablage.kvStandPruefungLaden(ws, id)).toEqual({ ...betraege, preis: "offen", fehlt: [], fremd: [] });
      expect(await ablage.kvStandPruefungLaden(randomUUID(), id)).toBeNull();
    });
  });
});
