import { beforeEach, describe, expect, it, vi } from "vitest";
import { RENDER_JOB_RESERVIERUNG_MS, type RenderJob } from "@/lib/angebot-wahl";

// Job-Register und Ablage als Speicher im Test (render-jobs.fake.ts, gleiche
// Semantik). Die echte Transaktion prüft kv-job-ablage.db.test.ts.
const m = vi.hoisted(() => {
  process.env.CRM_TOOLS_API_URL = "https://crm-tools.test";
  process.env.CRM_TOOLS_AUTH_TOKEN = "tools-token";
  return { applyInvoiceDueDate: vi.fn(), dealDokumentNachlauf: vi.fn() };
});

vi.mock("@/services/render-jobs", async () => (await import("@/services/render-jobs.fake")).fake.renderJobs);
vi.mock("@/services/kv-job-ablage", async () => (await import("@/services/render-jobs.fake")).fake.ablage);
vi.mock("@/services/deal-documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/deal-documents")>()),
  dealDokumentNachlauf: m.dealDokumentNachlauf,
}));
vi.mock("@/services/rechnung-faellig", () => ({ applyInvoiceDueDate: m.applyInvoiceDueDate }));

import { fake } from "@/services/render-jobs.fake";
import { kvJobAbschliessen, kvJobAbschliessenDetails } from "./kv-job-abschluss";

const WS = "ws_kottke";
const DEAL = "deal_1";
const JETZT = new Date("2026-11-07T10:00:00.000Z");

const job = (teil: Partial<RenderJob> = {}) =>
  fake.job({ workspaceId: WS, dealRecordId: DEAL, createdAt: "2026-11-07T09:58:00.000Z", ...teil });

const pdf = (name = "KV-KO-20261107-FLO.pdf") =>
  new Response(new Uint8Array(Buffer.from("%PDF-1.7\n", "binary")), {
    status: 200,
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${name}"` },
  });
const status = (s: string, error: string | null = null) =>
  new Response(JSON.stringify({ status: s, error, result_filename: null }), { status: 200 });

/** VPS-Mock: `/jobs/{id}` liefert `s`, `/result` das PDF. */
function vps(s: Response | (() => Response), ergebnis: () => Response = () => pdf()) {
  return vi.fn(async (url: string | URL | Request) =>
    String(url).endsWith("/result") ? ergebnis() : typeof s === "function" ? s() : s.clone()
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  fake.reset();
  vi.clearAllMocks();
  fake.angebotsVersionId.mockResolvedValue("ver_3");
  m.applyInvoiceDueDate.mockResolvedValue({ rechnungFaelligAm: null });
  m.dealDokumentNachlauf.mockResolvedValue(undefined);
});

describe("kvJobAbschliessen", () => {
  it("KV mit Version: legt mit Versionsbezug ab, solange die Quotation diese Version trägt", async () => {
    job();
    const r = await kvJobAbschliessen(WS, "job_1", { abruf: vps(status("done")), jetzt: JETZT });
    expect(r).toEqual({ status: "abgelegt", dealDocumentId: "doc_1" });
    expect(fake.createDealDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        dealRecordId: DEAL,
        documentType: "quotation",
        fileName: "KV-KO-20261107-FLO.pdf",
        calculationVersionId: "ver_3",
      })
    );
    expect(fake.jobs.get("job_1")).toMatchObject({ status: "abgelegt", dealDocumentId: "doc_1" });
  });

  it("KV ohne Version (Altbestand): legt ohne Bezug ab und fragt die Quotation nicht", async () => {
    job({ calculationVersionId: null });
    const r = await kvJobAbschliessen(WS, "job_1", { abruf: vps(status("done")), jetzt: JETZT });
    expect(r.status).toBe("abgelegt");
    expect(fake.createDealDocument).toHaveBeenCalledWith(expect.objectContaining({ calculationVersionId: null }));
    expect(fake.angebotsVersionId).not.toHaveBeenCalled();
  });

  it("AB: wie heute ohne Bezug", async () => {
    job({ documentType: "order_confirmation", calculationVersionId: null, priceCents: null });
    const r = await kvJobAbschliessen(WS, "job_1", { abruf: vps(status("done"), () => pdf("AB-KO-1.pdf")), jetzt: JETZT });
    expect(r.status).toBe("abgelegt");
    expect(fake.createDealDocument).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: "order_confirmation", calculationVersionId: null })
    );
  });

  it("KV einer veralteten Version: verworfen, nichts abgelegt (F4)", async () => {
    job();
    fake.angebotsVersionId.mockResolvedValue("ver_4");
    const r = await kvJobAbschliessen(WS, "job_1", { abruf: vps(status("done")), jetzt: JETZT });
    expect(r).toEqual({ status: "verworfen", grund: "version_veraltet" });
    expect(fake.createDealDocument).not.toHaveBeenCalled();
    expect(fake.jobs.get("job_1")?.status).toBe("verworfen");
    // Ein zweiter Aufruf meldet wieder „verworfen“, nicht „erledigt“.
    expect(await kvJobAbschliessen(WS, "job_1", { abruf: vps(status("done")), jetzt: JETZT })).toEqual({
      status: "verworfen",
      grund: "version_veraltet",
    });
  });

  it("VPS rechnet noch: „läuft“, ohne Reservierung (der Browser bleibt frei)", async () => {
    job();
    const abruf = vps(status("running"));
    expect(await kvJobAbschliessen(WS, "job_1", { abruf, jetzt: JETZT })).toEqual({ status: "laeuft" });
    expect(fake.jobs.get("job_1")?.claimedAt).toBeNull();
    expect(abruf).toHaveBeenCalledTimes(1);
  });

  it("VPS kennt den Job nicht mehr (404): „fehler“", async () => {
    job();
    const r = await kvJobAbschliessen(WS, "job_1", {
      abruf: vps(new Response("not found", { status: 404 })),
      jetzt: JETZT,
    });
    expect(r).toEqual({ status: "fehler", fehler: "Job auf dem VPS nicht mehr vorhanden" });
    expect(fake.jobs.get("job_1")?.status).toBe("fehler");
    expect(fake.createDealDocument).not.toHaveBeenCalled();
  });

  it("Skill-Fehler auf dem VPS: „fehler“ mit dem Text des VPS", async () => {
    job();
    const r = await kvJobAbschliessen(WS, "job_1", { abruf: vps(status("error", "Vorlage fehlt")), jetzt: JETZT });
    expect(r).toEqual({ status: "fehler", fehler: "Vorlage fehlt" });
  });

  it("VPS vorübergehend weg (500): „läuft“, nächster Lauf versucht es wieder", async () => {
    job();
    const r = await kvJobAbschliessen(WS, "job_1", { abruf: vps(new Response("x", { status: 502 })), jetzt: JETZT });
    expect(r).toEqual({ status: "laeuft" });
    expect(fake.jobs.get("job_1")?.status).toBe("laeuft");
  });

  it("fremder Workspace: kein Zugriff auf den Job", async () => {
    job();
    const abruf = vps(status("done"));
    const r = await kvJobAbschliessen("ws_ceylan", "job_1", { abruf, jetzt: JETZT });
    expect(r.status).toBe("fehler");
    expect(abruf).not.toHaveBeenCalled();
    expect(fake.createDealDocument).not.toHaveBeenCalled();
  });

  it("schon abgelegt: „schon_erledigt“ mit dem Dokument, kein zweiter Abruf", async () => {
    job({ status: "abgelegt", dealDocumentId: "doc_alt" });
    const abruf = vps(status("done"));
    expect(await kvJobAbschliessen(WS, "job_1", { abruf, jetzt: JETZT })).toEqual({
      status: "schon_erledigt",
      dealDocumentId: "doc_alt",
    });
    expect(abruf).not.toHaveBeenCalled();
  });

  it("frisch reserviert (anderer Aufrufer): „läuft“; nach 2 Minuten wieder frei", async () => {
    job({ claimedAt: new Date(JETZT.getTime() - 30_000).toISOString() });
    expect(await kvJobAbschliessen(WS, "job_1", { abruf: vps(status("done")), jetzt: JETZT })).toEqual({ status: "laeuft" });
    const spaeter = new Date(JETZT.getTime() + RENDER_JOB_RESERVIERUNG_MS);
    expect((await kvJobAbschliessen(WS, "job_1", { abruf: vps(status("done")), jetzt: spaeter })).status).toBe("abgelegt");
  });

  it("Browser und Cron gleichzeitig: genau ein Dokument", async () => {
    job();
    const [a, b] = await Promise.all([
      kvJobAbschliessen(WS, "job_1", { abruf: vps(status("done")), jetzt: JETZT }),
      kvJobAbschliessen(WS, "job_1", { abruf: vps(status("done")), jetzt: JETZT }),
    ]);
    expect(fake.createDealDocument).toHaveBeenCalledTimes(1);
    expect([a.status, b.status].sort()).toEqual(["abgelegt", "laeuft"]);
    // Danach sieht der Verlierer den Endstand.
    expect(await kvJobAbschliessen(WS, "job_1", { abruf: vps(status("done")), jetzt: JETZT })).toEqual({
      status: "schon_erledigt",
      dealDocumentId: "doc_1",
    });
  });

  it("Rechnung: setzt „Rechnung fällig am“ mit dem ausdrücklichen Datum", async () => {
    job({ documentType: "invoice", calculationVersionId: null });
    m.applyInvoiceDueDate.mockResolvedValue({ rechnungFaelligAm: "2026-12-15" });
    const r = await kvJobAbschliessenDetails(WS, "job_1", {
      abruf: vps(status("done"), () => pdf("RE-KO-1.pdf")),
      jetzt: JETZT,
      faelligAm: "2026-12-15",
      updatedBy: "usr_2",
    });
    expect(r.rechnungFaelligAm).toBe("2026-12-15");
    expect(m.applyInvoiceDueDate).toHaveBeenCalledWith({
      documentType: "invoice",
      workspaceId: WS,
      dealRecordId: DEAL,
      explicitDueDate: "2026-12-15",
      updatedBy: "usr_2",
    });
  });

  it("PDF über 10 MB: „fehler“, nichts abgelegt", async () => {
    job();
    const gross = () =>
      new Response(new Uint8Array(10 * 1024 * 1024 + 1), {
        status: 200,
        headers: { "content-disposition": 'attachment; filename="KV-KO-gross.pdf"' },
      });
    const r = await kvJobAbschliessen(WS, "job_1", { abruf: vps(status("done"), gross), jetzt: JETZT });
    expect(r.status).toBe("fehler");
    expect(fake.createDealDocument).not.toHaveBeenCalled();
  });

  it("Nachläufe (Portal, Wartet) erst nach dem Ablegen, nicht beim Verwerfen", async () => {
    job();
    await kvJobAbschliessen(WS, "job_1", { abruf: vps(status("done")), jetzt: JETZT });
    expect(m.dealDokumentNachlauf).toHaveBeenCalledWith({ workspaceId: WS, dealRecordId: DEAL }, "quotation");
    m.dealDokumentNachlauf.mockClear();
    job({ vpsJobId: "job_2" });
    fake.angebotsVersionId.mockResolvedValue("ver_4");
    await kvJobAbschliessen(WS, "job_2", { abruf: vps(status("done")), jetzt: JETZT });
    expect(m.dealDokumentNachlauf).not.toHaveBeenCalled();
  });

  it("Reservierung während des PDF-Abrufs verloren: nichts abgelegt, Endstand des anderen", async () => {
    job();
    // Während das PDF lädt, übernimmt ein anderer nach Ablauf und legt ab.
    const abruf = vps(status("done"), () => {
      const j = fake.jobs.get("job_1")!;
      Object.assign(j, { claimedAt: new Date(JETZT.getTime() + 1).toISOString(), status: "abgelegt", dealDocumentId: "doc_anderer" });
      return pdf();
    });
    expect(await kvJobAbschliessen(WS, "job_1", { abruf, jetzt: JETZT })).toEqual({
      status: "schon_erledigt",
      dealDocumentId: "doc_anderer",
    });
    expect(fake.createDealDocument).not.toHaveBeenCalled();
  });
});
