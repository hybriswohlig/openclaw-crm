import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import type { PgTable } from "drizzle-orm/pg-core";
import {
  projects,
  projectPhases,
  projectMilestones,
  projectMembers,
  projectRisks,
  projectBudgetEntries,
  projectDocuments,
  taskDependencies,
  projectFavorites,
} from "./projects";

function columns(table: PgTable): string[] {
  return getTableConfig(table)
    .columns.map((c) => c.name)
    .sort();
}

function indexes(table: PgTable): string[] {
  return getTableConfig(table)
    .indexes.map((i) => i.config.name ?? "")
    .sort();
}

function uniqueConstraints(table: PgTable): Array<{ name: string; columns: string[] }> {
  return getTableConfig(table)
    .uniqueConstraints.map((u) => ({
      name: u.getName() ?? "",
      columns: u.columns.map((c) => c.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The ON DELETE action of the foreign key that carries the given column.
function onDeleteFor(table: PgTable, column: string): string | undefined {
  return getTableConfig(table).foreignKeys.find((fk) =>
    fk.reference().columns.some((c) => c.name === column)
  )?.onDelete;
}

describe("projects schema mirrors 0044_projects.sql", () => {
  it("names the tables exactly as the SQL does", () => {
    expect(getTableConfig(projects).name).toBe("projects");
    expect(getTableConfig(projectPhases).name).toBe("project_phases");
    expect(getTableConfig(projectMilestones).name).toBe("project_milestones");
    expect(getTableConfig(projectMembers).name).toBe("project_members");
    expect(getTableConfig(projectRisks).name).toBe("project_risks");
    expect(getTableConfig(projectBudgetEntries).name).toBe("project_budget_entries");
    expect(getTableConfig(projectDocuments).name).toBe("project_documents");
    expect(getTableConfig(taskDependencies).name).toBe("task_dependencies");
    expect(getTableConfig(projectFavorites).name).toBe("project_favorites");
  });

  it("defines every projects column from spec 4.1", () => {
    expect(columns(projects)).toEqual([
      "archived_at",
      "budget_planned_cents",
      "category",
      "color",
      "created_at",
      "created_by",
      "end_date",
      "goal_statement",
      "icon",
      "id",
      "name",
      "notes_content",
      "owner_user_id",
      "priority",
      "problem_statement",
      "scope_in",
      "scope_out",
      "short_description",
      "start_date",
      "status",
      "success_criteria",
      "updated_at",
      "workspace_id",
    ]);
    expect(indexes(projects)).toEqual(["projects_workspace_id", "projects_workspace_status"]);
  });

  it("gives projects the documented NOT NULL defaults", () => {
    const byName = new Map(getTableConfig(projects).columns.map((c) => [c.name, c]));
    const priority = byName.get("priority");
    const status = byName.get("status");
    const scopeIn = byName.get("scope_in");
    expect(priority?.notNull).toBe(true);
    expect(priority?.hasDefault).toBe(true);
    expect(status?.notNull).toBe(true);
    expect(status?.hasDefault).toBe(true);
    expect(scopeIn?.notNull).toBe(true);
    expect(scopeIn?.hasDefault).toBe(true);
    expect(byName.get("budget_planned_cents")?.notNull).toBe(false);
  });

  it("defines the phase and milestone columns", () => {
    expect(columns(projectPhases)).toEqual([
      "created_at",
      "description",
      "due_date",
      "id",
      "name",
      "position",
      "project_id",
      "start_date",
      "status",
      "workspace_id",
    ]);
    expect(indexes(projectPhases)).toEqual(["project_phases_project_position"]);

    expect(columns(projectMilestones)).toEqual([
      "created_at",
      "due_date",
      "id",
      "name",
      "phase_id",
      "position",
      "project_id",
      "reached_at",
      "status",
      "workspace_id",
    ]);
    expect(indexes(projectMilestones)).toEqual(["project_milestones_project_position"]);
  });

  it("defines the member, risk, budget and document columns", () => {
    expect(columns(projectMembers)).toEqual([
      "created_at",
      "id",
      "project_id",
      "role",
      "user_id",
      "workspace_id",
    ]);
    expect(columns(projectRisks)).toEqual([
      "created_at",
      "description",
      "id",
      "likelihood",
      "mitigation",
      "owner_user_id",
      "project_id",
      "severity",
      "status",
      "title",
      "workspace_id",
    ]);
    expect(columns(projectBudgetEntries)).toEqual([
      "amount_cents",
      "booked_at",
      "created_at",
      "created_by",
      "id",
      "kind",
      "label",
      "note",
      "project_id",
      "workspace_id",
    ]);
    expect(columns(projectDocuments)).toEqual([
      "created_at",
      "file_content",
      "file_name",
      "file_size",
      "id",
      "mime_type",
      "project_id",
      "uploaded_at",
      "uploaded_by",
      "workspace_id",
    ]);
  });

  it("defines the dependency and favourite join tables", () => {
    expect(columns(taskDependencies)).toEqual([
      "created_at",
      "id",
      "predecessor_task_id",
      "successor_task_id",
      "type",
      "workspace_id",
    ]);
    expect(columns(projectFavorites)).toEqual([
      "created_at",
      "id",
      "project_id",
      "user_id",
      "workspace_id",
    ]);
  });

  it("declares the three uniqueness rules as real constraints (spec 4.4, 4.8, 4.9)", () => {
    expect(uniqueConstraints(projectMembers)).toEqual([
      { name: "project_members_project_user_uniq", columns: ["project_id", "user_id"] },
    ]);
    expect(uniqueConstraints(taskDependencies)).toEqual([
      {
        name: "task_dependencies_pair_uniq",
        columns: ["predecessor_task_id", "successor_task_id"],
      },
    ]);
    expect(uniqueConstraints(projectFavorites)).toEqual([
      { name: "project_favorites_user_project_uniq", columns: ["user_id", "project_id"] },
    ]);
    // A bare unique index would satisfy ON CONFLICT (cols) too, but only a
    // named constraint can also be named in ON CONFLICT ON CONSTRAINT, and it
    // is what spec §4.4/§4.8/§4.9 asks for. Assert none degraded into an index.
    expect(getTableConfig(projectMembers).indexes.filter((i) => i.config.unique)).toEqual([]);
    expect(getTableConfig(taskDependencies).indexes.filter((i) => i.config.unique)).toEqual([]);
    expect(getTableConfig(projectFavorites).indexes.filter((i) => i.config.unique)).toEqual([]);
  });

  it("cascades all seven child tables from their project, so deleteProject is one DELETE", () => {
    // Phase 2 deletes the projects row and demotes its tasks in a single
    // transaction and hand-deletes nothing. A missing cascade here would make
    // every DELETE fail on a foreign key violation, i.e. no project could ever
    // be deleted.
    const children: Array<[string, PgTable]> = [
      ["project_phases", projectPhases],
      ["project_milestones", projectMilestones],
      ["project_members", projectMembers],
      ["project_risks", projectRisks],
      ["project_budget_entries", projectBudgetEntries],
      ["project_documents", projectDocuments],
      ["project_favorites", projectFavorites],
    ];
    expect(children).toHaveLength(7);
    for (const [name, table] of children) {
      expect(`${name}: ${onDeleteFor(table, "project_id") ?? "no foreign key"}`).toBe(
        `${name}: cascade`
      );
    }
  });

  it("cascades both dependency edges from their task (spec 4.8)", () => {
    expect(onDeleteFor(taskDependencies, "predecessor_task_id")).toBe("cascade");
    expect(onDeleteFor(taskDependencies, "successor_task_id")).toBe("cascade");
  });

  it("keeps a phase and a milestone when their optional parent goes away", () => {
    // Deleting a phase must not take its milestones with it, and deleting a
    // project's owner must not take the project.
    expect(onDeleteFor(projectMilestones, "phase_id")).toBe("set null");
    expect(onDeleteFor(projects, "owner_user_id")).toBe("set null");
  });

  it("carries no index a unique constraint already covers", () => {
    expect(indexes(projectMembers)).toEqual(["project_members_user_id"]);
    expect(indexes(taskDependencies)).toEqual([
      "task_dependencies_successor_id",
      "task_dependencies_workspace_id",
    ]);
    expect(indexes(projectFavorites)).toEqual(["project_favorites_project_id"]);
    expect(indexes(projectRisks)).toEqual(["project_risks_project_id"]);
    expect(indexes(projectDocuments)).toEqual(["project_documents_project_id"]);
    expect(indexes(projectBudgetEntries)).toEqual([
      "project_budget_entries_project_id",
      "project_budget_entries_project_kind",
    ]);
  });
});
