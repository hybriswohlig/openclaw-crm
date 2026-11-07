import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { RENDER_JOB_ABLAUF_MS, type RenderJob } from "@/lib/angebot-wahl";

// Cron legt fertige VPS-Dokumente ab, auch ohne offenen Browser (Plan 5a, K3).
// Register als Speicher im Test (Semantik wie Task B), VPS als Upstream-Mock.
const m = vi.hoisted(() => {
  process.env.CRM_TOOLS_API_URL = "https://crm-tools.test";
  process.env.CRM_TOOLS_AUTH_TOKEN = "tools-token";
  process.env.CRON_SECRET = "geheim";
  return {
    jobs: new Map<string, RenderJob>(),
    createDealDocument: vi.fn(),
    angebotsVersionId: vi.fn(),
  };
});

const RESERVIERUNG = 2 * 60 * 1000;
vi.mock("@/services/render-jobs", () => ({
  jobLaden: async (ws: string, id: string) => {
    const j = m.jobs.get(id);
    return j && j.workspaceId === ws ? { ...j } : null;
  },
  jobReservieren: async (ws: string, id: string, jetzt: Date) => {
    const j = m.jobs.get(id);
    if (!j || j.workspaceId !== ws || j.status !== "laeuft") return null;
    if (j.claimedAt && jetzt.getTime() - new Date(j.claimedAt).getTime() < RESERVIERUNG) return null;
    j.claimedAt = jetzt.toISOString();
    return { ...j };
  },
  jobAbschliessen: async (
    ws: string,
    id: string,
    e: { status: RenderJob["status"]; dealDocumentId?: string; fehler?: string }
  ) => {
    const j = m.jobs.get(id);
    if (j && j.workspaceId === ws) Object.assign(j, { status: e.status, dealDocumentId: e.dealDocumentId ?? null, fehler: e.fehler ?? null });
  },
  offeneJobs: async (grenze: Date, limit: number) =>
    [...m.jobs.values()]
      .filter((j) => j.status === "laeuft" && (j.claimedAt === null || new Date(j.claimedAt) < grenze))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit)
      .map((j) => ({ ...j })),
  jobsAbgelaufenMarkieren: async (jetzt: Date) => {
    let n = 0;
    for (const j of m.jobs.values()) {
      if (j.status === "laeuft" && jetzt.getTime() - new Date(j.createdAt).getTime() > 24 * 60 * 60 * 1000) {
        Object.assign(j, { status: "fehler", fehler: "abgelaufen" });
        n++;
      }
    }
    return n;
  },
}));
vi.mock("@/services/deal-documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/deal-documents")>()),
  createDealDocument: m.createDealDocument,
  angebotsVersionId: m.angebotsVersionId,
}));
vi.mock("@/services/rechnung-faellig", () => ({ applyInvoiceDueDate: async () => ({ rechnungFaelligAm: null }) }));

import { GET } from "./route";

const fetchMock = vi.fn();

function job(id: string, teil: Partial<RenderJob> = {}) {
  m.jobs.set(id, {
    vpsJobId: id,
    workspaceId: "ws_kottke",
    dealRecordId: `deal_${id}`,
    documentType: "quotation",
    calculationVersionId: "ver_3",
    priceCents: 172000,
    status: "laeuft",
    createdBy: "usr_1",
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    claimedAt: null,
    storedAt: null,
    dealDocumentId: null,
    fehler: null,
    ...teil,
  });
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
  m.jobs.clear();
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  m.angebotsVersionId.mockResolvedValue("ver_3");
  let n = 0;
  m.createDealDocument.mockImplementation(async (i: { documentType: string; fileName: string; fileSize: number }) => ({
    id: `doc_${++n}`,
    documentType: i.documentType,
    fileName: i.fileName,
    fileSize: i.fileSize,
    mimeType: "application/pdf",
    uploadedAt: new Date(),
  }));
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
});
