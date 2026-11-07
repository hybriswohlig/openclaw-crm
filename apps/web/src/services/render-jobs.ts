/**
 * Speicher für `document_render_jobs` (Migration 0060).
 * Jede Abfrage filtert nach `workspace_id`, außer `offeneJobs` und
 * `jobsAbgelaufenMarkieren` (Cron, über alle Workspaces).
 */
import { and, asc, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { documentRenderJobs, type DocumentRenderJobRow } from "@/db/schema/document-render-jobs";
import {
  RENDER_JOB_ABLAUF_MS,
  RENDER_JOB_RESERVIERUNG_MS,
  type RenderJob,
} from "@/lib/angebot-wahl";

type NeuerJob = Omit<RenderJob, "status" | "createdAt" | "claimedAt" | "storedAt" | "dealDocumentId" | "fehler">;

function iso(wert: Date | string): string {
  return (wert instanceof Date ? wert : new Date(wert)).toISOString();
}

function zuJob(row: DocumentRenderJobRow): RenderJob {
  return {
    vpsJobId: row.vpsJobId,
    workspaceId: row.workspaceId,
    dealRecordId: row.dealRecordId,
    documentType: row.documentType,
    calculationVersionId: row.calculationVersionId,
    priceCents: row.priceCents,
    status: row.status,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    claimedAt: row.claimedAt === null ? null : iso(row.claimedAt),
    storedAt: row.storedAt === null ? null : iso(row.storedAt),
    dealDocumentId: row.dealDocumentId,
    fehler: row.fehler,
  };
}

/** Legt den Job an. Dieselbe `vps_job_id` ein zweites Mal ändert nichts. */
export async function jobAnlegen(j: NeuerJob): Promise<void> {
  await db
    .insert(documentRenderJobs)
    .values({
      vpsJobId: j.vpsJobId,
      workspaceId: j.workspaceId,
      dealRecordId: j.dealRecordId,
      documentType: j.documentType,
      calculationVersionId: j.calculationVersionId,
      priceCents: j.priceCents,
      createdBy: j.createdBy,
    })
    .onConflictDoNothing({ target: documentRenderJobs.vpsJobId });
}

export async function jobLaden(ws: string, vpsJobId: string): Promise<RenderJob | null> {
  const [row] = await db
    .select()
    .from(documentRenderJobs)
    .where(and(eq(documentRenderJobs.workspaceId, ws), eq(documentRenderJobs.vpsJobId, vpsJobId)))
    .limit(1);
  return row ? zuJob(row) : null;
}

/**
 * Reserviert den Job in einer Anweisung. Es gewinnt, wer `laeuft` trifft und
 * keine Reservierung jünger als RENDER_JOB_RESERVIERUNG_MS vorfindet.
 */
export async function jobReservieren(ws: string, vpsJobId: string, jetzt: Date): Promise<RenderJob | null> {
  const grenze = new Date(jetzt.getTime() - RENDER_JOB_RESERVIERUNG_MS);
  const [row] = await db
    .update(documentRenderJobs)
    .set({ claimedAt: jetzt })
    .where(
      and(
        eq(documentRenderJobs.workspaceId, ws),
        eq(documentRenderJobs.vpsJobId, vpsJobId),
        eq(documentRenderJobs.status, "laeuft"),
        or(isNull(documentRenderJobs.claimedAt), lt(documentRenderJobs.claimedAt, grenze)),
      ),
    )
    .returning();
  return row ? zuJob(row) : null;
}

/** Schließt den Job ab. `stored_at` setzt nur der Status `abgelegt` (`now()`). */
export async function jobAbschliessen(
  ws: string,
  vpsJobId: string,
  e: { status: "abgelegt" | "verworfen" | "fehler"; dealDocumentId?: string; fehler?: string },
): Promise<void> {
  await db
    .update(documentRenderJobs)
    .set({
      status: e.status,
      fehler: e.fehler ?? null,
      dealDocumentId: e.dealDocumentId,
      storedAt: e.status === "abgelegt" ? sql`now()` : undefined,
    })
    .where(and(eq(documentRenderJobs.workspaceId, ws), eq(documentRenderJobs.vpsJobId, vpsJobId)));
}

/**
 * Laufende Jobs, deren Reservierung fehlt oder älter als `grenze` ist,
 * älteste zuerst. Einzige lesende Abfrage ohne Workspace-Filter (Cron).
 */
export async function offeneJobs(grenze: Date, limit: number): Promise<RenderJob[]> {
  const rows = await db
    .select()
    .from(documentRenderJobs)
    .where(
      and(
        eq(documentRenderJobs.status, "laeuft"),
        or(isNull(documentRenderJobs.claimedAt), lt(documentRenderJobs.claimedAt, grenze)),
      ),
    )
    .orderBy(asc(documentRenderJobs.createdAt))
    .limit(limit);
  return rows.map(zuJob);
}

/** Neuester KV-Job (`quotation`) zu Deal und Version in diesem Workspace. */
export async function letzterKvJob(ws: string, deal: string, versionId: string): Promise<RenderJob | null> {
  const [row] = await db
    .select()
    .from(documentRenderJobs)
    .where(
      and(
        eq(documentRenderJobs.workspaceId, ws),
        eq(documentRenderJobs.dealRecordId, deal),
        eq(documentRenderJobs.calculationVersionId, versionId),
        eq(documentRenderJobs.documentType, "quotation"),
      ),
    )
    .orderBy(desc(documentRenderJobs.createdAt))
    .limit(1);
  return row ? zuJob(row) : null;
}

/**
 * Laufende Jobs älter als RENDER_JOB_ABLAUF_MS auf `fehler` / `abgelaufen` setzen.
 * Wie `offeneJobs` ohne Workspace-Filter (Cron). Gibt die Zahl der Zeilen zurück.
 */
export async function jobsAbgelaufenMarkieren(jetzt: Date): Promise<number> {
  const grenze = new Date(jetzt.getTime() - RENDER_JOB_ABLAUF_MS);
  const rows = await db
    .update(documentRenderJobs)
    .set({ status: "fehler", fehler: "abgelaufen" })
    .where(and(eq(documentRenderJobs.status, "laeuft"), lt(documentRenderJobs.createdAt, grenze)))
    .returning({ vpsJobId: documentRenderJobs.vpsJobId });
  return rows.length;
}
