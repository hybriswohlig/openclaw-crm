import { describe, expect, it } from "vitest";
import { parseProjectInput, foldProjectStats } from "./projects";

describe("parseProjectInput — create", () => {
  it("requires a name", () => {
    expect(parseProjectInput({ category: "software" }, "create")).toEqual({
      ok: false,
      error: "Projektname ist erforderlich.",
    });
  });

  it("requires a known category", () => {
    expect(parseProjectInput({ name: "IT-Transformation", category: "sonstwas" }, "create")).toEqual({
      ok: false,
      error: "Ungültiger Projektbereich.",
    });
  });

  it("fills the documented defaults", () => {
    const r = parseProjectInput({ name: "  IT-Transformation  ", category: "software" }, "create");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input).toMatchObject({
      name: "IT-Transformation",
      category: "software",
      priority: "mittel",
      status: "geplant",
      scopeIn: [],
      scopeOut: [],
      budgetPlannedCents: null,
    });
  });

  it("accepts the new sehr_hoch priority step", () => {
    const r = parseProjectInput({ name: "X", category: "vertrieb", priority: "sehr_hoch" }, "create");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.priority).toBe("sehr_hoch");
  });

  it("keeps only non-empty scope strings", () => {
    const r = parseProjectInput(
      { name: "X", category: "vertrieb", scopeIn: ["Leistungsseiten", "  ", 7, "SEO"] },
      "create",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.scopeIn).toEqual(["Leistungsseiten", "SEO"]);
  });

  it("rejects a non-integer budget frame", () => {
    expect(parseProjectInput({ name: "X", category: "vertrieb", budgetPlannedCents: 99.5 }, "create")).toEqual({
      ok: false,
      error: "Budgetrahmen muss eine ganze Zahl in Cent sein.",
    });
  });
});

describe("parseProjectInput — update", () => {
  it("allows a patch with no fields at all", () => {
    expect(parseProjectInput({}, "update")).toEqual({ ok: true, input: {} });
  });
  it("emits only the sent keys", () => {
    const r = parseProjectInput({ status: "aktiv" }, "update");
    expect(r).toEqual({ ok: true, input: { status: "aktiv" } });
  });
  it("rejects an empty name", () => {
    expect(parseProjectInput({ name: "   " }, "update")).toEqual({
      ok: false,
      error: "Projektname darf nicht leer sein.",
    });
  });
  it("rejects an unknown status", () => {
    expect(parseProjectInput({ status: "laeuft" }, "update")).toEqual({
      ok: false,
      error: "Ungültiger Projektstatus.",
    });
  });

  it("accepts archivedAt as an ISO timestamp and as null (archive / un-archive)", () => {
    expect(parseProjectInput({ archivedAt: "2026-08-21T10:00:00.000Z" }, "update")).toEqual({
      ok: true,
      input: { archivedAt: "2026-08-21T10:00:00.000Z" },
    });
    expect(parseProjectInput({ archivedAt: null }, "update")).toEqual({
      ok: true,
      input: { archivedAt: null },
    });
  });

  it("rejects a junk archivedAt rather than storing an Invalid Date", () => {
    expect(parseProjectInput({ archivedAt: "irgendwann" }, "update")).toEqual({
      ok: false,
      error: "archivedAt muss ein ISO-Zeitstempel oder null sein.",
    });
  });

  it("ignores archivedAt on create — a project is never born archived", () => {
    const r = parseProjectInput(
      { name: "X", category: "vertrieb", archivedAt: "2026-08-21T10:00:00.000Z" },
      "create",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect("archivedAt" in r.input).toBe(false);
  });

  it("passes the TipTap notes document through untouched", () => {
    const doc = { type: "doc", content: [{ type: "paragraph" }] };
    expect(parseProjectInput({ notesContent: doc }, "update")).toEqual({
      ok: true,
      input: { notesContent: doc },
    });
  });
});

describe("foldProjectStats", () => {
  const now = new Date("2026-08-21T10:00:00");

  it("computes count-based progress and overdue over ALL tasks incl. subtasks", () => {
    const stats = foldProjectStats(
      {
        projectIds: ["p1"],
        tasks: [
          { projectId: "p1", status: "erledigt", deadline: null },
          { projectId: "p1", status: "erledigt", deadline: null },
          { projectId: "p1", status: "in_arbeit", deadline: new Date("2026-08-18T00:00:00") },
          { projectId: "p1", status: "geplant", deadline: new Date("2026-09-30T00:00:00") },
        ],
        phases: [],
        milestones: [],
        risks: [],
        budgets: [],
        plannedByProject: new Map([["p1", null]]),
      },
      now,
    ).get("p1")!;

    expect(stats.totalTasks).toBe(4);
    expect(stats.doneTasks).toBe(2);
    expect(stats.overdueTasks).toBe(1);
    expect(stats.progressPct).toBe(50);
  });

  it("counts phases, milestones and the next milestone date", () => {
    const stats = foldProjectStats(
      {
        projectIds: ["p1"],
        tasks: [],
        phases: [
          { projectId: "p1", status: "abgeschlossen" },
          { projectId: "p1", status: "in_arbeit" },
        ],
        milestones: [
          { projectId: "p1", status: "erreicht", dueDate: new Date("2026-08-01T00:00:00") },
          { projectId: "p1", status: "geplant", dueDate: new Date("2026-10-05T00:00:00") },
          { projectId: "p1", status: "geplant", dueDate: new Date("2026-09-12T00:00:00") },
        ],
        risks: [],
        budgets: [],
        plannedByProject: new Map([["p1", null]]),
      },
      now,
    ).get("p1")!;

    expect(stats.totalPhases).toBe(2);
    expect(stats.donePhases).toBe(1);
    expect(stats.totalMilestones).toBe(3);
    expect(stats.reachedMilestones).toBe(1);
    expect(stats.nextMilestoneAt).toEqual(new Date("2026-09-12T00:00:00"));
  });

  it("sums only kind='ist' into the budget spend and derives the percentage", () => {
    const stats = foldProjectStats(
      {
        projectIds: ["p1"],
        tasks: [],
        phases: [],
        milestones: [],
        risks: [],
        budgets: [
          { projectId: "p1", kind: "ist", amountCents: 2_000_00 },
          { projectId: "p1", kind: "plan", amountCents: 9_000_00 },
        ],
        plannedByProject: new Map([["p1", 10_000_00]]),
      },
      now,
    ).get("p1")!;

    expect(stats.budgetSpentCents).toBe(2_000_00);
    expect(stats.budgetPlannedCents).toBe(10_000_00);
    expect(stats.budgetPct).toBe(20);
  });

  it("counts open risks (offen + beobachtet) and breaks them down by severity", () => {
    const stats = foldProjectStats(
      {
        projectIds: ["p1"],
        tasks: [],
        phases: [],
        milestones: [],
        risks: [
          { projectId: "p1", status: "offen", severity: "hoch" },
          { projectId: "p1", status: "beobachtet", severity: "mittel" },
          { projectId: "p1", status: "geschlossen", severity: "hoch" },
        ],
        budgets: [],
        plannedByProject: new Map([["p1", null]]),
      },
      now,
    ).get("p1")!;

    expect(stats.openRisks).toBe(2);
    expect(stats.risksBySeverity).toEqual({ niedrig: 0, mittel: 1, hoch: 1 });
  });

  it("returns a zeroed entry for a project with nothing attached", () => {
    const stats = foldProjectStats(
      {
        projectIds: ["empty"],
        tasks: [],
        phases: [],
        milestones: [],
        risks: [],
        budgets: [],
        plannedByProject: new Map([["empty", null]]),
      },
      now,
    ).get("empty")!;

    expect(stats).toEqual({
      totalTasks: 0,
      doneTasks: 0,
      overdueTasks: 0,
      progressPct: 0,
      totalPhases: 0,
      donePhases: 0,
      totalMilestones: 0,
      reachedMilestones: 0,
      nextMilestoneAt: null,
      budgetPlannedCents: null,
      budgetSpentCents: 0,
      budgetPct: null,
      openRisks: 0,
      risksBySeverity: { niedrig: 0, mittel: 0, hoch: 0 },
    });
  });
});
