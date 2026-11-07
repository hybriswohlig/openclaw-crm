import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { MAX_DEAL_DOCUMENT_SIZE } from "@/services/deal-documents";
import type { RenderJob } from "@/lib/angebot-wahl";

// Production 413: store-as-document used to fetch the VPS PDF and then POST
// that file as multipart to /api/v1/deals/:id/documents. The second hop is an
// inbound Vercel request, so anything ≳4.5 MB (typical KV PDFs) died with
// HTTP 413 and `{ error: "upload failed", upstream: {} }` — the platform
// body, not our 10 MB app cap. The handler must insert via createDealDocument
// and must not re-upload the PDF through fetch.

const mocks = vi.hoisted(() => {
  process.env.CRM_TOOLS_API_URL = "https://crm-tools.test";
  process.env.CRM_TOOLS_AUTH_TOKEN = "tools-token";
  return {
    getAuthContext: vi.fn(),
    applyInvoiceDueDate: vi.fn(),
  };
});

// Job-Register und Ablage als Speicher im Test (render-jobs.fake.ts, gleiche Semantik).
vi.mock("@/services/render-jobs", async () => (await import("@/services/render-jobs.fake")).fake.renderJobs);
vi.mock("@/services/kv-job-ablage", async () => (await import("@/services/render-jobs.fake")).fake.ablage);

const dealImWorkspaceMock = vi.hoisted(() => vi.fn(async (_ws: string, _deal: string) => true));
vi.mock("@/lib/kalkulation-versionen-antwort", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/kalkulation-versionen-antwort")>()),
  dealImWorkspace: dealImWorkspaceMock,
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/deal-documents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/deal-documents")>();
  return { ...actual, dealDokumentNachlauf: vi.fn(async () => {}) };
});

vi.mock("@/services/rechnung-faellig", () => ({
  applyInvoiceDueDate: mocks.applyInvoiceDueDate,
}));

import { POST } from "./route";
import { fake } from "@/services/render-jobs.fake";

const WORKSPACE_ID = "ws_kottke_prod";
const DEAL_ID = "6e9256ac-a253-4b4e-b49d-0a7845e9f940";
const JOB_ID = "dfd1e716510e4adb";
const AUTH_CTX = {
  userId: "usr_1",
  workspaceId: WORKSPACE_ID,
  workspaceRole: "admin" as const,
  permissions: {},
  authMethod: "api_key" as const,
};

const fetchMock = vi.fn();

function registriert(teil: Partial<RenderJob> = {}) {
  fake.job({
    vpsJobId: JOB_ID,
    workspaceId: WORKSPACE_ID,
    dealRecordId: DEAL_ID,
    calculationVersionId: null,
    priceCents: null,
    ...teil,
  });
}

/** VPS: `/jobs/{id}` meldet „done“, `/result` liefert das PDF. */
function vpsFertig(pdf: Response) {
  fetchMock.mockImplementation(async (url: string) =>
    String(url).endsWith("/result")
      ? pdf
      : new Response(JSON.stringify({ status: "done", error: null, result_filename: null }), { status: 200 })
  );
}

function callStore(body: Record<string, unknown> = { dealRecordId: DEAL_ID }) {
  return POST(
    new NextRequest(`https://crm.test/api/tools/jobs/${JOB_ID}/store-as-document`, {
      method: "POST",
      headers: {
        authorization: "Bearer oc_sk_test",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: JOB_ID }) }
  );
}

function vpsPdfResponse(bytes: Buffer, filename: string) {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset();
  registriert();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  mocks.getAuthContext.mockResolvedValue(AUTH_CTX);
  mocks.applyInvoiceDueDate.mockResolvedValue({ rechnungFaelligAm: null });
});

describe("POST /api/tools/jobs/[id]/store-as-document", () => {
  it("stores a PDF larger than the Vercel 4.5 MB hop without re-uploading it", async () => {
    // 4.6 MB — over the platform inbound body limit, under our 10 MB cap.
    const pdf = Buffer.alloc(Math.ceil(4.6 * 1024 * 1024), 0x25);
    vpsFertig(vpsPdfResponse(pdf, "KV-KO-20260907-FLO-2.pdf"));

    const res = await callStore();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.filename).toBe("KV-KO-20260907-FLO-2.pdf");
    expect(body.deducedDocumentType).toBe("quotation");
    expect(body.document.data.id).toBe("doc_1");

    // Status und Ergebnis vom VPS, kein zweiter Weg über /documents.
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      `https://crm-tools.test/jobs/${JOB_ID}`,
      `https://crm-tools.test/jobs/${JOB_ID}/result`,
    ]);

    expect(fake.createDealDocument).toHaveBeenCalledTimes(1);
    expect(fake.createDealDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        dealRecordId: DEAL_ID,
        documentType: "quotation",
        fileName: "KV-KO-20260907-FLO-2.pdf",
        fileSize: pdf.length,
        mimeType: "application/pdf",
      })
    );
    const stored = fake.createDealDocument.mock.calls[0][0];
    expect(stored.fileContent).toBe(pdf.toString("base64"));
  });

  it("KV vom VPS: ohne Kalkulationsversion gespeichert, das Ergebnis trägt keine Job-Parameter (Review 4)", async () => {
    vpsFertig(vpsPdfResponse(Buffer.from("%PDF-1.7\n", "binary"), "KV-KO-20261106-FLO.pdf"));
    expect((await callStore()).status).toBe(200);
    expect(fake.createDealDocument).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: "quotation", calculationVersionId: null })
    );
  });

  it("returns the application 413 (not upload failed) when the PDF exceeds 10 MB", async () => {
    const pdf = Buffer.alloc(MAX_DEAL_DOCUMENT_SIZE + 1, 0x25);
    vpsFertig(vpsPdfResponse(pdf, "KV-KO-huge.pdf"));

    const res = await callStore();
    const body = await res.json();

    // Seit Plan 5a endgültig „fehler“ im Register (kein neuer Versuch durch den Cron).
    expect(res.status).toBe(502);
    expect(body).toMatchObject({ status: "fehler", error: "File too large (max 10 MB)" });
    expect(body.error).not.toBe("upload failed");
    expect(fake.createDealDocument).not.toHaveBeenCalled();
    expect(fake.jobs.get(JOB_ID)?.status).toBe("fehler");
  });

  it("passes through an explicit documentType and does not hop the PDF", async () => {
    const pdf = Buffer.from("%PDF-1.7\n", "binary");
    vpsFertig(vpsPdfResponse(pdf, "custom.pdf"));

    const res = await callStore({
      dealRecordId: DEAL_ID,
      documentType: "quotation",
    });

    expect(res.status).toBe(200);
    expect(fake.createDealDocument).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: "quotation", fileName: "custom.pdf" })
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.applyInvoiceDueDate).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: "quotation", explicitDueDate: undefined })
    );
  });

  it("stamps Rechnung fällig am with the upload day for an invoice and does not add 7 days", async () => {
    registriert({ documentType: "invoice" });
    const pdf = Buffer.from("%PDF-1.7\n", "binary");
    vpsFertig(vpsPdfResponse(pdf, "RE-KO-20261102-SCH.pdf"));
    mocks.applyInvoiceDueDate.mockResolvedValue({ rechnungFaelligAm: "2026-11-02" });

    const res = await callStore();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.deducedDocumentType).toBe("invoice");
    expect(body.rechnungFaelligAm).toBe("2026-11-02");
    expect(body.dueDateWarning).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/records/"))).toBe(false);
    expect(mocks.applyInvoiceDueDate).toHaveBeenCalledWith({
      documentType: "invoice",
      workspaceId: WORKSPACE_ID,
      dealRecordId: DEAL_ID,
      explicitDueDate: undefined,
      updatedBy: AUTH_CTX.userId,
    });
  });

  it("keeps an explicit invoice due date", async () => {
    const pdf = Buffer.from("%PDF-1.7\n", "binary");
    registriert({ documentType: "invoice" });
    vpsFertig(vpsPdfResponse(pdf, "custom.pdf"));
    mocks.applyInvoiceDueDate.mockResolvedValue({ rechnungFaelligAm: "2026-12-15" });

    const res = await callStore({
      dealRecordId: DEAL_ID,
      documentType: "invoice",
      dueDate: "2026-12-15",
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.rechnungFaelligAm).toBe("2026-12-15");
    expect(mocks.applyInvoiceDueDate).toHaveBeenCalledWith(
      expect.objectContaining({
        documentType: "invoice",
        explicitDueDate: "2026-12-15",
      })
    );
  });

  it("keeps the stored invoice when the due-date write fails", async () => {
    const pdf = Buffer.from("%PDF-1.7\n", "binary");
    registriert({ documentType: "invoice" });
    vpsFertig(vpsPdfResponse(pdf, "RE-KO-20261102-SCH.pdf"));
    mocks.applyInvoiceDueDate.mockResolvedValue({
      rechnungFaelligAm: null,
      dueDateWarning: "failed to set rechnung_faellig_am: deal not found",
    });

    const res = await callStore();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.document.data.id).toBe("doc_1");
    expect(body.dueDateWarning).toBe("failed to set rechnung_faellig_am: deal not found");
    expect(body.rechnungFaelligAm).toBeUndefined();
  });
  describe("Job-Register (Plan 5a)", () => {
    const kvPdf = () => vpsPdfResponse(Buffer.from("%PDF-1.7\n", "binary"), "KV-KO-20261107-FLO.pdf");

    it("KV mit Version: legt mit Versionsbezug ab", async () => {
      registriert({ calculationVersionId: "ver_3", priceCents: 172000 });
      fake.angebotsVersionId.mockResolvedValue("ver_3");
      vpsFertig(kvPdf());
      const res = await callStore({ dealRecordId: DEAL_ID, documentType: "quotation" });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ status: "abgelegt", dealDocumentId: "doc_1" });
      expect(fake.createDealDocument).toHaveBeenCalledWith(
        expect.objectContaining({ documentType: "quotation", calculationVersionId: "ver_3" })
      );
    });

    it("KV einer veralteten Version: 409 verworfen, nichts abgelegt", async () => {
      registriert({ calculationVersionId: "ver_3" });
      fake.angebotsVersionId.mockResolvedValue("ver_4");
      vpsFertig(kvPdf());
      const res = await callStore();
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ status: "verworfen", grund: "version_veraltet" });
      expect(fake.createDealDocument).not.toHaveBeenCalled();
    });

    it("schon vom Cron abgelegt: 200 schon_erledigt, kein zweites Dokument", async () => {
      registriert({ status: "abgelegt", dealDocumentId: "doc_cron" });
      vpsFertig(kvPdf());
      const res = await callStore();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "schon_erledigt", dealDocumentId: "doc_cron" });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(fake.createDealDocument).not.toHaveBeenCalled();
    });

    it("gerade vom Cron reserviert: 202 läuft", async () => {
      registriert({ claimedAt: new Date().toISOString() });
      vpsFertig(kvPdf());
      const res = await callStore();
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ status: "laeuft" });
      expect(fake.createDealDocument).not.toHaveBeenCalled();
    });

    it("Job ohne Eintrag: 404 (fremde jobId), nichts abgelegt", async () => {
      fake.jobs.clear();
      vpsFertig(kvPdf());
      const res = await callStore();
      expect(res.status).toBe(404);
      expect(fake.createDealDocument).not.toHaveBeenCalled();
    });

    it("Job aus einem anderen Workspace: 404", async () => {
      registriert({ workspaceId: "ws_ceylan" });
      vpsFertig(kvPdf());
      const res = await callStore();
      expect(res.status).toBe(404);
      expect(fake.createDealDocument).not.toHaveBeenCalled();
    });

    it("anderer Deal als im Register: 404, kein Abruf beim VPS", async () => {
      vpsFertig(kvPdf());
      const res = await callStore({ dealRecordId: "deal_fremd" });
      expect(res.status).toBe(404);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(fake.createDealDocument).not.toHaveBeenCalled();
    });

    it("anderer Typ als im Register: 404", async () => {
      vpsFertig(kvPdf());
      const res = await callStore({ dealRecordId: DEAL_ID, documentType: "invoice" });
      expect(res.status).toBe(404);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("Auftragsanweisung aus dem Register: abgelegt wie jeder Job", async () => {
      registriert({ documentType: "worker_instructions", calculationVersionId: null });
      vpsFertig(vpsPdfResponse(Buffer.from("%PDF-1.7\n", "binary"), "AW-KO-20261107-FLO.pdf"));
      const res = await callStore({ dealRecordId: DEAL_ID, documentType: "worker_instructions" });
      expect(res.status).toBe(200);
      expect(fake.createDealDocument).toHaveBeenCalledWith(
        expect.objectContaining({ documentType: "worker_instructions", calculationVersionId: null })
      );
    });

    it("unregistrierte Auftragsanweisung (z. B. fremder Workspace): 404 ohne VPS-Abruf (Fund 4)", async () => {
      fake.jobs.clear();
      fetchMock.mockResolvedValue(vpsPdfResponse(Buffer.from("%PDF-1.7\n", "binary"), "AW-KO-20261107-FLO.pdf"));
      const res = await callStore({ dealRecordId: DEAL_ID, documentType: "worker_instructions" });
      expect(res.status).toBe(404);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(fake.createDealDocument).not.toHaveBeenCalled();
    });
  });
});
