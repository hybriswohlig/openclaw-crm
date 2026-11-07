/**
 * Nur für Tests: Job-Register und Ablage als Speicher, mit derselben Semantik
 * wie `render-jobs.ts` und `kv-job-ablage.ts` (Reservierung 2 Minuten, Abschluss
 * nur mit eigener Reservierung, Version unter der Sperre neu gelesen). Die echte
 * Transaktion prüft `kv-job-ablage.db.test.ts`.
 *
 * Einbinden: `vi.mock("@/services/render-jobs", async () => (await import("@/services/render-jobs.fake")).fake.renderJobs)`
 * und ebenso `fake.ablage` für `@/services/kv-job-ablage`.
 */
import { vi } from "vitest";
import {
  jobAblage,
  RENDER_JOB_ABLAUF_MS,
  RENDER_JOB_RESERVIERUNG_MS,
  type RenderJob,
} from "@/lib/angebot-wahl";

type Endstand =
  | { status: "abgelegt"; dealDocumentId: string }
  | { status: "verworfen" }
  | { status: "fehler"; fehler: string };

const jobs = new Map<string, RenderJob>();
const kopie = (j: RenderJob | undefined) => (j ? { ...j } : null);

function eigene(ws: string, id: string, claimedAt: string) {
  const j = jobs.get(id);
  return j && j.workspaceId === ws && j.status === "laeuft" && j.claimedAt === claimedAt ? j : null;
}

function setzen(j: RenderJob, e: Endstand) {
  j.status = e.status;
  j.dealDocumentId = e.status === "abgelegt" ? e.dealDocumentId : null;
  j.fehler = e.status === "fehler" ? e.fehler : null;
}

let n = 0;
type DokumentEingabe = {
  workspaceId: string;
  dealRecordId: string;
  documentType: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileContent: string;
  calculationVersionId: string | null;
};
const createDealDocument = vi.fn(async (input: DokumentEingabe) => ({
  id: `doc_${++n}`,
  documentType: input.documentType,
  fileName: input.fileName,
  fileSize: input.fileSize,
  mimeType: "application/pdf",
  uploadedAt: new Date("2026-11-07T10:00:00.000Z"),
}));
/** Version der Quotation beim Ablegen (unter der Sperre). */
const angebotsVersionId = vi.fn(async (_deal: string): Promise<string | null> => null);

export const fake = {
  jobs,
  createDealDocument,
  angebotsVersionId,
  job(teil: Partial<RenderJob> = {}): RenderJob {
    const j: RenderJob = {
      vpsJobId: "job_1",
      workspaceId: "ws_kottke",
      dealRecordId: "deal_1",
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
    };
    jobs.set(j.vpsJobId, j);
    return j;
  },
  reset() {
    jobs.clear();
    n = 0;
    createDealDocument.mockClear();
    angebotsVersionId.mockReset();
    angebotsVersionId.mockResolvedValue(null);
  },
  renderJobs: {
    jobLaden: async (ws: string, id: string) => {
      const j = jobs.get(id);
      return j && j.workspaceId === ws ? kopie(j) : null;
    },
    jobReservieren: async (ws: string, id: string, jetzt: Date) => {
      const j = jobs.get(id);
      if (!j || j.workspaceId !== ws || j.status !== "laeuft") return null;
      if (j.claimedAt && jetzt.getTime() - new Date(j.claimedAt).getTime() < RENDER_JOB_RESERVIERUNG_MS) return null;
      j.claimedAt = jetzt.toISOString();
      return kopie(j);
    },
    jobAnlegen: vi.fn(async () => {}),
    offeneJobs: async (grenze: Date, limit: number, documentType?: string) =>
      [...jobs.values()]
        .filter((j) => j.status === "laeuft" && (j.claimedAt === null || new Date(j.claimedAt) < grenze))
        .filter((j) => documentType === undefined || j.documentType === documentType)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, limit)
        .map((j) => ({ ...j })),
    jobsAbgelaufenMarkieren: async (jetzt: Date) => {
      let k = 0;
      for (const j of jobs.values()) {
        if (j.status === "laeuft" && jetzt.getTime() - new Date(j.createdAt).getTime() > RENDER_JOB_ABLAUF_MS) {
          setzen(j, { status: "fehler", fehler: "abgelaufen" });
          k++;
        }
      }
      return k;
    },
  },
  ablage: {
    abschliessenMitAnspruch: async (ws: string, id: string, claimedAt: string, e: Endstand) => {
      const j = eigene(ws, id, claimedAt);
      if (!j) return false;
      setzen(j, e);
      return true;
    },
    ablegenUnterSperre: async (
      job: RenderJob & { claimedAt: string },
      datei: { fileName: string; mimeType: string; fileSize: number; fileContent: string; documentType: string }
    ) => {
      const j = eigene(job.workspaceId, job.vpsJobId, job.claimedAt);
      if (!j) return { art: "verloren" as const };
      const version =
        job.documentType === "quotation" && job.calculationVersionId !== null
          ? await angebotsVersionId(job.dealRecordId)
          : null;
      const ablage = jobAblage(job, version);
      if (ablage === "verwerfen") {
        setzen(j, { status: "verworfen" });
        return { art: "verworfen" as const };
      }
      const dokument = await createDealDocument({
        workspaceId: job.workspaceId,
        dealRecordId: job.dealRecordId,
        ...datei,
        calculationVersionId: ablage === "mit_version" ? job.calculationVersionId : null,
      });
      setzen(j, { status: "abgelegt", dealDocumentId: dokument.id });
      return { art: "abgelegt" as const, dokument };
    },
  },
};
