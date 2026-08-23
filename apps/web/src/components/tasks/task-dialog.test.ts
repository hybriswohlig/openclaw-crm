import { describe, it, expect } from "vitest";
import { toTaskJSON, buildLegacySaveData } from "./task-dialog";
import type { WorkTaskSavePayload } from "@/components/work/task-dialog";

// C1 guard test: toTaskJSON used to fabricate isCompleted/completedAt/
// sprintId/parentTaskId/kind/projectId/projectName/phaseId/area/status/
// startDate instead of reading them off the legacy form data. WorkTaskDialog
// seeds its edit form from this object's output and sends every one of these
// fields back unconditionally on save, so any fabricated field here silently
// overwrites the real value in the database on the next edit. A test that
// only checks `area` is not sufficient — assert every field the brief calls
// out, all in one legacy payload the way a record-linked task edit actually
// arrives.
describe("toTaskJSON", () => {
  it("returns null when the legacy data has no id (create mode)", () => {
    expect(
      toTaskJSON({
        content: "Neue Aufgabe",
        deadline: null,
        assigneeIds: [],
        recordIds: [],
      }),
    ).toBeNull();
  });

  it("preserves kind, project, phase, area, status, sprint and completion from a record-linked task edit", () => {
    const deadline = new Date("2026-09-01T10:00:00.000Z");
    const result = toTaskJSON({
      id: "t1",
      content: "Rückruf vereinbaren",
      deadline,
      assigneeIds: ["u1"],
      recordIds: ["r1"],
      linkedRecords: [{ id: "r1", displayName: "Deal 1", objectSlug: "deals" }],
      assignees: [{ id: "u1", name: "Ada", email: "ada@example.com" }],
      description: "Kunde zurückrufen",
      priority: "hoch",
      createdBy: "u2",
      createdAt: "2026-08-01T00:00:00.000Z",
      sprintId: "s1",
      isCompleted: true,
      completedAt: "2026-08-20T12:00:00.000Z",
      parentTaskId: "parent1",
      kind: "projekt",
      projectId: "p1",
      projectName: "Umzugsprojekt",
      phaseId: "ph1",
      area: "kunde",
      status: "laeuft",
      startDate: "2026-08-15",
    });

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      id: "t1",
      content: "Rückruf vereinbaren",
      deadline: deadline.toISOString(),
      isCompleted: true,
      completedAt: "2026-08-20T12:00:00.000Z",
      sprintId: "s1",
      description: "Kunde zurückrufen",
      priority: "hoch",
      parentTaskId: "parent1",
      kind: "projekt",
      projectId: "p1",
      projectName: "Umzugsprojekt",
      phaseId: "ph1",
      area: "kunde",
      status: "laeuft",
      startDate: "2026-08-15",
      createdBy: "u2",
      createdAt: "2026-08-01T00:00:00.000Z",
    });
  });

  it("falls back to the old defaults only when a field is genuinely absent (create-from-scratch)", () => {
    const result = toTaskJSON({
      id: "t2",
      content: "Neue Aufgabe",
      deadline: null,
      assigneeIds: [],
      recordIds: [],
    });

    expect(result).toMatchObject({
      isCompleted: false,
      completedAt: null,
      sprintId: null,
      parentTaskId: null,
      kind: "operativ",
      projectId: null,
      projectName: null,
      phaseId: null,
      area: null,
      status: "geplant",
      startDate: null,
    });
  });
});

// C1a guard test: the outbound half of the bridge. WorkTaskDialog renders
// live controls for status, startDate, projectId and phaseId and always
// sends them in WorkTaskSavePayload — the bridge used to drop all four
// before forwarding to the legacy onSave callers. Dropping status/startDate
// silently discarded real edits (success toast, but the PATCH body never
// carried the field). Dropping projectId/phaseId alongside kind:"projekt"
// was the critical one: resolveTaskKind (services/tasks.ts) sees no
// `projectId` key in the payload, falls back to the row's current
// projectId (null), and resolves the kind back to "operativ" — the task
// never moves to the project, and the area:null sent alongside it wipes
// the task's Bereich.
function baseSavePayload(overrides: Partial<WorkTaskSavePayload> = {}): WorkTaskSavePayload {
  return {
    content: "Rückruf vereinbaren",
    description: null,
    startDate: null,
    status: "geplant",
    priority: null,
    kind: "operativ",
    projectId: null,
    phaseId: null,
    area: "kunde",
    sprintId: null,
    recordIds: ["r1"],
    assigneeIds: [],
    ...overrides,
  };
}

describe("buildLegacySaveData", () => {
  it("forwards status, startDate, projectId and phaseId in the outbound payload", () => {
    const result = buildLegacySaveData(
      baseSavePayload({
        status: "laeuft",
        startDate: "2026-08-15",
        kind: "projekt",
        projectId: "p1",
        phaseId: "ph1",
        area: null,
      }),
    );

    expect(result.status).toBe("laeuft");
    expect(result.startDate).toBe("2026-08-15");
    expect(result.projectId).toBe("p1");
    expect(result.phaseId).toBe("ph1");
  });

  it("switching an area=kunde operativ task to a project emits kind:projekt with a non-null projectId in the same payload", () => {
    // Mirrors WorkTaskDialog's handleSave: isProject = kind==="projekt" &&
    // !!projectId, which then sends area:null. The bridge must not drop
    // projectId while forwarding that area:null, or resolveTaskKind falls
    // back to the row's existing (null) projectId and silently resolves
    // the kind back to "operativ" while the Bereich stays wiped.
    const result = buildLegacySaveData(
      baseSavePayload({
        kind: "projekt",
        projectId: "p1",
        phaseId: null,
        area: null, // WorkTaskDialog sends area:null once isProject is true
      }),
    );

    expect(result.kind).toBe("projekt");
    expect(result.projectId).toBe("p1");
    expect(result.projectId).not.toBeNull();
    expect(result.area).toBeNull();
  });

  // C7 guard tests: task-dialog.tsx used to reconstruct an explicit deadline
  // (falling back to the seeded value) whenever WorkTaskDialog omitted it as
  // unchanged, so `deadline` was re-sent on every single save. The one
  // legacy caller (record-tasks.tsx) PATCHes with JSON.stringify(data),
  // which drops an undefined-valued property from the JSON entirely — so
  // the bridge must forward `undefined` as `undefined`, not paper over it.
  // services/tasks.ts resets overdueNotifiedAt whenever the `deadline` key
  // is present in the PATCH body at all, changed or not, so a re-sent
  // unchanged value re-arms the overdue push for nothing.
  it("C7: omits deadline entirely when WorkTaskDialog reports it unchanged (undefined), instead of reconstructing it", () => {
    // baseSavePayload() has no `deadline` key at all — WorkTaskSavePayload's
    // own field is optional and WorkTaskDialog only ever sets it when
    // `deadlineChanged` is true (see handleSave there).
    const result = buildLegacySaveData(baseSavePayload());

    expect(result.deadline).toBeUndefined();
    // What actually reaches the server: JSON.stringify drops an
    // undefined-valued property from the output entirely (unlike the
    // in-memory object, which still has the key with value `undefined`),
    // which is exactly the "omit from the PATCH" behaviour C7 requires.
    expect(JSON.stringify(result)).not.toContain("deadline");
  });

  it("C7: forwards an explicit null when WorkTaskDialog reports the deadline was cleared", () => {
    const result = buildLegacySaveData(baseSavePayload({ deadline: null }));

    expect(result.deadline).toBeNull();
    expect(JSON.stringify(result)).toContain('"deadline":null');
  });

  it("C7: forwards the new value when WorkTaskDialog reports the deadline changed", () => {
    const newDeadline = "2026-09-01T21:59:00.000Z";
    const result = buildLegacySaveData(baseSavePayload({ deadline: newDeadline }));

    expect(result.deadline).toBe(newDeadline);
  });
});
