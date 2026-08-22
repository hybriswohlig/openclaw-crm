/**
 * Workspace-scoped activity event emitter.
 *
 * Events are cheap, append-only rows used by the record activity timeline
 * and (later) cross-channel notification hints. Emit them from any write
 * path that the user should be able to see in history.
 */

import { db } from "@/db";
import { activityEvents } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";

export type ActivityEventType =
  | "message.received"
  | "message.sent"
  | "deal.stage_changed"
  | "call.received"
  | "call.summary_attached"
  | "ai.insights_extracted"
  | "ai.inventory_extracted"
  | "ai.inventory_photos_analyzed"
  | "deal.scope_changed_after_quote"
  | "deal.portal_photos_curated"
  | "customer.kva_confirmed"
  | "customer.marked_paid"
  | "customer.rated_crew"
  | "customer.date_offers_set"
  | "customer.date_selected"
  | "customer.package_selected"
  | "customer.package_options_set"
  | "customer.package_option_selected"
  | "customer.reschedule_requested"
  | "customer.question"
  | "customer.damage_reported"
  | "person.merge"
  | "person.unmerge"
  | "agent.action"
  | "portal.notification_sent"
  | "portal.notification_skipped"
  // Projekte & Operative Aufgaben (spec §10.1, plus project.member_role_changed
  // which the spec omitted). record_id holds a projects.id for the project.*
  // events and a tasks.id-bearing payload for the task.* ones.
  | "project.created"
  | "project.updated"
  | "project.status_changed"
  | "project.member_added"
  | "project.member_removed"
  | "project.member_role_changed"
  | "project.phase_created"
  | "project.phase_completed"
  | "project.milestone_reached"
  | "project.risk_opened"
  | "project.risk_closed"
  | "project.document_uploaded"
  | "project.budget_entry_added"
  | "task.moved_to_project"
  | "task.status_changed";

export interface EmitEventInput {
  workspaceId: string;
  recordId: string | null;
  objectSlug: string | null;
  eventType: ActivityEventType;
  payload?: Record<string, unknown>;
  actorId?: string | null;
}

export async function emitEvent(input: EmitEventInput): Promise<void> {
  try {
    await db.insert(activityEvents).values({
      workspaceId: input.workspaceId,
      recordId: input.recordId,
      objectSlug: input.objectSlug,
      eventType: input.eventType,
      payload: input.payload ?? {},
      actorId: input.actorId ?? null,
    });
  } catch (err) {
    // Never block the caller on telemetry failures.
    console.error("[activity-events] emit failed:", err);
  }
}

export async function listEvents(
  workspaceId: string,
  recordId: string,
  limit = 100
): Promise<(typeof activityEvents.$inferSelect)[]> {
  return db
    .select()
    .from(activityEvents)
    .where(
      and(eq(activityEvents.workspaceId, workspaceId), eq(activityEvents.recordId, recordId))
    )
    .orderBy(desc(activityEvents.createdAt))
    .limit(limit);
}

/** The Projekte-module subset, for filtering an activity feed. */
export const PROJECT_EVENT_TYPES: readonly ActivityEventType[] = [
  "project.created",
  "project.updated",
  "project.status_changed",
  "project.member_added",
  "project.member_removed",
  "project.member_role_changed",
  "project.phase_created",
  "project.phase_completed",
  "project.milestone_reached",
  "project.risk_opened",
  "project.risk_closed",
  "project.document_uploaded",
  "project.budget_entry_added",
  "task.moved_to_project",
  "task.status_changed",
] as const;

export interface ProjectEventInput {
  workspaceId: string;
  projectId: string;
  projectName: string;
  eventType: ActivityEventType;
  actorId: string | null;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
}

/** Shared plumbing: run the work in waitUntil, swallow every error. */
async function deferProjectWork(run: () => Promise<void>): Promise<void> {
  try {
    const { waitUntil } = await import("@vercel/functions");
    waitUntil(run());
  } catch {
    // @vercel/functions unavailable (local / scripts) → run inline.
    await run().catch(() => null);
  }
}

async function writeProjectActivity(input: ProjectEventInput): Promise<void> {
  try {
    await emitEvent({
      workspaceId: input.workspaceId,
      recordId: input.projectId,
      objectSlug: "projects",
      eventType: input.eventType,
      actorId: input.actorId,
      payload: { projectName: input.projectName, ...(input.payload ?? {}) },
    });
  } catch (err) {
    console.error("[project-events] emitEvent failed:", err);
  }
}

/**
 * Activity row ONLY — no notifications. This is the DEFAULT for every
 * project write.
 *
 * Why the split: `updateProject` is called by the Notizen tab's 1200 ms
 * autosave, so a minute of typing is a dozen writes. Fanning those out to
 * every workspace member would bury the notification bell. Spec §10.2 names
 * exactly four notification triggers; everything else records only.
 */
export async function recordProjectEvent(input: ProjectEventInput): Promise<void> {
  await deferProjectWork(() => writeProjectActivity(input));
}

/**
 * Activity row PLUS one in-app notification per workspace member.
 *
 * ONLY for the four triggers of spec §10.2: project.member_added,
 * project.status_changed, project.milestone_reached, and project.risk_opened
 * when severity === "hoch". Everything else uses recordProjectEvent.
 *
 * Fan-out pattern taken verbatim from services/scope-guard.ts:293-355.
 */
export async function notifyProjectEvent(input: ProjectEventInput): Promise<void> {
  const url = `/tasks/projects/${input.projectId}`;

  await deferProjectWork(async () => {
    await writeProjectActivity(input);
    try {
      const { listMembers } = await import("./workspace");
      const { createNotification } = await import("./notifications");
      const members = await listMembers(input.workspaceId);
      await Promise.all(
        members.map((m) =>
          createNotification({
            workspaceId: input.workspaceId,
            userId: m.userId,
            type: input.eventType,
            title: input.title,
            body: input.body,
            url,
            metadata: { projectId: input.projectId, ...(input.payload ?? {}) },
          }).catch(() => null),
        ),
      );
    } catch (err) {
      console.error("[project-events] notifyWorkspace failed:", err);
    }
  });
}
