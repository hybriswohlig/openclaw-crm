// Project risk register (spec §4.5). Creating a risk with severity 'hoch'
// notifies the whole workspace (spec §10.2).

import { db } from "@/db";
import { projectRisks, projects } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import {
  normalizeRiskSeverity,
  normalizeRiskStatus,
  type RiskSeverity,
  type RiskStatus,
} from "@/lib/project-constants";
import { notifyProjectEvent, recordProjectEvent } from "./activity-events";

export interface RiskData {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  severity: RiskSeverity;
  likelihood: RiskSeverity | null;
  status: RiskStatus;
  mitigation: string | null;
  ownerUserId: string | null;
  createdAt: Date;
}

export interface RiskWriteValues {
  title: string;
  description: string | null;
  severity: RiskSeverity;
  likelihood: RiskSeverity | null;
  status: RiskStatus;
  mitigation: string | null;
  ownerUserId: string | null;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** Pure: raw create body → column values, or a German error. */
export function resolveRiskCreate(
  input: unknown,
): { ok: true; values: RiskWriteValues } | { ok: false; error: string } {
  const body = (input ?? {}) as Record<string, unknown>;
  const title = str(body.title);
  if (!title) return { ok: false, error: "Titel ist erforderlich." };

  // Create REJECTS an unknown severity, exactly like resolveRiskUpdate does.
  // Coercing it to "mittel" meant a typo in "hoch" silently downgraded the
  // risk AND suppressed the §10.2 workspace notification — the one severity
  // where being wrong actually costs something.
  let severity: RiskSeverity = "mittel";
  if (body.severity !== undefined && body.severity !== null && body.severity !== "") {
    const normalized = normalizeRiskSeverity(body.severity);
    if (!normalized) return { ok: false, error: "Ungültige Risiko-Schwere." };
    severity = normalized;
  }
  let status: RiskStatus = "offen";
  if (body.status !== undefined && body.status !== null && body.status !== "") {
    const normalized = normalizeRiskStatus(body.status);
    if (!normalized) return { ok: false, error: "Ungültiger Risiko-Status." };
    status = normalized;
  }

  return {
    ok: true,
    values: {
      title,
      description: str(body.description),
      severity,
      likelihood: normalizeRiskSeverity(body.likelihood),
      status,
      mitigation: str(body.mitigation),
      ownerUserId: str(body.ownerUserId),
    },
  };
}

/** Pure: raw patch body → the columns to SET, or a German error. */
export function resolveRiskUpdate(
  updates: unknown,
): { ok: true; set: Record<string, unknown> } | { ok: false; error: string } {
  const body = (updates ?? {}) as Record<string, unknown>;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  const set: Record<string, unknown> = {};

  if (has("title")) {
    const title = str(body.title);
    if (!title) return { ok: false, error: "Titel darf nicht leer sein." };
    set.title = title;
  }
  if (has("description")) set.description = str(body.description);
  if (has("mitigation")) set.mitigation = str(body.mitigation);
  if (has("ownerUserId")) set.ownerUserId = str(body.ownerUserId);
  if (has("severity")) {
    const severity = normalizeRiskSeverity(body.severity);
    if (!severity) return { ok: false, error: "Ungültige Risiko-Schwere." };
    set.severity = severity;
  }
  if (has("likelihood")) set.likelihood = normalizeRiskSeverity(body.likelihood);
  if (has("status")) {
    const status = normalizeRiskStatus(body.status);
    if (!status) return { ok: false, error: "Ungültiger Risiko-Status." };
    set.status = status;
  }
  return { ok: true, set };
}

function toRiskData(row: typeof projectRisks.$inferSelect): RiskData {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    severity: normalizeRiskSeverity(row.severity) ?? "mittel",
    likelihood: normalizeRiskSeverity(row.likelihood),
    status: normalizeRiskStatus(row.status) ?? "offen",
    mitigation: row.mitigation,
    ownerUserId: row.ownerUserId,
    createdAt: row.createdAt,
  };
}

async function loadProject(workspaceId: string, projectId: string) {
  const [row] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

export async function listRisks(workspaceId: string, projectId: string): Promise<RiskData[]> {
  const rows = await db
    .select()
    .from(projectRisks)
    .where(and(eq(projectRisks.workspaceId, workspaceId), eq(projectRisks.projectId, projectId)))
    .orderBy(asc(projectRisks.createdAt));
  return rows.map(toRiskData);
}

export async function createRisk(
  workspaceId: string,
  projectId: string,
  /** Who performed this — the actor of the activity row. */
  userId: string,
  input: {
    title: string;
    description?: string | null;
    severity?: string | null;
    likelihood?: string | null;
    mitigation?: string | null;
    ownerUserId?: string | null;
  },
): Promise<RiskData | null> {
  const project = await loadProject(workspaceId, projectId);
  if (!project) return null;

  const parsed = resolveRiskCreate(input);
  if (!parsed.ok) throw new Error(parsed.error);

  const [row] = await db
    .insert(projectRisks)
    .values({ workspaceId, projectId, ...parsed.values })
    .returning();

  const risk = toRiskData(row);
  // Spec §10.1 records project.risk_opened for EVERY new risk; §10.2 only
  // notifies the workspace when the severity is 'hoch'. So the activity row
  // is unconditional and the fan-out is the thing that is gated.
  const notifyWorkspace = risk.severity === "hoch" && risk.status !== "geschlossen";
  const event = {
    workspaceId,
    projectId,
    projectName: project.name,
    eventType: "project.risk_opened" as const,
    // The ACTOR. `ownerUserId` is who the risk is assigned to — the subject —
    // and is frequently null, which is how these rows lost their author.
    actorId: userId,
    title: notifyWorkspace ? "Neues Risiko mit hoher Schwere" : "Neues Risiko",
    body: `${project.name}: ${risk.title}`,
    payload: { riskId: risk.id, severity: risk.severity },
  };
  if (notifyWorkspace) await notifyProjectEvent(event);
  else await recordProjectEvent(event);
  return risk;
}

export async function updateRisk(
  workspaceId: string,
  /** Who performed this — the actor of the activity row. */
  userId: string,
  riskId: string,
  updates: Partial<{
    title: string;
    description: string | null;
    severity: string;
    likelihood: string | null;
    status: string;
    mitigation: string | null;
    ownerUserId: string | null;
  }>,
): Promise<RiskData | null> {
  const [existing] = await db
    .select()
    .from(projectRisks)
    .where(and(eq(projectRisks.id, riskId), eq(projectRisks.workspaceId, workspaceId)))
    .limit(1);
  if (!existing) return null;

  const parsed = resolveRiskUpdate(updates);
  if (!parsed.ok) throw new Error(parsed.error);

  let row = existing;
  if (Object.keys(parsed.set).length > 0) {
    const [updated] = await db
      .update(projectRisks)
      .set(parsed.set)
      .where(eq(projectRisks.id, riskId))
      .returning();
    if (!updated) return null;
    row = updated;
  }

  const risk = toRiskData(row);
  if (existing.status !== "geschlossen" && risk.status === "geschlossen") {
    const project = await loadProject(workspaceId, risk.projectId);
    if (project) {
      // Not a §10.2 notification trigger → activity row only.
      await recordProjectEvent({
        workspaceId,
        projectId: risk.projectId,
        projectName: project.name,
        eventType: "project.risk_closed",
        // The ACTOR — whoever closed it — not the risk's owner.
        actorId: userId,
        title: "Risiko geschlossen",
        body: `${project.name}: ${risk.title}`,
        payload: { riskId: risk.id },
      });
    }
  }
  return risk;
}

export async function deleteRisk(workspaceId: string, riskId: string): Promise<boolean> {
  const deleted = await db
    .delete(projectRisks)
    .where(and(eq(projectRisks.id, riskId), eq(projectRisks.workspaceId, workspaceId)))
    .returning({ id: projectRisks.id });
  return deleted.length > 0;
}
