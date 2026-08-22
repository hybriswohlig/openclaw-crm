import { describe, expect, it } from "vitest";
import * as sprintService from "./sprints";
import { foldSprintMetrics } from "./sprints";

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
