import { describe, expect, it } from "vitest";
import {
  computeDashboardKpis,
  foldTeamOverview,
  mergeUpcoming,
  describeActivityEvent,
  toActivityFeedEntries,
  type UpcomingEntry,
} from "./work-dashboard";
import { timelineWindow, projectWindowBounds } from "./work-dashboard";

describe("computeDashboardKpis", () => {
  it("computes the overall progress over ACTIVE projects only", () => {
    const kpis = computeDashboardKpis({
      activeProjects: [
        { totalTasks: 10, doneTasks: 6 },
        { totalTasks: 10, doneTasks: 4 },
      ],
      projectTotal: 3,
      activeProjectTotal: 2,
      operativeOpen: 7,
      operativeDueToday: 2,
      overdue: 3,
      sprintAssigned: 0,
      sprintDone: 0,
      hasActiveSprint: false,
    });
    expect(kpis.overallProgressPct).toBe(50);
    expect(kpis.projectCount).toBe(3);
    expect(kpis.activeProjectCount).toBe(2);
    expect(kpis.operativeOpenCount).toBe(7);
    expect(kpis.operativeDueTodayCount).toBe(2);
    expect(kpis.overdueCount).toBe(3);
  });

  it("takes the project counts from the query total, never from the page", () => {
    // listProjects caps at 200 rows. Deriving projectCount from the array
    // length would silently freeze the tile at 200.
    const kpis = computeDashboardKpis({
      activeProjects: [{ totalTasks: 1, doneTasks: 1 }],
      projectTotal: 412,
      activeProjectTotal: 207,
      operativeOpen: 0,
      operativeDueToday: 0,
      overdue: 0,
      sprintAssigned: 0,
      sprintDone: 0,
      hasActiveSprint: false,
    });
    expect(kpis.projectCount).toBe(412);
    expect(kpis.activeProjectCount).toBe(207);
  });

  it("shows no team utilisation when there is no active sprint (spec §6)", () => {
    const kpis = computeDashboardKpis({
      activeProjects: [],
      projectTotal: 0,
      activeProjectTotal: 0,
      operativeOpen: 0,
      operativeDueToday: 0,
      overdue: 0,
      sprintAssigned: 12,
      sprintDone: 6,
      hasActiveSprint: false,
    });
    expect(kpis.teamUtilizationPct).toBeNull();
  });

  it("computes team utilisation from the active sprint's assignments", () => {
    const kpis = computeDashboardKpis({
      activeProjects: [],
      projectTotal: 0,
      activeProjectTotal: 0,
      operativeOpen: 0,
      operativeDueToday: 0,
      overdue: 0,
      sprintAssigned: 12,
      sprintDone: 9,
      hasActiveSprint: true,
    });
    expect(kpis.teamUtilizationPct).toBe(75);
  });

  it("is 0 percent overall progress when no active project has any task", () => {
    const kpis = computeDashboardKpis({
      activeProjects: [{ totalTasks: 0, doneTasks: 0 }],
      projectTotal: 1,
      activeProjectTotal: 1,
      operativeOpen: 0,
      operativeDueToday: 0,
      overdue: 0,
      sprintAssigned: 0,
      sprintDone: 0,
      hasActiveSprint: true,
    });
    expect(kpis.overallProgressPct).toBe(0);
    expect(kpis.teamUtilizationPct).toBe(0);
  });
});

describe("foldTeamOverview", () => {
  it("counts assigned, done and overdue per member and sorts by name", () => {
    const rows = foldTeamOverview(
      [
        { userId: "u2", name: "Nuri", image: null },
        { userId: "u1", name: "Dario", image: "img" },
      ],
      [
        { userId: "u1", done: true, overdue: false },
        { userId: "u1", done: false, overdue: true },
        { userId: "u2", done: true, overdue: false },
        { userId: "u2", done: true, overdue: false },
      ],
    );
    expect(rows.map((r) => r.name)).toEqual(["Dario", "Nuri"]);
    expect(rows[0]).toEqual({
      userId: "u1",
      name: "Dario",
      image: "img",
      assigned: 2,
      done: 1,
      overdue: 1,
      pct: 50,
    });
    expect(rows[1].pct).toBe(100);
  });

  it("keeps a member with no assignments at 0 percent", () => {
    const rows = foldTeamOverview([{ userId: "u1", name: "Dario", image: null }], []);
    expect(rows[0]).toEqual({
      userId: "u1",
      name: "Dario",
      image: null,
      assigned: 0,
      done: 0,
      overdue: 0,
      pct: 0,
    });
  });

  it("ignores assignments of people who are not workspace members", () => {
    const rows = foldTeamOverview(
      [{ userId: "u1", name: "Dario", image: null }],
      [{ userId: "ghost", done: true, overdue: false }],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].assigned).toBe(0);
  });
});

describe("mergeUpcoming", () => {
  const now = new Date("2026-08-21T10:00:00");
  const entry = (id: string, date: string): UpcomingEntry => ({
    id,
    kind: "milestone",
    title: id,
    date: new Date(date),
    subtitle: null,
    url: `/tasks/projects/${id}`,
  });

  it("sorts by date ascending and drops past entries", () => {
    const out = mergeUpcoming(
      [entry("c", "2026-09-01"), entry("a", "2026-08-10"), entry("b", "2026-08-25")],
      now,
    );
    expect(out.map((e) => e.id)).toEqual(["b", "c"]);
  });

  it("keeps an entry that is due today", () => {
    const out = mergeUpcoming([entry("today", "2026-08-21T18:00:00")], now);
    expect(out.map((e) => e.id)).toEqual(["today"]);
  });

  it("caps the list at the requested limit", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      entry(`m${i}`, `2026-09-${String(i + 1).padStart(2, "0")}`),
    );
    expect(mergeUpcoming(many, now, 5)).toHaveLength(5);
  });
});

describe("describeActivityEvent", () => {
  it("renders German titles for the project events", () => {
    expect(describeActivityEvent("project.created", { projectName: "IT-Transformation" })).toEqual({
      title: "Projekt angelegt",
      description: "IT-Transformation",
    });
    expect(describeActivityEvent("project.milestone_reached", { projectName: "X" }).title).toBe(
      "Meilenstein erreicht",
    );
  });

  it("falls back to the raw event type for anything unknown", () => {
    expect(describeActivityEvent("deal.stage_changed", {})).toEqual({
      title: "deal.stage_changed",
      description: null,
    });
  });

  it("survives a payload without a project name", () => {
    expect(describeActivityEvent("project.updated", {}).description).toBeNull();
  });

  // Carried-forward requirement (not in the Task 16 brief): a previous batch
  // added the project.milestone_created literal and its
  // {milestoneName, dueDate} payload; a review found ACTIVITY_TITLES and
  // describeActivityEvent both needed a matching entry or the feed would
  // render the raw literal and drop the milestone name/date silently.
  it("renders the milestone name and German due date from the payload", () => {
    expect(
      describeActivityEvent("project.milestone_created", {
        projectName: "X",
        milestoneName: "Kickoff",
        dueDate: "2026-09-01",
      }),
    ).toEqual({
      title: "Neuer Meilenstein",
      description: "Kickoff · fällig am 01.09.2026",
    });
  });

  it("falls back to the milestone name alone when there is no due date", () => {
    expect(
      describeActivityEvent("project.milestone_created", {
        projectName: "X",
        milestoneName: "Kickoff",
      }),
    ).toEqual({ title: "Neuer Meilenstein", description: "Kickoff" });
  });

  it("falls back to the project name when the milestone payload has no name", () => {
    expect(describeActivityEvent("project.milestone_created", { projectName: "X" })).toEqual({
      title: "Neuer Meilenstein",
      description: "X",
    });
  });

  // Same treatment as project.milestone_created above: memberName and role
  // travel in the payload (project-members.ts) precisely so this branch can
  // render "<name> ist jetzt <Rolle>" without a second lookup. Deleting this
  // branch is a surviving mutant — every other test in the 598-strong suite
  // still passes because nothing else exercises project.member_role_changed.
  it("renders the member name and German role label for a role change", () => {
    expect(
      describeActivityEvent("project.member_role_changed", {
        projectName: "X",
        memberName: "Nuri",
        role: "leiter",
      }),
    ).toEqual({
      title: "Rolle geändert",
      description: "Nuri ist jetzt Projektleiter",
    });
  });

  it("falls back to the project name when the role-change payload is incomplete", () => {
    expect(describeActivityEvent("project.member_role_changed", { projectName: "X" })).toEqual({
      title: "Rolle geändert",
      description: "X",
    });
  });
});

describe("toActivityFeedEntries", () => {
  it("maps a joined activity row to the wire shape via describeActivityEvent", () => {
    const createdAt = new Date("2026-08-21T09:00:00");
    const rows = toActivityFeedEntries([
      {
        id: "ev1",
        eventType: "project.member_role_changed",
        payload: { projectName: "X", memberName: "Nuri", role: "leiter" },
        createdAt,
        actorName: "Dario",
      },
    ]);
    expect(rows).toEqual([
      {
        id: "ev1",
        type: "project.member_role_changed",
        title: "Rolle geändert",
        description: "Nuri ist jetzt Projektleiter",
        createdAt,
        actorName: "Dario",
      },
    ]);
  });

  it("defaults a null payload to {} and a null actor to null", () => {
    const createdAt = new Date("2026-08-21T09:00:00");
    const rows = toActivityFeedEntries([
      { id: "ev2", eventType: "project.created", payload: null, createdAt, actorName: null },
    ]);
    expect(rows[0]).toEqual({
      id: "ev2",
      type: "project.created",
      title: "Projekt angelegt",
      description: null,
      createdAt,
      actorName: null,
    });
  });
});

describe("projectWindowBounds — the project's own Zeitleiste tab", () => {
  const now = new Date(2026, 7, 21, 10, 0);

  it("uses the project's own start and end when both are set", () => {
    const b = projectWindowBounds(new Date(2026, 8, 1), new Date(2026, 9, 31), [], now);
    expect(b.start).toEqual(new Date(2026, 8, 1));
    expect(b.end).toEqual(new Date(2026, 9, 31));
  });

  it("falls back to the min/max of the task dates", () => {
    const b = projectWindowBounds(
      null,
      null,
      [new Date(2026, 8, 10), new Date(2026, 8, 3), new Date(2026, 8, 25)],
      now,
    );
    expect(b.start).toEqual(new Date(2026, 8, 3));
    expect(b.end).toEqual(new Date(2026, 8, 25));
  });

  it("spans the project dates AND any task that falls outside them", () => {
    const b = projectWindowBounds(
      new Date(2026, 8, 10),
      new Date(2026, 8, 20),
      [new Date(2026, 8, 1), new Date(2026, 8, 30)],
      now,
    );
    expect(b.start).toEqual(new Date(2026, 8, 1));
    expect(b.end).toEqual(new Date(2026, 8, 30));
  });

  it("falls back to 28 days around today when there is no date at all", () => {
    const b = projectWindowBounds(null, null, [], now);
    expect(b.start).toEqual(new Date(2026, 7, 14));
    expect(b.end).toEqual(new Date(2026, 8, 10));
  });

  it("never returns a window narrower than a week", () => {
    const b = projectWindowBounds(new Date(2026, 8, 1), new Date(2026, 8, 2), [], now);
    const spanDays = Math.round((b.end.getTime() - b.start.getTime()) / 86_400_000) + 1;
    expect(spanDays).toBe(7);
  });
});

describe("timelineWindow", () => {
  const now = new Date("2026-08-21T10:00:00");

  it("uses the sprint dates when both are set", () => {
    const w = timelineWindow(new Date("2026-08-17T00:00:00"), new Date("2026-08-30T00:00:00"), now);
    expect(w.windowStart).toEqual(new Date("2026-08-17T00:00:00"));
    expect(w.windowEnd).toEqual(new Date("2026-08-30T00:00:00"));
    expect(w.days).toHaveLength(14);
    expect(w.days[0]).toEqual(new Date("2026-08-17T00:00:00"));
    expect(w.days[13]).toEqual(new Date("2026-08-30T00:00:00"));
  });

  it("falls back to a two-week window around today without a sprint", () => {
    const w = timelineWindow(null, null, now);
    expect(w.days).toHaveLength(14);
    expect(w.windowStart.getDate()).toBe(18);
    expect(w.windowEnd.getDate()).toBe(31);
  });

  it("caps an absurdly long sprint at 60 columns", () => {
    const w = timelineWindow(new Date("2026-01-01T00:00:00"), new Date("2026-12-31T00:00:00"), now);
    expect(w.days).toHaveLength(60);
  });

  it("never returns an inverted window", () => {
    const w = timelineWindow(new Date("2026-08-30T00:00:00"), new Date("2026-08-17T00:00:00"), now);
    expect(w.windowEnd.getTime()).toBeGreaterThanOrEqual(w.windowStart.getTime());
  });
});
