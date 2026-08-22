import { describe, expect, it } from "vitest";
import * as sprintService from "./sprints";
import { foldSprintMetrics, resolveSprintMetrics } from "./sprints";

describe("foldSprintMetrics — counts, not points", () => {
  it("counts every task in the sprint, parents included", () => {
    expect(
      foldSprintMetrics([
        { isCompleted: true },
        { isCompleted: true },
        { isCompleted: false },
        { isCompleted: false },
        { isCompleted: false },
      ]),
    ).toEqual({ totalTasks: 5, doneTasks: 2, openTasks: 3, progressPct: 40 });
  });

  it("is all zeroes for an empty sprint", () => {
    expect(foldSprintMetrics([])).toEqual({
      totalTasks: 0,
      doneTasks: 0,
      openTasks: 0,
      progressPct: 0,
    });
  });

  it("is 100 percent when everything is done", () => {
    expect(foldSprintMetrics([{ isCompleted: true }, { isCompleted: true }])).toEqual({
      totalTasks: 2,
      doneTasks: 2,
      openTasks: 0,
      progressPct: 100,
    });
  });
});

describe("resolveSprintMetrics — snapshot vs. live, tasks vs. points", () => {
  const live = { totalTasks: 4, doneTasks: 1, openTasks: 3, progressPct: 25 };

  it("a running sprint always reads LIVE counts, ignoring any stored snapshot", () => {
    const out = resolveSprintMetrics(
      { state: "aktiv", metricsBasis: "tasks", committedPoints: 99, completedPoints: 99 },
      live,
    );
    expect(out.metricsBasis).toBe("tasks");
    expect(out.metrics).toEqual(live);
  });

  it("a closed sprint with a task-count snapshot reads the snapshot, not live", () => {
    const out = resolveSprintMetrics(
      { state: "abgeschlossen", metricsBasis: "tasks", committedPoints: 6, completedPoints: 4 },
      live,
    );
    expect(out.metricsBasis).toBe("tasks");
    expect(out.metrics).toEqual({
      totalTasks: 6,
      doneTasks: 4,
      openTasks: 2,
      progressPct: 67,
    });
  });

  it("a closed sprint with a NULL snapshot falls back to live (defensive)", () => {
    const out = resolveSprintMetrics(
      { state: "abgeschlossen", metricsBasis: "tasks", committedPoints: null, completedPoints: null },
      live,
    );
    expect(out.metrics).toEqual(live);
  });

  it("a closed sprint marked 'points' is labelled 'points' — the caller must render '–', not the number", () => {
    const out = resolveSprintMetrics(
      { state: "abgeschlossen", metricsBasis: "points", committedPoints: 21, completedPoints: 13 },
      live,
    );
    expect(out.metricsBasis).toBe("points");
  });

  it("an open sprint is never labelled 'points', even if the stale column says so", () => {
    const out = resolveSprintMetrics(
      { state: "planung", metricsBasis: "points", committedPoints: 21, completedPoints: 13 },
      live,
    );
    expect(out.metricsBasis).toBe("tasks");
    expect(out.metrics).toEqual(live);
  });
});

describe("sprint service surface after the points removal", () => {
  it("no longer exports velocity or burndown", () => {
    expect("getSprintVelocity" in sprintService).toBe(false);
    expect("computeBurndown" in sprintService).toBe(false);
  });
  it("still exports the sprint lifecycle", () => {
    for (const fn of [
      "listSprints",
      "getSprint",
      "getActiveSprint",
      "createSprint",
      "updateSprint",
      "activateSprint",
      "closeSprint",
      "deleteSprint",
    ] as const) {
      expect(typeof (sprintService as Record<string, unknown>)[fn]).toBe("function");
    }
  });
});
