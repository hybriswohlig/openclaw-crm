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
