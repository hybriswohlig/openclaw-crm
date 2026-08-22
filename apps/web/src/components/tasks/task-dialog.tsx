"use client";

// Compatibility wrapper. The real dialog now lives in
// components/work/task-dialog.tsx; this file only preserves the old prop
// signature for its remaining callers:
//   - components/layout/command-palette.tsx (must not be modified)
//   - components/tasks/record-tasks.tsx
//   - components/tasks/task-list.tsx
//   - components/tasks/task-kanban.tsx
// (four call sites, not the two originally assumed by the plan — the extra
// two, task-list.tsx and task-kanban.tsx, are the pre-Projekte task views;
// task-kanban.tsx in particular still populates the removed fields on
// initialData, so LegacyTaskFormData carries them as optional below purely
// to keep that call site type-checking. They are never read.)
// The removed fields (pointEstimate, workType, growthCategory, kanbanStatus)
// are still passed to onSave as null so all call sites keep type-checking.
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
  // Present only so task-kanban.tsx's initialData object literal (which
  // still sets these) keeps type-checking. The new dialog does not read them.
  pointEstimate?: number | null;
  sprintId?: string | null;
  workType?: string | null;
  growthCategory?: string | null;
  kanbanStatus?: string | null;
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
    pointEstimate: number | null;
    sprintId: string | null;
    workType: string | null;
    growthCategory: string | null;
    description: string | null;
    priority: string | null;
    kanbanStatus?: string | null;
    kind: "projekt" | "operativ";
    area: string | null;
  }) => Promise<void>;
  onDelete?: () => Promise<void>;
}

/** Turns the legacy form shape into the TaskJSON the new dialog expects. */
function toTaskJSON(d: LegacyTaskFormData | undefined): TaskJSON | null {
  if (!d?.id) return null;
  return {
    id: d.id,
    content: d.content,
    deadline: d.deadline ? d.deadline.toISOString() : null,
    isCompleted: false,
    completedAt: null,
    createdBy: d.createdBy ?? null,
    createdAt: d.createdAt ?? new Date().toISOString(),
    linkedRecords: d.linkedRecords ?? [],
    assignees: d.assignees ?? [],
    sprintId: null,
    description: d.description ?? null,
    priority: (d.priority as TaskJSON["priority"]) ?? null,
    parentTaskId: null,
    kind: "operativ",
    projectId: null,
    projectName: null,
    phaseId: null,
    area: null,
    status: "geplant",
    startDate: null,
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
          pointEstimate: null,
          sprintId: data.sprintId,
          workType: null,
          growthCategory: null,
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
