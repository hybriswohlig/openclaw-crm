"use client";

// Compatibility wrapper. The real dialog now lives in
// components/work/task-dialog.tsx; this file only preserves the old prop
// signature for its remaining callers:
//   - components/layout/command-palette.tsx (must not be modified)
//   - components/tasks/record-tasks.tsx
// task-list.tsx and task-kanban.tsx — the pre-Projekte task views that used
// to be the other two callers — were deleted in Task 48, and with them the
// last reason to carry the four Kanban/story-point-era optional fields on
// LegacyTaskFormData: neither remaining caller ever set them, so they are
// gone rather than kept as dead optional fields.
import { WorkTaskDialog, type WorkTaskSavePayload } from "@/components/work/task-dialog";
import type { TaskJSON } from "@/lib/work-types";

interface LegacyTaskFormData {
  id?: string;
  content: string;
  deadline: Date | null;
  assigneeIds: string[];
  recordIds: string[];
  linkedRecords?: { id: string; displayName: string; objectSlug: string }[];
  assignees?: { id: string; name: string; email: string }[];
  description?: string | null;
  priority?: string | null;
  createdBy?: string | null;
  createdAt?: string | null;
  sprintId?: string | null;
  // C1 fix: these carry the record-linked task's real state through the
  // edit round-trip. All optional so callers that only ever create tasks
  // (command-palette.tsx) or don't know these values yet keep compiling —
  // toTaskJSON falls back to the old hardcoded defaults only when a field is
  // genuinely absent, never when the caller supplied it.
  isCompleted?: boolean;
  completedAt?: string | null;
  parentTaskId?: string | null;
  kind?: "projekt" | "operativ";
  projectId?: string | null;
  projectName?: string | null;
  phaseId?: string | null;
  area?: string | null;
  status?: string | null;
  startDate?: string | null;
}

// C1a: outbound half of the legacy bridge. WorkTaskDialog always sends
// status/startDate/projectId/phaseId on save (its controls render live
// values for all four), so the legacy onSave payload must carry them too —
// optional here only so a hypothetical caller that predates this fix would
// still type-check, not because the dialog ever omits them.
export interface LegacyOnSavePayload {
  content: string;
  // C7: absent (undefined) when WorkTaskDialog left the deadline
  // unchanged — must stay absent all the way out to the PATCH body (see
  // buildLegacySaveData), not be reconstructed into an explicit value, or
  // every save re-arms the workspace-wide overdue push for a deadline that
  // never changed (services/tasks.ts: `if (updates.deadline !== undefined)
  // ... overdueNotifiedAt = null`).
  deadline?: string | null;
  recordIds: string[];
  assigneeIds: string[];
  sprintId: string | null;
  description: string | null;
  priority: string | null;
  kind: "projekt" | "operativ";
  area: string | null;
  status?: string | null;
  startDate?: string | null;
  projectId?: string | null;
  phaseId?: string | null;
}

export interface TaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initialData?: LegacyTaskFormData;
  currentUserId?: string;
  defaultRecordId?: string;
  defaultRecordName?: string;
  defaultRecordSlug?: string;
  defaultContent?: string;
  defaultDeadline?: Date | null;
  defaultSprintId?: string | null;
  defaultArea?: string | null;
  onSave: (data: LegacyOnSavePayload) => Promise<void>;
  onDelete?: () => Promise<void>;
}

/**
 * Turns the legacy form shape into the TaskJSON the new dialog expects.
 *
 * C1: this used to fabricate isCompleted/completedAt/sprintId/parentTaskId/
 * kind/projectId/projectName/phaseId/area/status/startDate instead of
 * reading them off `d`. WorkTaskDialog seeds its edit form from this object
 * and sends every one of these fields back unconditionally on save (see its
 * WorkTaskSavePayload), so the fabricated values silently overwrote the
 * real ones on every edit of a record-linked task: Bereich erased, project
 * and sprint membership dropped, and a done task reopened. Every field here
 * must now come from `d` when the caller supplied it, falling back to the
 * old defaults only when it did not.
 */
export function toTaskJSON(d: LegacyTaskFormData | undefined): TaskJSON | null {
  if (!d?.id) return null;
  return {
    id: d.id,
    content: d.content,
    deadline: d.deadline ? d.deadline.toISOString() : null,
    isCompleted: d.isCompleted ?? false,
    completedAt: d.completedAt ?? null,
    createdBy: d.createdBy ?? null,
    createdAt: d.createdAt ?? new Date().toISOString(),
    linkedRecords: d.linkedRecords ?? [],
    assignees: d.assignees ?? [],
    sprintId: d.sprintId ?? null,
    description: d.description ?? null,
    priority: (d.priority as TaskJSON["priority"]) ?? null,
    parentTaskId: d.parentTaskId ?? null,
    kind: d.kind ?? "operativ",
    projectId: d.projectId ?? null,
    projectName: d.projectName ?? null,
    phaseId: d.phaseId ?? null,
    area: (d.area as TaskJSON["area"]) ?? null,
    status: (d.status as TaskJSON["status"]) ?? "geplant",
    startDate: d.startDate ?? null,
  };
}

/**
 * C1a: turns WorkTaskDialog's save data (WorkTaskSavePayload) into the
 * payload the legacy onSave callers PATCH/POST. Pure and exported so the
 * guard test can assert the outbound payload without mounting a DOM.
 *
 * Previously this logic lived inline in the onSave prop and dropped
 * status/startDate/projectId/phaseId entirely. Losing status/startDate
 * silently discarded real edits (success toast, PATCH body never contained
 * the field, fetchTasks() repaints the old value). Losing projectId/phaseId
 * alongside kind:"projekt" was worse: resolveTaskKind (services/tasks.ts)
 * sees no `projectId` key in the PATCH body, falls back to the row's
 * current projectId (null), and resolves the kind back to "operativ" — the
 * task never moves to the project, and `area: null` (sent because the
 * dialog now believes this is a project task) wipes the task's Bereich.
 * Forwarding projectId/phaseId here keeps kind and projectId consistent in
 * the same payload.
 */
export function buildLegacySaveData(data: WorkTaskSavePayload): LegacyOnSavePayload {
  return {
    content: data.content,
    // C7: WorkTaskSavePayload.deadline is OMITTED (undefined) when the user
    // left it unchanged (see WorkTaskDialog's R8 comment: the server treats
    // any PRESENT value — including an unchanged one re-sent verbatim — as
    // an edit and re-arms the overdue push). This used to reconstruct an
    // explicit value here whenever `data.deadline` was undefined (falling
    // back to `initialData.deadline`), which defeated that omission and
    // re-armed the notification on every single save, changed or not.
    //
    // Forwarding `data.deadline` as-is is safe precisely because
    // WorkTaskDialog already distinguishes all three cases before this
    // function ever sees them: absent (undefined) when unchanged, `null`
    // when the user explicitly cleared it, and an ISO string when it
    // changed to a new value (see handleSave's `deadlineChanged`/
    // `sameDay` logic there). The one legacy caller (record-tasks.tsx)
    // builds its PATCH/POST body with `JSON.stringify(data)`, which drops
    // an `undefined`-valued property from the JSON entirely — so an
    // unchanged deadline now correctly never appears in the request body
    // at all, matching what the four direct WorkTaskDialog callers
    // (page.tsx, operative/page.tsx, tasks-tab.tsx, timeline-tab.tsx) that
    // never bridge through here already do.
    deadline: data.deadline,
    recordIds: data.recordIds,
    assigneeIds: data.assigneeIds,
    sprintId: data.sprintId,
    description: data.description,
    priority: data.priority,
    kind: data.kind,
    area: data.area,
    status: data.status,
    startDate: data.startDate,
    projectId: data.projectId,
    phaseId: data.phaseId,
  };
}

export function TaskDialog(props: TaskDialogProps) {
  return (
    <WorkTaskDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      mode={props.mode}
      task={toTaskJSON(props.initialData)}
      currentUserId={props.currentUserId}
      defaultKind="operativ"
      defaultArea={props.defaultArea ?? null}
      defaultSprintId={props.defaultSprintId ?? null}
      defaultContent={props.defaultContent}
      defaultDeadline={props.defaultDeadline ?? null}
      defaultRecordId={props.defaultRecordId}
      defaultRecordName={props.defaultRecordName}
      defaultRecordSlug={props.defaultRecordSlug}
      onSave={async (data) => props.onSave(buildLegacySaveData(data))}
      onDelete={props.onDelete}
    />
  );
}
