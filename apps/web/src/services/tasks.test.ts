import { describe, expect, it } from "vitest";
import {
  resolveTaskKind,
  resolvePhaseAssignment,
  resolveParentEligibility,
  resolveInheritedPlacement,
  resolveTaskStatus,
  planTaskFilters,
} from "./tasks";
import * as taskService from "./tasks";

const OPERATIV = { kind: "operativ" as const, projectId: null, phaseId: null };
const IN_PROJECT = { kind: "projekt" as const, projectId: "p1", phaseId: "ph1" };

describe("resolveTaskKind — invariant I1", () => {
  it("setting a projectId forces kind='projekt'", () => {
    expect(resolveTaskKind({ projectId: "p1" }, OPERATIV)).toEqual({
      kind: "projekt",
      projectId: "p1",
      phaseId: null,
    });
  });

  it("clearing the projectId forces kind='operativ' and drops the phase", () => {
    expect(resolveTaskKind({ projectId: null }, IN_PROJECT)).toEqual(OPERATIV);
    expect(resolveTaskKind({ projectId: "" }, IN_PROJECT)).toEqual(OPERATIV);
  });

  it("sending kind='operativ' also detaches the project", () => {
    expect(resolveTaskKind({ kind: "operativ" }, IN_PROJECT)).toEqual(OPERATIV);
  });

  it("sending kind='projekt' without a project stays operativ (I1 cannot be faked)", () => {
    expect(resolveTaskKind({ kind: "projekt" }, OPERATIV)).toEqual(OPERATIV);
  });

  it("keeps the current phase when the task stays in the same project", () => {
    expect(resolveTaskKind({ projectId: "p1" }, IN_PROJECT)).toEqual(IN_PROJECT);
  });

  it("drops the phase when the task moves to a different project", () => {
    expect(resolveTaskKind({ projectId: "p2" }, IN_PROJECT)).toEqual({
      kind: "projekt",
      projectId: "p2",
      phaseId: null,
    });
  });

  it("an explicit phaseId wins over the inherited one", () => {
    expect(resolveTaskKind({ projectId: "p2", phaseId: "ph9" }, IN_PROJECT)).toEqual({
      kind: "projekt",
      projectId: "p2",
      phaseId: "ph9",
    });
  });

  it("a phaseId alone attaches to the current project", () => {
    expect(resolveTaskKind({ phaseId: "ph2" }, IN_PROJECT)).toEqual({
      kind: "projekt",
      projectId: "p1",
      phaseId: "ph2",
    });
  });

  it("a phaseId on an operative task is ignored — there is no project to belong to", () => {
    expect(resolveTaskKind({ phaseId: "ph2" }, OPERATIV)).toEqual(OPERATIV);
  });

  it("an empty patch changes nothing", () => {
    expect(resolveTaskKind({}, IN_PROJECT)).toEqual(IN_PROJECT);
    expect(resolveTaskKind({}, OPERATIV)).toEqual(OPERATIV);
  });
});

describe("resolvePhaseAssignment — invariant I2", () => {
  it("accepts a phase that belongs to the target project", () => {
    expect(resolvePhaseAssignment("p1", "p1")).toEqual({ ok: true });
  });

  it("rejects a phase that belongs to a different project", () => {
    expect(resolvePhaseAssignment("p2", "p1")).toEqual({
      ok: false,
      error: "Phase gehört nicht zu diesem Projekt",
    });
  });

  it("rejects a phase id when the task has no project at all", () => {
    expect(resolvePhaseAssignment("p1", null)).toEqual({
      ok: false,
      error: "Phase gehört nicht zu diesem Projekt",
    });
  });

  it("rejects a phase id that resolved to nothing (unknown / cross-workspace)", () => {
    // The async wrapper passes null when the SELECT found no row.
    expect(resolvePhaseAssignment(null, "p1")).toEqual({
      ok: false,
      error: "Phase gehört nicht zu diesem Projekt",
    });
  });

  it("accepts 'no phase at all' — both null is the operative case", () => {
    expect(resolvePhaseAssignment(null, null)).toEqual({ ok: true });
  });
});

describe("resolveParentEligibility — I4 is capped at two levels", () => {
  it("accepts a top-level task as a parent", () => {
    expect(resolveParentEligibility({ parentTaskId: null })).toEqual({ ok: true });
  });

  it("rejects a subtask as a parent — the I4 cascade is one level deep", () => {
    // updateTask cascades with `WHERE parent_task_id = <id>`, which reaches
    // children but not grandchildren: moving A in A→B→C would leave C with
    // kind='projekt' and no project, breaking I1 from inside I1's enforcer.
    expect(resolveParentEligibility({ parentTaskId: "a" })).toEqual({
      ok: false,
      error: "Unteraufgaben können keine weiteren Unteraufgaben haben",
    });
  });

  it("accepts 'no parent at all'", () => {
    expect(resolveParentEligibility(null)).toEqual({ ok: true });
  });
});

describe("resolveInheritedPlacement — invariant I4", () => {
  it("a child of a project parent inherits kind, project and phase", () => {
    expect(
      resolveInheritedPlacement({ kind: "projekt", projectId: "p1", phaseId: "ph1" }, OPERATIV),
    ).toEqual({ kind: "projekt", projectId: "p1", phaseId: "ph1" });
  });

  it("a child of an operative parent is operative, phase dropped", () => {
    expect(
      resolveInheritedPlacement({ kind: "operativ", projectId: null, phaseId: null }, IN_PROJECT),
    ).toEqual(OPERATIV);
  });

  it("repairs a parent whose kind column drifted from its project_id", () => {
    expect(
      resolveInheritedPlacement({ kind: null, projectId: "p1", phaseId: "ph1" }, OPERATIV),
    ).toEqual({ kind: "projekt", projectId: "p1", phaseId: "ph1" });
    expect(
      resolveInheritedPlacement({ kind: "projekt", projectId: null, phaseId: "ph1" }, IN_PROJECT),
    ).toEqual(OPERATIV);
  });

  it("falls back to the caller's placement when there is no parent", () => {
    expect(resolveInheritedPlacement(null, IN_PROJECT)).toEqual(IN_PROJECT);
    expect(resolveInheritedPlacement(null, OPERATIV)).toEqual(OPERATIV);
  });
});

describe("resolveTaskStatus — invariant I3", () => {
  const now = new Date("2026-08-21T10:00:00");
  const OPEN = { status: "geplant" as const, isCompleted: false, completedAt: null };
  const DONE = {
    status: "erledigt" as const,
    isCompleted: true,
    completedAt: new Date("2026-08-01T08:00:00"),
  };

  it("status='erledigt' also sets isCompleted and stamps completedAt", () => {
    expect(resolveTaskStatus({ status: "erledigt" }, OPEN, now)).toEqual({
      status: "erledigt",
      isCompleted: true,
      completedAt: now,
    });
  });

  it("isCompleted=true also sets status='erledigt'", () => {
    expect(resolveTaskStatus({ isCompleted: true }, OPEN, now)).toEqual({
      status: "erledigt",
      isCompleted: true,
      completedAt: now,
    });
  });

  it("isCompleted=false reopens a done task as 'geplant' and clears completedAt", () => {
    expect(resolveTaskStatus({ isCompleted: false }, DONE, now)).toEqual({
      status: "geplant",
      isCompleted: false,
      completedAt: null,
    });
  });

  it("moving to 'in_arbeit' clears the done flags", () => {
    expect(resolveTaskStatus({ status: "in_arbeit" }, DONE, now)).toEqual({
      status: "in_arbeit",
      isCompleted: false,
      completedAt: null,
    });
  });

  it("keeps the original completedAt when a done task is re-saved as done", () => {
    expect(resolveTaskStatus({ status: "erledigt" }, DONE, now).completedAt).toEqual(
      new Date("2026-08-01T08:00:00"),
    );
  });

  it("status wins over a contradicting isCompleted", () => {
    expect(resolveTaskStatus({ status: "in_arbeit", isCompleted: true }, OPEN, now)).toEqual({
      status: "in_arbeit",
      isCompleted: false,
      completedAt: null,
    });
  });

  it("an unknown status keeps the current one", () => {
    expect(resolveTaskStatus({ status: "laeuft" }, OPEN, now)).toEqual(OPEN);
  });

  it("an empty patch changes nothing", () => {
    expect(resolveTaskStatus({}, DONE, now)).toEqual(DONE);
  });
});

describe("planTaskFilters", () => {
  const now = new Date("2026-08-21T10:00:00");

  it("keeps today's top-level-only default and hides completed tasks", () => {
    const plan = planTaskFilters({}, now);
    expect(plan.topLevelOnly).toBe(true);
    expect(plan.showCompleted).toBe(false);
    expect(plan.limit).toBe(50);
    expect(plan.offset).toBe(0);
  });

  it("includeSubtasks=true lifts the parentTaskId IS NULL filter", () => {
    expect(planTaskFilters({ includeSubtasks: true }, now).topLevelOnly).toBe(false);
  });

  it("normalises the new enum filters and drops junk", () => {
    const plan = planTaskFilters(
      { kind: "projekt", area: "auftrag", status: "in_arbeit", projectId: "p1", phaseId: "ph1" },
      now,
    );
    expect(plan.kind).toBe("projekt");
    expect(plan.area).toBe("auftrag");
    expect(plan.status).toBe("in_arbeit");
    expect(plan.projectId).toBe("p1");
    expect(plan.phaseId).toBe("ph1");

    const junk = planTaskFilters({ kind: "epic", area: "quatsch", status: "warte" }, now);
    expect(junk.kind).toBeNull();
    expect(junk.area).toBeNull();
    expect(junk.status).toBeNull();
  });

  it("turns dueWithinDays into an inclusive end-of-day bound", () => {
    const plan = planTaskFilters({ dueWithinDays: 7 }, now);
    expect(plan.dueBefore?.getDate()).toBe(28);
    expect(plan.dueBefore?.getHours()).toBe(23);
    expect(plan.dueBefore?.getMinutes()).toBe(59);
  });

  it("dueWithinDays=0 means 'heute fällig'", () => {
    const plan = planTaskFilters({ dueWithinDays: 0 }, now);
    expect(plan.dueBefore?.getDate()).toBe(21);
  });

  it("dueWithinDays always sets a LOWER bound at today 00:00", () => {
    // Without dueFrom, `deadline <= today 23:59` also matches every overdue
    // task, and the dashboard tile "n heute fällig" would count yesterday's
    // misses as due today.
    const plan = planTaskFilters({ dueWithinDays: 0 }, now);
    expect(plan.dueFrom).not.toBeNull();
    expect(plan.dueFrom!.getDate()).toBe(21);
    expect(plan.dueFrom!.getHours()).toBe(0);
    expect(plan.dueFrom!.getMinutes()).toBe(0);

    // An overdue task falls outside [dueFrom, dueBefore].
    const yesterday = new Date(2026, 7, 20, 17, 0);
    expect(yesterday.getTime() < plan.dueFrom!.getTime()).toBe(true);
    // A task due later today falls inside it.
    const laterToday = new Date(2026, 7, 21, 17, 0);
    expect(
      laterToday.getTime() >= plan.dueFrom!.getTime() &&
        laterToday.getTime() <= plan.dueBefore!.getTime(),
    ).toBe(true);
  });

  it("leaves dueFrom null when dueWithinDays was not requested", () => {
    expect(planTaskFilters({}, now).dueFrom).toBeNull();
    expect(planTaskFilters({ overdue: true }, now).dueFrom).toBeNull();
  });

  it("exposes today's local midnight for the overdue filter", () => {
    const plan = planTaskFilters({ overdue: true }, now);
    expect(plan.overdue).toBe(true);
    expect(plan.todayStart.getHours()).toBe(0);
    expect(plan.todayStart.getDate()).toBe(21);
  });

  it("a sprintId wins over noSprint", () => {
    const plan = planTaskFilters({ sprintId: "s1", noSprint: true }, now);
    expect(plan.sprintId).toBe("s1");
    expect(plan.noSprint).toBe(false);
  });

  it("clamps the page size to 1..200", () => {
    expect(planTaskFilters({ limit: 5000 }, now).limit).toBe(200);
    expect(planTaskFilters({ limit: 0 }, now).limit).toBe(1);
    expect(planTaskFilters({ offset: -3 }, now).offset).toBe(0);
  });
});

describe("services/tasks public surface after the points removal", () => {
  it("no longer exports the Fibonacci point helpers", () => {
    expect("normalizePoints" in taskService).toBe(false);
    expect("TASK_POINT_VALUES" in taskService).toBe(false);
  });

  it("no longer exports the dead home-page widget helper", () => {
    expect("getUpcomingTasks" in taskService).toBe(false);
  });

  it("still exports the CRUD surface the routes call", () => {
    expect(typeof taskService.listTasks).toBe("function");
    expect(typeof taskService.createTask).toBe("function");
    expect(typeof taskService.updateTask).toBe("function");
    expect(typeof taskService.deleteTask).toBe("function");
    expect(typeof taskService.listSubtasks).toBe("function");
    expect(typeof taskService.getTasksForRecord).toBe("function");
  });
});
