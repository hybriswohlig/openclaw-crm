import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Plan 5a, Entscheidung 6: nach erfolgreichem Upstream legt tools/run für den
// Skill `rechnungen-und-auftragsbestaetigungen` mit Deal einen Register-Eintrag an.
// Version und Preis kommen aus derselben Lesung wie die Preise an den VPS.

const m = vi.hoisted(() => {
  process.env.CRM_TOOLS_API_URL = "https://crm-tools.test";
  process.env.CRM_TOOLS_AUTH_TOKEN = "tools-token";
  return {
    getAuthContext: vi.fn(),
    attachDocumentJobContext: vi.fn(),
    assertDealInWorkspace: vi.fn(),
    jobAnlegen: vi.fn(),
  };
});

vi.mock("@/lib/api-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-utils")>()),
  getAuthContext: m.getAuthContext,
}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/services/deal-photos", () => ({ findDealInternalPhotosByIds: vi.fn(async () => []) }));
vi.mock("@/services/doc-customer-name", () => ({
  rewriteKundeParamsFromDeal: async (_ws: string, p: Record<string, unknown>) => p,
}));
vi.mock("@/services/document-job-context", () => ({
  attachDocumentJobContext: m.attachDocumentJobContext,
  assertDealInWorkspace: m.assertDealInWorkspace,
}));
vi.mock("@/services/render-jobs", () => ({ jobAnlegen: m.jobAnlegen }));

import { POST } from "./route";

const WS = "ws_kottke";
const fetchMock = vi.fn();

function run(skill: string, params: Record<string, unknown>) {
  return POST(
    new NextRequest("https://crm.test/api/tools/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skill, params }),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ job_id: "job_42" }), { status: 200 }));
  m.getAuthContext.mockResolvedValue({ userId: "usr_1", workspaceId: WS });
  m.jobAnlegen.mockResolvedValue(undefined);
  m.assertDealInWorkspace.mockResolvedValue(true);
  m.attachDocumentJobContext.mockImplementation(async (_ws: string, p: Record<string, unknown>) => ({
    params: { ...p, preise: { modell: "pauschale" } },
    kv: p.document_type === "KV" ? { calculationVersionId: "ver_3", priceCents: 172000 } : null,
  }));
});

describe("POST /api/tools/run: Job-Register", () => {
  it("KV mit Deal: Eintrag mit Version und Preis aus dem Dokumentkontext", async () => {
    const res = await run("rechnungen-und-auftragsbestaetigungen", {
      firma: "kottke",
      document_type: "KV",
      _deal_record_id: "deal_1",
      _calculation_version_id: "ver_browser",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ job_id: "job_42" });
    expect(m.jobAnlegen).toHaveBeenCalledWith({
      vpsJobId: "job_42",
      workspaceId: WS,
      dealRecordId: "deal_1",
      documentType: "quotation",
      calculationVersionId: "ver_3",
      priceCents: 172000,
      createdBy: "usr_1",
    });
    // An den VPS gehen die Parameter aus dem Kontext, nicht die Version aus dem Browser.
    const gesendet = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(gesendet.params.preise).toEqual({ modell: "pauschale" });
  });

  it("AB und Rechnung: Eintrag ohne Version und Preis", async () => {
    await run("rechnungen-und-auftragsbestaetigungen", { document_type: "AB", _deal_record_id: "deal_1" });
    await run("rechnungen-und-auftragsbestaetigungen", { document_type: "RE", _deal_record_id: "deal_1" });
    expect(m.jobAnlegen.mock.calls.map((c) => [c[0].documentType, c[0].calculationVersionId, c[0].priceCents])).toEqual([
      ["order_confirmation", null, null],
      ["invoice", null, null],
    ]);
  });

  it("ohne Deal: kein Eintrag", async () => {
    const res = await run("rechnungen-und-auftragsbestaetigungen", { document_type: "KV" });
    expect(res.status).toBe(200);
    expect(m.jobAnlegen).not.toHaveBeenCalled();
  });

  it("Auftragsanweisung mit Deal: Eintrag als worker_instructions (Fund 4)", async () => {
    const res = await run("auftragsanweisung", { _deal_record_id: "deal_1" });
    expect(res.status).toBe(200);
    expect(m.assertDealInWorkspace).toHaveBeenCalledWith(WS, "deal_1");
    expect(m.jobAnlegen).toHaveBeenCalledWith({
      vpsJobId: "job_42",
      workspaceId: WS,
      dealRecordId: "deal_1",
      documentType: "worker_instructions",
      calculationVersionId: null,
      priceCents: null,
      createdBy: "usr_1",
    });
  });

  it("Auftragsanweisung mit fremdem Deal: 400, kein Job, kein Eintrag", async () => {
    m.assertDealInWorkspace.mockResolvedValue(false);
    const res = await run("auftragsanweisung", { _deal_record_id: "deal_x" });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(m.jobAnlegen).not.toHaveBeenCalled();
  });

  it("Auftragsanweisung ohne Deal und echo-test: kein Eintrag", async () => {
    await run("auftragsanweisung", {});
    await run("echo-test", { _deal_record_id: "deal_1", document_type: "KV" });
    expect(m.jobAnlegen).not.toHaveBeenCalled();
  });

  it("Upstream-Fehler: kein Eintrag", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ detail: "kaputt" }), { status: 500 }));
    const res = await run("rechnungen-und-auftragsbestaetigungen", { document_type: "KV", _deal_record_id: "deal_1" });
    expect(res.status).toBe(500);
    expect(m.jobAnlegen).not.toHaveBeenCalled();
  });

  it("fremder Deal: 400 aus dem Dokumentkontext, kein Job, kein Eintrag", async () => {
    m.attachDocumentJobContext.mockRejectedValue(new Error("Auftrag gehört nicht zu diesem Workspace."));
    const res = await run("rechnungen-und-auftragsbestaetigungen", { document_type: "KV", _deal_record_id: "deal_x" });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(m.jobAnlegen).not.toHaveBeenCalled();
  });

  it("Register schlägt fehl: sichtbarer Fehler statt stiller Job ohne Ablage", async () => {
    m.jobAnlegen.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await run("rechnungen-und-auftragsbestaetigungen", { document_type: "KV", _deal_record_id: "deal_1" });
    expect(res.status).toBe(500);
  });
});
