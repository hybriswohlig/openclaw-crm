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
import { WorkTaskDialog } from "@/components/work/task-dialog";
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
  onSave: (data: {
    content: string;
    deadline: string | null;
    recordIds: string[];
    assigneeIds: string[];
    sprintId: string | null;
    description: string | null;
    priority: string | null;
    kind: "projekt" | "operativ";
    area: string | null;
  }) => Promise<void>;
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
      onSave={async (data) =>
        props.onSave({
          content: data.content,
          // WorkTaskSavePayload.deadline is OMITTED (undefined) when the
          // user left it unchanged (see WorkTaskDialog's R8 comment: the
          // server treats any present value as an edit and re-arms the
          // overdue push). The legacy callers below always send `deadline`
          // in their PATCH body, though, so an omitted value here must fall
          // back to the deadline the dialog was seeded with — sending `null`
          // instead would silently clear it on every no-op edit.
          deadline:
            data.deadline !== undefined
              ? data.deadline
              : props.initialData?.deadline
                ? props.initialData.deadline.toISOString()
                : null,
          recordIds: data.recordIds,
          assigneeIds: data.assigneeIds,
          sprintId: data.sprintId,
          description: data.description,
          priority: data.priority,
          kind: data.kind,
          area: data.area,
        })
      }
      onDelete={props.onDelete}
    />
  );
}
