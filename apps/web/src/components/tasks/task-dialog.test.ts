import { describe, it, expect } from "vitest";
import { toTaskJSON } from "./task-dialog";

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
