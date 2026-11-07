import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { RENDER_JOB_ABLAUF_MS, type RenderJob } from "@/lib/angebot-wahl";

// Cron legt fertige VPS-Dokumente ab, auch ohne offenen Browser (Plan 5a, K3).
// Register als Speicher im Test (Semantik wie Task B), VPS als Upstream-Mock.
vi.hoisted(() => {
  process.env.CRM_TOOLS_API_URL = "https://crm-tools.test";
  process.env.CRM_TOOLS_AUTH_TOKEN = "tools-token";
  process.env.CRON_SECRET = "geheim";
});

vi.mock("@/services/render-jobs", async () => (await import("@/services/render-jobs.fake")).fake.renderJobs);
vi.mock("@/services/kv-job-ablage", async () => (await import("@/services/render-jobs.fake")).fake.ablage);
vi.mock("@/services/deal-documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/deal-documents")>()),
  dealDokumentNachlauf: async () => {},
}));
vi.mock("@/services/rechnung-faellig", () => ({ applyInvoiceDueDate: async () => ({ rechnungFaelligAm: null }) }));

import { GET } from "./route";
import { fake } from "@/services/render-jobs.fake";

const fetchMock = vi.fn();
const m = { jobs: fake.jobs, createDealDocument: fake.createDealDocument, angebotsVersionId: fake.angebotsVersionId };

function job(id: string, teil: Partial<RenderJob> = {}) {
  fake.job({ vpsJobId: id, dealRecordId: `deal_${id}`, ...teil });
}

/** VPS je Job: "done" (PDF), "running" oder 404. */
function vps(zustand: Record<string, "done" | "running" | 404>) {
  fetchMock.mockImplementation(async (url: string) => {
    const [, id, rest] = /\/jobs\/([^/]+)(\/result)?$/.exec(String(url)) ?? [];
    const z = zustand[id];
    if (z === 404) return new Response(JSON.stringify({ detail: "Job not found" }), { status: 404 });
    if (rest) {
      return new Response(new Uint8Array(Buffer.from("%PDF-1.7\n", "binary")), {
        status: 200,
        headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="KV-KO-${id}.pdf"` },
      });
    }
    return new Response(JSON.stringify({ status: z, error: null, result_filename: null }), { status: 200 });
  });
}

const cron = (auth = "Bearer geheim") =>
  GET(new NextRequest("https://crm.test/api/cron/render-jobs", { headers: auth ? { authorization: auth } : {} }));

beforeEach(() => {
  fake.reset();
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fake.angebotsVersionId.mockResolvedValue("ver_3");
});

describe("GET /api/cron/render-jobs", () => {
  it("nur mit CRON_SECRET", async () => {
    job("a");
    expect((await cron("")).status).toBe(401);
    expect((await cron("Bearer falsch")).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(m.jobs.get("a")?.status).toBe("laeuft");
  });

  it("fertig: legt ab, mit Version und im Workspace des Jobs", async () => {
    job("a", { workspaceId: "ws_ceylan" });
    vps({ a: "done" });
    const res = await cron();
    expect(await res.json()).toMatchObject({ ok: true, geprueft: 1, abgelegt: 1, abgelaufen: 0 });
    expect(m.createDealDocument).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws_ceylan", dealRecordId: "deal_a", calculationVersionId: "ver_3" })
    );
    expect(m.jobs.get("a")).toMatchObject({ status: "abgelegt", dealDocumentId: "doc_1" });
  });

  it("läuft noch: bleibt offen und unreserviert, nichts abgelegt", async () => {
    job("a");
    vps({ a: "running" });
    expect(await (await cron()).json()).toMatchObject({ geprueft: 1, laeuft: 1 });
    expect(m.jobs.get("a")).toMatchObject({ status: "laeuft", claimedAt: null });
    expect(m.createDealDocument).not.toHaveBeenCalled();
  });

  it("404 vom VPS: Job auf „fehler“", async () => {
    job("a");
    vps({ a: 404 });
    expect(await (await cron()).json()).toMatchObject({ geprueft: 1, fehler: 1 });
    expect(m.jobs.get("a")).toMatchObject({ status: "fehler", fehler: "Job auf dem VPS nicht mehr vorhanden" });
  });

  it("älter als 24 h: „fehler“ ohne Abruf beim VPS", async () => {
    job("alt", { createdAt: new Date(Date.now() - RENDER_JOB_ABLAUF_MS - 60_000).toISOString() });
    vps({ alt: "done" });
    expect(await (await cron()).json()).toMatchObject({ abgelaufen: 1, geprueft: 0 });
    expect(m.jobs.get("alt")).toMatchObject({ status: "fehler", fehler: "abgelaufen" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("veraltete Version: verworfen, nichts abgelegt", async () => {
    job("a");
    m.angebotsVersionId.mockResolvedValue("ver_4");
    vps({ a: "done" });
    expect(await (await cron()).json()).toMatchObject({ verworfen: 1 });
    expect(m.createDealDocument).not.toHaveBeenCalled();
  });

  it("gemischt in einem Lauf; ein zweiter Lauf legt nichts doppelt ab", async () => {
    job("fertig");
    job("laeuft");
    job("weg");
    vps({ fertig: "done", laeuft: "running", weg: 404 });
    expect(await (await cron()).json()).toMatchObject({ geprueft: 3, abgelegt: 1, laeuft: 1, fehler: 1 });
    expect(await (await cron()).json()).toMatchObject({ geprueft: 1, laeuft: 1 });
    expect(m.createDealDocument).toHaveBeenCalledTimes(1);
  });

  it("frisch vom Browser reserviert: Cron lässt den Job in Ruhe", async () => {
    job("a", { claimedAt: new Date().toISOString() });
    vps({ a: "done" });
    expect(await (await cron()).json()).toMatchObject({ geprueft: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Rechnung und AB lässt der Cron liegen (Fälligkeit legt Browser oder MCP fest, Fund 5)", async () => {
    job("re", { documentType: "invoice", calculationVersionId: null });
    job("ab", { documentType: "order_confirmation", calculationVersionId: null });
    vps({ re: "done", ab: "done" });
    expect(await (await cron()).json()).toMatchObject({ geprueft: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(m.jobs.get("re")?.status).toBe("laeuft");
  });

  it("Rechnung nach 24 h trotzdem „fehler“", async () => {
    job("re", {
      documentType: "invoice",
      calculationVersionId: null,
      createdAt: new Date(Date.now() - RENDER_JOB_ABLAUF_MS - 60_000).toISOString(),
    });
    expect(await (await cron()).json()).toMatchObject({ abgelaufen: 1, geprueft: 0 });
    expect(m.jobs.get("re")).toMatchObject({ status: "fehler", fehler: "abgelaufen" });
  });
});
