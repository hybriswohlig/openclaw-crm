import { beforeEach, describe, expect, it, vi } from "vitest";
import { RENDER_JOB_RESERVIERUNG_MS, type RenderJob } from "@/lib/angebot-wahl";

// Job-Register als Speicher im Test, mit derselben Semantik wie Task B
// (Reservierung: status 'laeuft' und Anspruch frei oder älter als 2 Minuten).
const m = vi.hoisted(() => {
  process.env.CRM_TOOLS_API_URL = "https://crm-tools.test";
  process.env.CRM_TOOLS_AUTH_TOKEN = "tools-token";
  const jobs = new Map<string, RenderJob>();
  return {
    jobs,
    createDealDocument: vi.fn(),
    angebotsVersionId: vi.fn(),
    applyInvoiceDueDate: vi.fn(),
    jobReservieren: vi.fn(async (ws: string, id: string, jetzt: Date) => {
      const j = jobs.get(id);
      if (!j || j.workspaceId !== ws || j.status !== "laeuft") return null;
      if (j.claimedAt && jetzt.getTime() - new Date(j.claimedAt).getTime() < 2 * 60 * 1000) return null;
      j.claimedAt = jetzt.toISOString();
      return { ...j };
    }),
    jobAbschliessen: vi.fn(
      async (ws: string, id: string, e: { status: RenderJob["status"]; dealDocumentId?: string; fehler?: string }) => {
        const j = jobs.get(id);
        if (!j || j.workspaceId !== ws) return;
        j.status = e.status;
        j.dealDocumentId = e.dealDocumentId ?? null;
        j.fehler = e.fehler ?? null;
      }
    ),
  };
});

vi.mock("@/services/render-jobs", () => ({
  jobLaden: async (ws: string, id: string) => {
    const j = m.jobs.get(id);
    return j && j.workspaceId === ws ? { ...j } : null;
  },
  jobReservieren: m.jobReservieren,
  jobAbschliessen: m.jobAbschliessen,
}));
vi.mock("@/services/deal-documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/deal-documents")>()),
  createDealDocument: m.createDealDocument,
  angebotsVersionId: m.angebotsVersionId,
}));
vi.mock("@/services/rechnung-faellig", () => ({ applyInvoiceDueDate: m.applyInvoiceDueDate }));

import { kvJobAbschliessen, kvJobAbschliessenDetails } from "./kv-job-abschluss";

const WS = "ws_kottke";
const DEAL = "deal_1";
const JETZT = new Date("2026-11-07T10:00:00.000Z");

function job(teil: Partial<RenderJob> = {}): RenderJob {
  const j: RenderJob = {
    vpsJobId: "job_1",
    workspaceId: WS,
    dealRecordId: DEAL,
    documentType: "quotation",
    calculationVersionId: "ver_3",
    priceCents: 172000,
    status: "laeuft",
    createdBy: "usr_1",
    createdAt: "2026-11-07T09:58:00.000Z",
    claimedAt: null,
    storedAt: null,
    dealDocumentId: null,
    fehler: null,
    ...teil,
  };
  m.jobs.set(j.vpsJobId, j);
  return j;
}

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
  m.jobs.clear();
  vi.clearAllMocks();
  m.angebotsVersionId.mockResolvedValue("ver_3");
  m.applyInvoiceDueDate.mockResolvedValue({ rechnungFaelligAm: null });
  let n = 0;
  m.createDealDocument.mockImplementation(async (input: { documentType: string; fileName: string; fileSize: number }) => ({
    id: `doc_${++n}`,
    documentType: input.documentType,
    fileName: input.fileName,
    fileSize: input.fileSize,
    mimeType: "application/pdf",
    uploadedAt: JETZT,
  }));
});

describe("kvJobAbschliessen", () => {
  it("KV mit Version: legt mit Versionsbezug ab, solange die Quotation diese Version trägt", async () => {
    job();
    const r = await kvJobAbschliessen(WS, "job_1", { abruf: vps(status("done")), jetzt: JETZT });
    expect(r).toEqual({ status: "abgelegt", dealDocumentId: "doc_1" });
    expect(m.createDealDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        dealRecordId: DEAL,
        documentType: "quotation",
        fileName: "KV-KO-20261107-FLO.pdf",
        calculationVersionId: "ver_3",
      })
    );
    expect(m.jobs.get("job_1")).toMatchObject({ status: "abgelegt", dealDocumentId: "doc_1" });
  });

  it("KV ohne Version (Altbestand): legt ohne Bezug ab und fragt die Quotation nicht", async () => {
    job({ calculationVersionId: null });
    const r = await kvJobAbschliessen(WS, "job_1", { abruf: vps(status("done")), jetzt: JETZT });
    expect(r.status).toBe("abgelegt");
    expect(m.createDealDocument).toHaveBeenCalledWith(expect.objectContaining({ calculationVersionId: null }));
    expect(m.angebotsVersionId).not.toHaveBeenCalled();
  });

  it("AB: wie heute ohne Bezug", async () => {
    job({ documentType: "order_confirmation", calculationVersionId: null, priceCents: null });
    const r = await kvJobAbschliessen(WS, "job_1", { abruf: vps(status("done"), () => pdf("AB-KO-1.pdf")), jetzt: JETZT });
    expect(r.status).toBe("abgelegt");
    expect(m.createDealDocument).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: "order_confirmation", calculationVersionId: null })
    );
  });

  it("KV einer veralteten Version: verworfen, nichts abgelegt (F4)", async () => {
    job();
    m.angebotsVersionId.mockResolvedValue("ver_4");
    const r = await kvJobAbschliessen(WS, "job_1", { abruf: vps(status("done")), jetzt: JETZT });
    expect(r).toEqual({ status: "verworfen", grund: "version_veraltet" });
    expect(m.createDealDocument).not.toHaveBeenCalled();
    expect(m.jobs.get("job_1")?.status).toBe("verworfen");
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
    expect(m.jobReservieren).not.toHaveBeenCalled();
    expect(m.jobs.get("job_1")?.claimedAt).toBeNull();
    expect(abruf).toHaveBeenCalledTimes(1);
  });

  it("VPS kennt den Job nicht mehr (404): „fehler“", async () => {
    job();
    const r = await kvJobAbschliessen(WS, "job_1", {
      abruf: vps(new Response("not found", { status: 404 })),
      jetzt: JETZT,
    });
    expect(r).toEqual({ status: "fehler", fehler: "Job auf dem VPS nicht mehr vorhanden" });
    expect(m.jobs.get("job_1")?.status).toBe("fehler");
    expect(m.createDealDocument).not.toHaveBeenCalled();
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
    expect(m.jobs.get("job_1")?.status).toBe("laeuft");
  });

  it("fremder Workspace: kein Zugriff auf den Job", async () => {
    job();
    const abruf = vps(status("done"));
    const r = await kvJobAbschliessen("ws_ceylan", "job_1", { abruf, jetzt: JETZT });
    expect(r.status).toBe("fehler");
    expect(abruf).not.toHaveBeenCalled();
    expect(m.createDealDocument).not.toHaveBeenCalled();
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
    expect(m.createDealDocument).toHaveBeenCalledTimes(1);
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
    expect(m.createDealDocument).not.toHaveBeenCalled();
  });
});
