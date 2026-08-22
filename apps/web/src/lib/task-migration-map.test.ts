import { describe, it, expect } from "vitest";
import {
  deriveTaskStatus,
  deriveOperativeArea,
  isChecklistParent,
  isCompletedContainer,
  hasOnlyCompletedChildren,
  migrationStatusColumns,
  highestPriority,
  normalizeTitle,
} from "./task-migration-map";

describe("deriveTaskStatus (spec §12.2 rule 4)", () => {
  it("maps a completed task to erledigt whatever its kanban column says", () => {
    expect(deriveTaskStatus({ isCompleted: true, kanbanStatus: "laeuft" })).toBe("erledigt");
    expect(deriveTaskStatus({ isCompleted: true, kanbanStatus: null })).toBe("erledigt");
    expect(deriveTaskStatus({ isCompleted: true, kanbanStatus: "backlog" })).toBe("erledigt");
  });

  it("maps the running columns laeuft and heute to in_arbeit", () => {
    expect(deriveTaskStatus({ isCompleted: false, kanbanStatus: "laeuft" })).toBe("in_arbeit");
    expect(deriveTaskStatus({ isCompleted: false, kanbanStatus: "heute" })).toBe("in_arbeit");
  });

  it("maps every other column and a missing column to geplant", () => {
    expect(deriveTaskStatus({ isCompleted: false, kanbanStatus: "backlog" })).toBe("geplant");
    expect(deriveTaskStatus({ isCompleted: false, kanbanStatus: "warte" })).toBe("geplant");
    expect(deriveTaskStatus({ isCompleted: false, kanbanStatus: "erledigt" })).toBe("geplant");
    expect(deriveTaskStatus({ isCompleted: false, kanbanStatus: null })).toBe("geplant");
  });
});

describe("deriveOperativeArea (spec §12.2 rule 3)", () => {
  it("routes the production damage task to schaden", () => {
    expect(
      deriveOperativeArea({ content: "Salah schaden und spiegel regeln", growthCategory: null })
    ).toBe("schaden");
  });

  it("routes the four customer-job titles named in the spec to auftrag", () => {
    for (const content of ["Michael Kugel", "Sofia 20.08", "Kyra", "Auftrag Manfred"]) {
      expect(deriveOperativeArea({ content, growthCategory: null })).toBe("auftrag");
    }
  });

  it("routes the receivable and the review link by topic, not by customer name", () => {
    expect(deriveOperativeArea({ content: "Atthina - Forderung", growthCategory: null })).toBe(
      "buchhaltung"
    );
    expect(
      deriveOperativeArea({ content: "Google-Bewertungslink Beide rein", growthCategory: null })
    ).toBe("kunde");
  });

  it("falls back to the growth_category map when no title rule matches", () => {
    expect(deriveOperativeArea({ content: "Operativ August", growthCategory: "personal" })).toBe(
      "personal"
    );
    expect(deriveOperativeArea({ content: "Operativ Juli", growthCategory: "fuhrpark" })).toBe(
      "fahrzeuge"
    );
    expect(deriveOperativeArea({ content: "Kostenkalkulator", growthCategory: "marketing" })).toBe(
      "kunde"
    );
    expect(deriveOperativeArea({ content: "Kostenkalkulator", growthCategory: "vertrieb" })).toBe(
      "kunde"
    );
    expect(deriveOperativeArea({ content: "Kostenkalkulator", growthCategory: "finanzen" })).toBe(
      "buchhaltung"
    );
  });

  it("falls back to sonstiges when neither a title rule nor the category map hits", () => {
    expect(deriveOperativeArea({ content: "Aline Verfahren", growthCategory: null })).toBe(
      "sonstiges"
    );
    expect(
      deriveOperativeArea({ content: "Operative Woche 22-29.07", growthCategory: "prozesse" })
    ).toBe("sonstiges");
    expect(deriveOperativeArea({ content: "Kostenkalkulator", growthCategory: "preise" })).toBe(
      "sonstiges"
    );
  });
});

describe("isChecklistParent (spec §12.2 rule 2 exception)", () => {
  it("recognises every allowlisted production parent, whitespace-insensitively", () => {
    for (const content of [
      "Michael Kugel",
      "Sofia 20.08",
      "Kyra",
      "Auftrag Manfred",
      "Kostenkalkulator",
      "Google-Bewertungslink Beide rein",
      "Atthina - Forderung",
      "Aline Verfahren",
      "Operativ Juli",
      "Operative Woche 22-29.07",
      "Operativ August",
    ]) {
      expect(isChecklistParent(content)).toBe(true);
      expect(isChecklistParent(`  ${content.toUpperCase()}  `)).toBe(true);
    }
  });

  it("does not recognise a project container as a checklist parent", () => {
    expect(isChecklistParent("UG Anmeldung: Stuttmove")).toBe(false);
    expect(isChecklistParent("Tracking Möglichkeiten finden für den Kunden")).toBe(false);
    expect(isChecklistParent("Buchhaltungssystem updaten")).toBe(false);
  });
});

describe("isCompletedContainer / hasOnlyCompletedChildren (spec §2.1, fifth container)", () => {
  it("knows AGBS updaten, the completed container with three completed children", () => {
    expect(isCompletedContainer("AGBS updaten")).toBe(true);
    expect(isCompletedContainer("  agbs   UPDATEN ")).toBe(true);
    expect(isCompletedContainer("Buchhaltungssystem updaten")).toBe(false);
    expect(isCompletedContainer("UG Anmeldung: Stuttmove")).toBe(false);
  });

  it("is true only when there is at least one child and every child is done", () => {
    const done = { isCompleted: true };
    const open = { isCompleted: false };
    expect(hasOnlyCompletedChildren(done, [done, done, done])).toBe(true);
    expect(hasOnlyCompletedChildren(done, [done, open, done])).toBe(false);
    expect(hasOnlyCompletedChildren(open, [done, done])).toBe(true);
    expect(hasOnlyCompletedChildren(done, [])).toBe(false);
  });
});

describe("migrationStatusColumns (invariant I3, spec §15 R2)", () => {
  it("maps erledigt to is_completed true and keeps the original completed_at", () => {
    const original = new Date("2026-07-14T09:30:00");
    expect(migrationStatusColumns("erledigt", original)).toEqual({
      status: "erledigt",
      isCompleted: true,
      completedAt: original,
    });
  });

  it("backfills completed_at only when an erledigt row has none", () => {
    const result = migrationStatusColumns("erledigt", null);
    expect(result.isCompleted).toBe(true);
    expect(result.completedAt).toBeInstanceOf(Date);
  });

  it("maps in_arbeit and geplant to is_completed false and clears completed_at", () => {
    for (const status of ["in_arbeit", "geplant"] as const) {
      expect(migrationStatusColumns(status, new Date("2026-07-14T09:30:00"))).toEqual({
        status,
        isCompleted: false,
        completedAt: null,
      });
    }
  });

  it("never lets status and is_completed disagree, for any of the three statuses", () => {
    for (const status of ["geplant", "in_arbeit", "erledigt"] as const) {
      const cols = migrationStatusColumns(status);
      expect(cols.isCompleted).toBe(status === "erledigt");
      expect(cols.completedAt === null).toBe(status !== "erledigt");
    }
  });
});

describe("highestPriority", () => {
  it("returns the strongest priority present", () => {
    expect(highestPriority(["mittel", "hoch", "niedrig"])).toBe("hoch");
    expect(highestPriority(["mittel", "sehr_hoch", "hoch"])).toBe("sehr_hoch");
    expect(highestPriority(["niedrig", null, null])).toBe("niedrig");
  });

  it("returns null when nothing usable is present", () => {
    expect(highestPriority([])).toBeNull();
    expect(highestPriority([null, "quatsch"])).toBeNull();
  });
});

describe("normalizeTitle", () => {
  it("collapses whitespace and case so name matching is stable", () => {
    expect(normalizeTitle("  UG   Anmeldung:  Stuttmove ")).toBe("ug anmeldung: stuttmove");
  });
});

import { defaultProjectColor, defaultProjectIcon } from "@/lib/project-constants";
import { MIGRATION_PROJECTS, matchesTask, matcherLabel } from "./task-migration-map";

describe("MIGRATION_PROJECTS (spec §12.1)", () => {
  it("declares exactly the eight projects, in spec order", () => {
    expect(MIGRATION_PROJECTS.map((p) => p.name)).toEqual([
      "IT-Transformation",
      "Website-Relaunch kottke-umzuege.de",
      "UG Gründung Stuttmove",
      "Ceylan Operations Aufbau",
      "Kunden-Tracking & Transparenz",
      "Buchhaltung & Belegprozess",
      "Neue Leads: Gesetzliche Betreuer",
      "Neue Leads: Zwangsräumungen",
    ]);
  });

  it("gives every project a category from PROJECT_CATEGORIES", () => {
    expect(MIGRATION_PROJECTS.map((p) => p.category)).toEqual([
      "software",
      "marketing",
      "gruendung",
      "vertrieb",
      "software",
      "finanzen",
      "vertrieb",
      "vertrieb",
    ]);
  });

  it("lists every container parent from the production audit with its child count", () => {
    const containers = MIGRATION_PROJECTS.flatMap((p) =>
      p.containers.map((c) => [matcherLabel(c.matcher), c.expectedChildren] as const)
    );
    expect(containers).toEqual([
      ["UG Anmeldung: Stuttmove", 5],
      ["Ladungsfähige Anschrift UG", 3],
      ["Ceylan-operations Website", 2],
      ["Ceylan und Kottke Connections", 2],
      ["Tracking Möglichkeiten finden für den Kunden", 6],
      ["Buchhaltungssystem updaten", 1],
      ["Gesetzliche Betreuer als neue Leads", 4],
      ["Neue Leads: Zwangsräumungen", 2],
    ]);
  });

  it("seeds the two new tasks into IT-Transformation and nowhere else", () => {
    const seeded = MIGRATION_PROJECTS.filter((p) => p.seedTasks.length > 0);
    expect(seeded).toHaveLength(1);
    expect(seeded[0].name).toBe("IT-Transformation");
    expect(seeded[0].seedTasks.map((t) => t.content)).toEqual([
      "Aufgabensystem zu Projekten & operativen Aufgaben umbauen",
      "Buchhaltungssystem aktualisieren",
    ]);
  });

  it("pins the CRM redesign task by its production id, not by title", () => {
    const it = MIGRATION_PROJECTS[0];
    expect(it.members[0]).toEqual({ by: "id", id: "b1517e4b-c4c1-4952-9a0a-944efbbee785" });
  });

  it("keeps every icon and colour on the category palette", () => {
    // createProject() stores icon/color as given and the read layer defaults
    // them via defaultProjectIcon / defaultProjectColor. The eight migrated
    // projects set both explicitly, so this pins them to the same palette —
    // otherwise they would be the only projects in the CRM whose colour does
    // not follow their category.
    for (const p of MIGRATION_PROJECTS) {
      expect(p.icon).toBe(defaultProjectIcon(p.category));
      expect(p.color).toBe(defaultProjectColor(p.category, p.name));
    }
  });

  it("guards the website patterns to Sprint 2 and expects nine members", () => {
    const website = MIGRATION_PROJECTS[1];
    expect(website.memberGuard).toEqual({ sprintName: "Sprint 2" });
    expect(website.members).toHaveLength(9);
    expect(website.expectedMembers).toBe(9);
  });
});

describe("matchesTask", () => {
  const row = { id: "b1517e4b-c4c1-4952-9a0a-944efbbee785", content: "Überarbeitung der KI" };

  it("matches by exact id", () => {
    expect(matchesTask({ by: "id", id: row.id }, row)).toBe(true);
    expect(matchesTask({ by: "id", id: "other" }, row)).toBe(false);
  });

  it("matches by title, whitespace- and case-insensitively", () => {
    expect(matchesTask({ by: "title", title: "  überarbeitung   der KI " }, row)).toBe(true);
    expect(matchesTask({ by: "title", title: "Überarbeitung" }, row)).toBe(false);
  });

  it("matches by pattern", () => {
    expect(matchesTask({ by: "pattern", pattern: /überarbeitung/i }, row)).toBe(true);
  });

  it("does not let the exact-title matcher for Gesetzliche Betreuer swallow its container", () => {
    expect(
      matchesTask(
        { by: "title", title: "Gesetzliche Betreuer" },
        { id: "x", content: "Gesetzliche Betreuer als neue Leads" }
      )
    ).toBe(false);
  });
});

import { planTaskMigration, type MigrationTaskRow } from "./task-migration-map";

function row(
  partial: Partial<MigrationTaskRow> & { id: string; content: string }
): MigrationTaskRow {
  return {
    isCompleted: false,
    kanbanStatus: null,
    parentTaskId: null,
    sprintId: null,
    growthCategory: null,
    priority: null,
    kind: null,
    projectId: null,
    area: null,
    status: null,
    ...partial,
  };
}

/** A slice of the real production board, titles verbatim. */
function productionRows(): MigrationTaskRow[] {
  return [
    row({
      id: "b1517e4b-c4c1-4952-9a0a-944efbbee785",
      content: "Task-Setup und Projektplanung im CRM neu denken und redesignen",
      priority: "hoch",
      kanbanStatus: "laeuft",
    }),
    row({ id: "t-ki", content: "Überarbeitung der KI", priority: "mittel" }),
    row({ id: "t-chat", content: "Chat Funktion erweitern" }),
    row({ id: "t-inbox", content: "Besprechung: CRM - Inbox - Darstellung", isCompleted: true }),

    row({ id: "t-ug", content: "UG Anmeldung: Stuttmove", isCompleted: true }),
    row({ id: "t-ug-1", content: "Notartermin vereinbaren", parentTaskId: "t-ug" }),
    row({ id: "t-ug-2", content: "Gesellschaftsvertrag prüfen", parentTaskId: "t-ug" }),
    row({ id: "t-ug-3", content: "Geschäftskonto eröffnen", parentTaskId: "t-ug" }),
    row({ id: "t-ug-4", content: "Handelsregisteranmeldung", parentTaskId: "t-ug", priority: "sehr_hoch" }),
    row({ id: "t-ug-5", content: "Gewerbeanmeldung", parentTaskId: "t-ug" }),
    row({ id: "t-ug-solo", content: "UG Anmeldung" }),

    row({ id: "t-track", content: "Tracking Möglichkeiten finden für den Kunden", isCompleted: true }),
    ...["a", "b", "c", "d", "e", "f"].map((s, i) =>
      row({ id: `t-track-${s}`, content: `Tracking Baustein ${i + 1}`, parentTaskId: "t-track" })
    ),

    row({ id: "t-mk", content: "Michael Kugel" }),
    row({ id: "t-mk-1", content: "Mitarbeiter", parentTaskId: "t-mk" }),
    row({ id: "t-mk-2", content: "Transporter", parentTaskId: "t-mk" }),

    // Spec §2.1's fifth container: completed, 3 children, none of them open.
    row({ id: "t-agb", content: "AGBS updaten", isCompleted: true }),
    row({ id: "t-agb-1", content: "AGB Entwurf prüfen", parentTaskId: "t-agb", isCompleted: true }),
    row({ id: "t-agb-2", content: "AGB auf Website einbinden", parentTaskId: "t-agb", isCompleted: true }),
    row({ id: "t-agb-3", content: "AGB im Angebot verlinken", parentTaskId: "t-agb", isCompleted: true }),

    row({ id: "t-salah", content: "Salah schaden und spiegel regeln", kanbanStatus: "heute" }),
    row({ id: "t-seo", content: "SEO/GEO Grundlagen umsetzen", sprintId: "s2", growthCategory: "marketing" }),
    row({ id: "t-seo-elsewhere", content: "SEO Notizen sammeln", sprintId: null }),
  ];
}

const SPRINT_NAMES = { s1: "Sprint Nr. 1", s2: "Sprint 2" };

describe("planTaskMigration — first run", () => {
  const plan = planTaskMigration({
    tasks: productionRows(),
    existingProjects: [],
    sprintNameById: SPRINT_NAMES,
    ownerUserId: "ArqJKlS5mJfeqRpchepM3bfAYHCEyOHR",
  });

  it("plans all eight projects as new and owned by Dario", () => {
    expect(plan.projects).toHaveLength(8);
    expect(plan.projects.every((p) => p.existingId === null)).toBe(true);
    expect(plan.projects.every((p) => p.ownerUserId === "ArqJKlS5mJfeqRpchepM3bfAYHCEyOHR")).toBe(
      true
    );
  });

  it("takes the project priority from the strongest source task", () => {
    expect(plan.projects.find((p) => p.key === "it-transformation")!.priority).toBe("hoch");
    expect(plan.projects.find((p) => p.key === "ug-gruendung-stuttmove")!.priority).toBe(
      "sehr_hoch"
    );
  });

  it("dissolves the container parents and reparents their children", () => {
    expect(plan.deletions.map((d) => d.taskId).sort()).toEqual(["t-track", "t-ug"]);
    const ugKid = plan.updates.find((u) => u.taskId === "t-ug-4")!;
    expect(ugKid.kind).toBe("projekt");
    expect(ugKid.projectKey).toBe("ug-gruendung-stuttmove");
    expect(ugKid.clearParent).toBe(true);
    expect(ugKid.area).toBeNull();
  });

  it("never emits an update for a task it is going to delete", () => {
    const deleted = new Set(plan.deletions.map((d) => d.taskId));
    expect(plan.updates.some((u) => deleted.has(u.taskId))).toBe(false);
  });

  it("keeps the checklist parent intact and lets its children inherit its area", () => {
    const parent = plan.updates.find((u) => u.taskId === "t-mk")!;
    expect(parent.kind).toBe("operativ");
    expect(parent.area).toBe("auftrag");
    expect(parent.clearParent).toBe(false);
    for (const id of ["t-mk-1", "t-mk-2"]) {
      const kid = plan.updates.find((u) => u.taskId === id)!;
      expect(kid.area).toBe("auftrag");
      expect(kid.clearParent).toBe(false);
    }
  });

  it("derives the operative area and status of a leaf task", () => {
    const salah = plan.updates.find((u) => u.taskId === "t-salah")!;
    expect(salah.kind).toBe("operativ");
    expect(salah.area).toBe("schaden");
    expect(salah.status).toBe("in_arbeit");
  });

  it("applies the Sprint-2 guard to the website patterns", () => {
    expect(plan.updates.find((u) => u.taskId === "t-seo")!.projectKey).toBe("website-relaunch");
    expect(plan.updates.find((u) => u.taskId === "t-seo-elsewhere")!.projectKey).toBeNull();
  });

  it("seeds the two IT-Transformation tasks", () => {
    expect(plan.newTasks).toEqual([
      {
        projectKey: "it-transformation",
        content: "Aufgabensystem zu Projekten & operativen Aufgaben umbauen",
        description: expect.any(String),
        priority: "hoch",
      },
      {
        projectKey: "it-transformation",
        content: "Buchhaltungssystem aktualisieren",
        description: expect.any(String),
        priority: "hoch",
      },
    ]);
  });

  it("balances the task count: before - deleted + created", () => {
    expect(plan.counts.tasksBefore).toBe(28);
    expect(plan.counts.containersDeleted).toBe(2);
    expect(plan.counts.tasksCreated).toBe(2);
    expect(plan.counts.tasksAfter).toBe(28);
    expect(plan.updates).toHaveLength(26);
  });

  it("keeps the completed container AGBS updaten operative instead of making it a project", () => {
    expect(plan.deletions.some((d) => d.taskId === "t-agb")).toBe(false);
    const parent = plan.updates.find((u) => u.taskId === "t-agb")!;
    expect(parent.kind).toBe("operativ");
    expect(parent.projectKey).toBeNull();
    expect(parent.area).toBe("sonstiges");
    expect(parent.status).toBe("erledigt");
    expect(parent.clearParent).toBe(false);
    for (const id of ["t-agb-1", "t-agb-2", "t-agb-3"]) {
      const kid = plan.updates.find((u) => u.taskId === id)!;
      expect(kid.kind).toBe("operativ");
      expect(kid.projectKey).toBeNull();
      expect(kid.area).toBe("sonstiges");
      expect(kid.status).toBe("erledigt");
      expect(kid.clearParent).toBe(false);
    }
  });

  it("does not flag AGBS updaten as an unclassified parent", () => {
    expect(plan.warnings.join("\n")).not.toMatch(/AGBS updaten[\s\S]*weder in der Projekttabelle/);
  });

  it("warns about a container whose child count drifted from the audit", () => {
    expect(plan.warnings.join("\n")).toMatch(/Ladungsfähige Anschrift UG[\s\S]*nicht gefunden/);
  });
});

describe("planTaskMigration — second run is a no-op", () => {
  it("keeps every task where it is, even after Sprint 2 was closed and carried over", () => {
    const first = productionRows();
    const migrated: MigrationTaskRow[] = first
      .filter((t) => t.id !== "t-ug" && t.id !== "t-track")
      .map((t) => {
        const projectRows: Record<string, string> = {
          "b1517e4b-c4c1-4952-9a0a-944efbbee785": "p-it",
          "t-ki": "p-it",
          "t-chat": "p-it",
          "t-inbox": "p-it",
          "t-ug-1": "p-ug",
          "t-ug-2": "p-ug",
          "t-ug-3": "p-ug",
          "t-ug-4": "p-ug",
          "t-ug-5": "p-ug",
          "t-ug-solo": "p-ug",
          "t-track-a": "p-track",
          "t-track-b": "p-track",
          "t-track-c": "p-track",
          "t-track-d": "p-track",
          "t-track-e": "p-track",
          "t-track-f": "p-track",
          // closeSprint() nulled the sprint on carry-over: the guard no
          // longer matches, so only project_id can hold this task in place.
          "t-seo": "p-web",
        };
        const projectId = projectRows[t.id] ?? null;
        const isProject = projectId !== null;
        const status = t.isCompleted
          ? "erledigt"
          : t.kanbanStatus === "laeuft" || t.kanbanStatus === "heute"
            ? "in_arbeit"
            : "geplant";
        return {
          ...t,
          sprintId: t.id === "t-seo" ? null : t.sprintId,
          parentTaskId: t.parentTaskId === "t-ug" || t.parentTaskId === "t-track" ? null : t.parentTaskId,
          kind: isProject ? "projekt" : "operativ",
          projectId,
          area: isProject
            ? null
            : t.parentTaskId === "t-mk" || t.id === "t-mk"
              ? "auftrag"
              : t.id === "t-salah"
                ? "schaden"
                : t.id === "t-seo-elsewhere"
                  ? "sonstiges"
                  : "sonstiges",
          status,
        };
      });
    migrated.push(
      row({
        id: "t-new-1",
        content: "Aufgabensystem zu Projekten & operativen Aufgaben umbauen",
        kind: "projekt",
        projectId: "p-it",
        status: "geplant",
      }),
      row({
        id: "t-new-2",
        content: "Buchhaltungssystem aktualisieren",
        kind: "projekt",
        projectId: "p-it",
        status: "geplant",
      })
    );

    const plan = planTaskMigration({
      tasks: migrated,
      existingProjects: [
        { id: "p-it", name: "IT-Transformation" },
        { id: "p-web", name: "Website-Relaunch kottke-umzuege.de" },
        { id: "p-ug", name: "UG Gründung Stuttmove" },
        { id: "p-ceylan", name: "Ceylan Operations Aufbau" },
        { id: "p-track", name: "Kunden-Tracking & Transparenz" },
        { id: "p-buch", name: "Buchhaltung & Belegprozess" },
        { id: "p-betreuer", name: "Neue Leads: Gesetzliche Betreuer" },
        { id: "p-zwang", name: "Neue Leads: Zwangsräumungen" },
      ],
      sprintNameById: { s1: "Sprint Nr. 1", s2: "Sprint 2" },
      ownerUserId: "ArqJKlS5mJfeqRpchepM3bfAYHCEyOHR",
    });

    expect(plan.projects.every((p) => p.existingId !== null)).toBe(true);
    expect(plan.deletions).toEqual([]);
    expect(plan.newTasks).toEqual([]);
    expect(plan.updates.filter((u) => u.changed)).toEqual([]);
    expect(plan.updates.find((u) => u.taskId === "t-seo")!.projectKey).toBe("website-relaunch");
  });
});

import { planSprintRotation, toIsoDate, type MigrationSprintRow } from "./task-migration-map";

const PRODUCTION_SPRINTS: MigrationSprintRow[] = [
  {
    id: "s1",
    name: "Sprint Nr. 1",
    state: "abgeschlossen",
    startDate: new Date("2026-07-08T00:00:00"),
    endDate: new Date("2026-07-21T23:59:59"),
  },
  {
    id: "s2",
    name: "Sprint 2",
    state: "aktiv",
    startDate: new Date("2026-07-22T00:00:00"),
    endDate: new Date("2026-08-04T23:59:59"),
  },
];

describe("planSprintRotation (spec §12.2 rule 7)", () => {
  it("closes the expired Sprint 2 and opens a 14-day Sprint 3 from the run date", () => {
    const plan = planSprintRotation(PRODUCTION_SPRINTS, new Date("2026-08-21T10:00:00"));
    expect(plan.closeSprintId).toBe("s2");
    expect(plan.closeSprintName).toBe("Sprint 2");
    expect(plan.createSprint).toEqual({
      name: "Sprint 3",
      goal: "Erster Sprint im neuen Projekt- und Aufgabenmodell.",
      startDate: "2026-08-21",
      endDate: "2026-09-03",
    });
    expect(plan.activateExistingSprintId).toBeNull();
  });

  it("is a no-op once Sprint 3 exists and runs", () => {
    const after: MigrationSprintRow[] = [
      PRODUCTION_SPRINTS[0],
      { ...PRODUCTION_SPRINTS[1], state: "abgeschlossen" },
      {
        id: "s3",
        name: "Sprint 3",
        state: "aktiv",
        startDate: new Date("2026-08-21T00:00:00"),
        endDate: new Date("2026-09-03T00:00:00"),
      },
    ];
    const plan = planSprintRotation(after, new Date("2026-08-22T10:00:00"));
    expect(plan.closeSprintId).toBeNull();
    expect(plan.createSprint).toBeNull();
    expect(plan.activateExistingSprintId).toBeNull();
  });

  it("activates an existing but unstarted Sprint 3 instead of creating a second one", () => {
    const after: MigrationSprintRow[] = [
      PRODUCTION_SPRINTS[0],
      { ...PRODUCTION_SPRINTS[1], state: "abgeschlossen" },
      {
        id: "s3",
        name: "Sprint 3",
        state: "planung",
        startDate: new Date("2026-08-21T00:00:00"),
        endDate: new Date("2026-09-03T00:00:00"),
      },
    ];
    const plan = planSprintRotation(after, new Date("2026-08-22T10:00:00"));
    expect(plan.createSprint).toBeNull();
    expect(plan.activateExistingSprintId).toBe("s3");
  });

  it("never closes a sprint that is already the target sprint", () => {
    const plan = planSprintRotation(
      [{ id: "s3", name: "Sprint 3", state: "aktiv", startDate: null, endDate: null }],
      new Date("2026-08-21T10:00:00")
    );
    expect(plan.closeSprintId).toBeNull();
  });
});

describe("toIsoDate", () => {
  it("formats in local time, so a late-evening run does not slip a day", () => {
    expect(toIsoDate(new Date("2026-08-21T23:30:00"))).toBe("2026-08-21");
    expect(toIsoDate(new Date("2026-01-05T00:10:00"))).toBe("2026-01-05");
  });
});

import { evaluateVerification, type VerificationInput } from "./task-migration-map";

const CLEAN: VerificationInput = {
  projektWithoutProject: 0,
  operativWithProject: 0,
  phaseMismatch: 0,
  statusMismatch: 0,
  orphanParents: 0,
  danglingProjectRefs: 0,
  leiterMismatch: 0,
  taskCountBefore: 222,
  containersDeleted: 8,
  tasksCreated: 2,
  taskCountNow: 216,
};

describe("evaluateVerification (spec §14)", () => {
  it("passes a clean production state and returns all eight checks", () => {
    const result = evaluateVerification(CLEAN);
    expect(result.checks).toHaveLength(8);
    expect(result.checks.every((c) => c.status === "PASS")).toBe(true);
    expect(result.passed).toBe(true);
  });

  it("fails when a projekt task has no project_id", () => {
    const result = evaluateVerification({ ...CLEAN, projektWithoutProject: 3 });
    expect(result.passed).toBe(false);
    const check = result.checks.find((c) => c.name.includes("kind='projekt'"))!;
    expect(check.status).toBe("FAIL");
    expect(check.actual).toBe("3");
  });

  it("fails when status and is_completed disagree", () => {
    const result = evaluateVerification({ ...CLEAN, statusMismatch: 1 });
    expect(result.checks.find((c) => c.name.includes("is_completed"))!.status).toBe("FAIL");
  });

  it("fails when a delete orphaned children behind a missing parent", () => {
    const result = evaluateVerification({ ...CLEAN, orphanParents: 5 });
    expect(result.checks.find((c) => c.name.includes("Verwaiste"))!.status).toBe("FAIL");
  });

  it("fails when a project has no leiter row, or one that is not its owner", () => {
    const result = evaluateVerification({ ...CLEAN, leiterMismatch: 8 });
    expect(result.passed).toBe(false);
    const check = result.checks.find((c) => c.name.includes("Projektleiter"))!;
    expect(check.status).toBe("FAIL");
    expect(check.actual).toBe("8");
  });

  it("does the count arithmetic 222 - 8 + 2 = 216 and reports the delta on a miss", () => {
    expect(evaluateVerification(CLEAN).checks.at(-1)!.status).toBe("PASS");
    const bad = evaluateVerification({ ...CLEAN, taskCountNow: 214 });
    const check = bad.checks.at(-1)!;
    expect(check.status).toBe("FAIL");
    expect(check.expected).toBe("216");
    expect(check.actual).toBe("214");
  });

  it("skips the count check without a backup baseline, and still passes", () => {
    const result = evaluateVerification({
      ...CLEAN,
      taskCountBefore: null,
      containersDeleted: null,
      tasksCreated: null,
    });
    expect(result.checks.at(-1)!.status).toBe("SKIP");
    expect(result.passed).toBe(true);
  });
});
