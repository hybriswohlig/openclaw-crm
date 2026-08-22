import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { sprints } from "./sprints";

describe("sprints schema after the count-based conversion", () => {
  it("carries the metrics_basis marker", () => {
    const names = getTableConfig(sprints).columns.map((c) => c.name);
    expect(names).toContain("metrics_basis");
  });

  it("defaults metrics_basis to tasks and never allows NULL", () => {
    // A NULL would be a third, unhandled meaning; a default of 'points' would
    // mislabel every sprint closed from now on.
    const column = getTableConfig(sprints).columns.find((c) => c.name === "metrics_basis");
    expect(column?.notNull).toBe(true);
    expect(column?.hasDefault).toBe(true);
    expect(column?.default).toBe("tasks");
  });

  it("keeps the historical point snapshot columns the marker describes", () => {
    const names = getTableConfig(sprints).columns.map((c) => c.name);
    for (const column of [
      "capacity_points",
      "committed_points",
      "completed_points",
      "carried_tasks",
    ]) {
      expect(names).toContain(column);
    }
  });
});
