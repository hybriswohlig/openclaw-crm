import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { tasks } from "./tasks";

describe("tasks schema after the work-model extension", () => {
  it("carries the six new columns from spec 4.10", () => {
    const names = getTableConfig(tasks).columns.map((c) => c.name);
    for (const column of ["kind", "project_id", "phase_id", "area", "status", "start_date"]) {
      expect(names).toContain(column);
    }
  });

  it("makes kind and status NOT NULL with a default so existing rows stay valid", () => {
    const byName = new Map(getTableConfig(tasks).columns.map((c) => [c.name, c]));
    const kind = byName.get("kind");
    const status = byName.get("status");
    expect(kind?.notNull).toBe(true);
    expect(kind?.hasDefault).toBe(true);
    expect(status?.notNull).toBe(true);
    expect(status?.hasDefault).toBe(true);
    // project_id / phase_id / area / start_date stay optional.
    expect(byName.get("project_id")?.notNull).toBe(false);
    expect(byName.get("phase_id")?.notNull).toBe(false);
    expect(byName.get("area")?.notNull).toBe(false);
    expect(byName.get("start_date")?.notNull).toBe(false);
  });

  it("keeps the legacy columns so no data is lost (spec 4.11)", () => {
    const names = getTableConfig(tasks).columns.map((c) => c.name);
    for (const column of ["kanban_status", "point_estimate", "work_type", "growth_category"]) {
      expect(names).toContain(column);
    }
  });

  it("indexes the new lookup paths", () => {
    const names = getTableConfig(tasks)
      .indexes.map((i) => i.config.name ?? "")
      .sort();
    expect(names).toEqual([
      "tasks_parent_task_id",
      "tasks_phase_id",
      "tasks_project_id",
      "tasks_sprint_id",
      "tasks_workspace_id",
      "tasks_workspace_kind",
      "tasks_workspace_status",
    ]);
  });
});
