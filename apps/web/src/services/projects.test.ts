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

describe("parseProjectInput — startDate/endDate", () => {
  it("accepts a well-formed date and passes it through untouched", () => {
    const r = parseProjectInput(
      { name: "X", category: "vertrieb", startDate: "2026-09-01", endDate: "2026-10-31" },
      "create",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.startDate).toBe("2026-09-01");
    expect(r.input.endDate).toBe("2026-10-31");
  });

  it("rejects a malformed startDate with the shared German message instead of a 500 downstream", () => {
    expect(
      parseProjectInput({ name: "X", category: "vertrieb", startDate: "not-a-date" }, "create"),
    ).toEqual({
      ok: false,
      error: "Datum muss im Format JJJJ-MM-TT angegeben werden.",
    });
  });

  it("rejects a malformed endDate on update", () => {
    expect(parseProjectInput({ endDate: "31.10.2026" }, "update")).toEqual({
      ok: false,
      error: "Datum muss im Format JJJJ-MM-TT angegeben werden.",
    });
  });

  it("treats an omitted date on create as no date", () => {
    const r = parseProjectInput({ name: "X", category: "vertrieb" }, "create");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.startDate).toBeNull();
    expect(r.input.endDate).toBeNull();
  });

  it("treats a null date on update as no date and still emits the key", () => {
    expect(parseProjectInput({ startDate: null }, "update")).toEqual({
      ok: true,
      input: { startDate: null },
    });
  });

  it("leaves dates out of an update patch that never mentioned them", () => {
    const r = parseProjectInput({ status: "aktiv" }, "update");
    expect(r).toEqual({ ok: true, input: { status: "aktiv" } });
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

import { toProjectRowData } from "./projects";

describe("toProjectRowData", () => {
  const row = {
    id: "p1",
    // Every column of `typeof projects.$inferSelect` must be present —
    // workspace_id is .notNull() in Phase 1's schema, so omitting it is
    // TS2345 and breaks `next build`, not just this test.
    workspaceId: "ws1",
    name: "Website-Relaunch kottke-umzuege.de",
    shortDescription: "Neue Seite bis Oktober",
    category: "marketing",
    priority: "hoch",
    status: "aktiv",
    icon: null,
    color: null,
    // `date` columns arrive as "YYYY-MM-DD" strings (Drizzle string mode);
    // `createdAt` / `updatedAt` / `archivedAt` are timestamps and stay Dates.
    startDate: "2026-08-01",
    endDate: "2026-10-31",
    ownerUserId: "u1",
    problemStatement: null,
    goalStatement: null,
    successCriteria: null,
    scopeIn: ["Leistungsseiten"],
    scopeOut: ["Shop"],
    budgetPlannedCents: 500_000,
    notesContent: null,
    createdBy: "u1",
    createdAt: new Date("2026-07-01T00:00:00"),
    updatedAt: new Date("2026-08-01T00:00:00"),
    archivedAt: null,
  };

  it("derives icon and colour from the category when they are not set", () => {
    const p = toProjectRowData(row, [], false);
    expect(p.icon).toBe("Megaphone");
    expect(typeof p.color).toBe("string");
    expect(p.color?.startsWith("#")).toBe(true);
  });

  it("keeps an explicitly stored icon and colour", () => {
    const p = toProjectRowData({ ...row, icon: "Rocket", color: "#123456" }, [], true);
    expect(p.icon).toBe("Rocket");
    expect(p.color).toBe("#123456");
    expect(p.isFavorite).toBe(true);
  });

  it("falls back to safe enum values for junk in the columns", () => {
    const p = toProjectRowData({ ...row, category: "quatsch", priority: "urgent", status: "laeuft" }, [], false);
    expect(p.category).toBe("prozesse");
    expect(p.priority).toBe("mittel");
    expect(p.status).toBe("geplant");
  });

  it("turns the date columns into local-midnight Dates", () => {
    const p = toProjectRowData(row, [], false);
    expect(p.startDate?.getFullYear()).toBe(2026);
    expect(p.startDate?.getMonth()).toBe(7); // August, 0-indexed
    expect(p.startDate?.getDate()).toBe(1);
    expect(p.startDate?.getHours()).toBe(0);
    expect(p.endDate?.getDate()).toBe(31);
  });

  it("leaves an empty date column as null", () => {
    const p = toProjectRowData({ ...row, startDate: null, endDate: null }, [], false);
    expect(p.startDate).toBeNull();
    expect(p.endDate).toBeNull();
  });

  it("passes the member list straight through", () => {
    const members = [
      { userId: "u1", role: "leiter" as const, name: "Dario", email: "d@x.de", image: null },
    ];
    expect(toProjectRowData(row, members, false).members).toEqual(members);
  });
});

import { projectColumnSet, PROJECT_UPDATE_QUIET_KEYS } from "./projects";

describe("projectColumnSet", () => {
  it("maps only the sent scalar fields onto columns and always bumps updatedAt", () => {
    const now = new Date("2026-08-21T12:00:00");
    const set = projectColumnSet({ name: "Neuer Name", status: "aktiv" }, now);
    expect(set).toEqual({ name: "Neuer Name", status: "aktiv", updatedAt: now });
  });

  it("passes YYYY-MM-DD straight through and turns an empty date into null", () => {
    const now = new Date("2026-08-21T12:00:00");
    const set = projectColumnSet({ startDate: "2026-09-01", endDate: null }, now);
    // start_date / end_date are `date` columns in string mode: never
    // new Date() and never toISOString() on the way in.
    expect(set.startDate).toBe("2026-09-01");
    expect(set.endDate).toBeNull();
    expect(set.startDate instanceof Date).toBe(false);
  });

  it("returns an EMPTY set when nothing but updatedAt would change", () => {
    // The Notizen tab autosaves every 1200 ms. An update that touches no
    // column must be a no-op, not an updated_at bump plus an activity row.
    expect(projectColumnSet({}, new Date("2026-08-21T12:00:00"))).toEqual({});
  });

  it("converts archivedAt with new Date — archived_at is a TIMESTAMP, not a date column", () => {
    const now = new Date("2026-08-21T12:00:00");
    const set = projectColumnSet({ archivedAt: "2026-08-21T10:00:00.000Z" }, now);
    expect(set.archivedAt).toEqual(new Date("2026-08-21T10:00:00.000Z"));
    expect(projectColumnSet({ archivedAt: null }, now).archivedAt).toBeNull();
  });

  it("never leaks the nested wizard arrays into the UPDATE statement", () => {
    const now = new Date("2026-08-21T12:00:00");
    const set = projectColumnSet(
      {
        name: "X",
        phases: [{ name: "P1" }],
        risks: [{ title: "R1" }],
        members: [{ userId: "u1" }],
        milestones: [{ name: "M1" }],
        budgetEntries: [{ label: "B1", amountCents: 1, kind: "ist" }],
      } as Record<string, unknown>,
      now,
    );
    expect(Object.keys(set).sort()).toEqual(["name", "updatedAt"]);
  });
});

describe("PROJECT_UPDATE_QUIET_KEYS", () => {
  it("marks notesContent as the autosave-only field", () => {
    expect([...PROJECT_UPDATE_QUIET_KEYS]).toEqual(["notesContent"]);
  });
});

import { resolveProjectUpdateEffect } from "./projects";

describe("resolveProjectUpdateEffect", () => {
  it("a status change notifies, even with no other field touched", () => {
    expect(
      resolveProjectUpdateEffect({ changedKeys: ["status"], statusChanged: true, ownerChanged: false }),
    ).toBe("notify");
  });

  it("a status change wins over a simultaneous owner change — still exactly 'notify'", () => {
    expect(
      resolveProjectUpdateEffect({
        changedKeys: ["status", "ownerUserId"],
        statusChanged: true,
        ownerChanged: true,
      }),
    ).toBe("notify");
  });

  it("a loud field change with no status change records only", () => {
    expect(
      resolveProjectUpdateEffect({ changedKeys: ["name"], statusChanged: false, ownerChanged: false }),
    ).toBe("record");
  });

  it("an owner change alone still records, even with no column touched", () => {
    expect(
      resolveProjectUpdateEffect({ changedKeys: [], statusChanged: false, ownerChanged: true }),
    ).toBe("record");
  });

  it("a quiet key alongside a loud key records — the loud key is enough", () => {
    expect(
      resolveProjectUpdateEffect({
        changedKeys: ["notesContent", "name"],
        statusChanged: false,
        ownerChanged: false,
      }),
    ).toBe("record");
  });

  it("nothing changed at all stays silent", () => {
    expect(
      resolveProjectUpdateEffect({ changedKeys: [], statusChanged: false, ownerChanged: false }),
    ).toBe("silent");
  });

  it("only notesContent (a quiet key) changed stays silent — the autosave path", () => {
    expect(
      resolveProjectUpdateEffect({
        changedKeys: ["notesContent"],
        statusChanged: false,
        ownerChanged: false,
      }),
    ).toBe("silent");
  });
});
