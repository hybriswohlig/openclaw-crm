import { describe, it, expect } from "vitest";
import {
  PROJECT_CATEGORIES,
  OPERATIVE_AREAS,
  PROJECT_STATUS,
  PHASE_STATUS,
  TASK_STATUS,
  MILESTONE_STATUS,
  RISK_SEVERITY,
  RISK_STATUS,
  PROJECT_MEMBER_ROLE,
  BUDGET_ENTRY_KIND,
  TASK_KIND,
  SPRINT_METRICS_BASIS,
  normalizeProjectCategory,
  normalizeOperativeArea,
  normalizeProjectStatus,
  normalizePhaseStatus,
  normalizeTaskStatus,
  normalizeMilestoneStatus,
  normalizeRiskSeverity,
  normalizeRiskStatus,
  normalizeProjectMemberRole,
  normalizeBudgetEntryKind,
  normalizeTaskKind,
  normalizeSprintMetricsBasis,
  projectCategoryLabel,
  operativeAreaLabel,
  projectStatusLabel,
  taskStatusLabel,
  phaseStatusLabel,
  milestoneStatusLabel,
  riskSeverityLabel,
  riskStatusLabel,
  projectMemberRoleLabel,
  budgetEntryKindLabel,
  taskKindLabel,
  OVERDUE_STATE,
  overdueLabel,
  defaultProjectIcon,
  defaultProjectColor,
} from "./project-constants";

describe("project constant lists", () => {
  it("keeps the 13 project categories and the 10 operative areas", () => {
    expect(PROJECT_CATEGORIES).toHaveLength(13);
    expect(OPERATIVE_AREAS).toHaveLength(10);
    expect(PROJECT_CATEGORIES.map((c) => c.value)).toEqual([
      "leistung",
      "vertrieb",
      "marketing",
      "personal",
      "fuhrpark",
      "standorte",
      "gruendung",
      "prozesse",
      "partner",
      "preise",
      "qualitaet",
      "software",
      "finanzen",
    ]);
    expect(OPERATIVE_AREAS.map((a) => a.value)).toEqual([
      "angebot",
      "auftrag",
      "nachsorge",
      "schaden",
      "personal",
      "fahrzeuge",
      "beschaffung",
      "buchhaltung",
      "kunde",
      "sonstiges",
    ]);
  });

  it("gives every category an icon and a hex colour", () => {
    for (const category of PROJECT_CATEGORIES) {
      expect(category.icon.length).toBeGreaterThan(0);
      expect(category.color).toMatch(/^#[0-9a-f]{6}$/);
    }
    for (const area of OPERATIVE_AREAS) {
      expect(area.icon.length).toBeGreaterThan(0);
    }
  });

  it("keeps the mockups' banned indigo out of the palette and every colour distinct", () => {
    // #6366f1 must always resolve to var(--kottke-accent); a literal copy in
    // the palette would break dark mode and force the design gate to carry a
    // permanent exception. 'partner' used to be that indigo.
    const colors = PROJECT_CATEGORIES.map((c) => c.color);
    expect(colors).not.toContain("#6366f1");
    expect(PROJECT_CATEGORIES.find((c) => c.value === "partner")?.color).toBe("#db2777");
    // Two categories sharing a colour would be indistinguishable on a project
    // card or a timeline row label.
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("keeps the status vocabularies from spec 5", () => {
    expect(PROJECT_STATUS).toEqual([
      "geplant",
      "aktiv",
      "pausiert",
      "abgeschlossen",
      "abgebrochen",
    ]);
    expect(PHASE_STATUS).toEqual(["geplant", "in_arbeit", "abgeschlossen"]);
    expect(TASK_STATUS).toEqual(["geplant", "in_arbeit", "erledigt"]);
    expect(MILESTONE_STATUS).toEqual(["geplant", "erreicht", "verfehlt"]);
    expect(RISK_SEVERITY).toEqual(["niedrig", "mittel", "hoch"]);
    expect(RISK_STATUS).toEqual(["offen", "beobachtet", "geschlossen"]);
    expect(PROJECT_MEMBER_ROLE).toEqual(["leiter", "mitglied", "beobachter"]);
    expect(BUDGET_ENTRY_KIND).toEqual(["plan", "ist"]);
    expect(TASK_KIND).toEqual(["projekt", "operativ"]);
    expect(SPRINT_METRICS_BASIS).toEqual(["tasks", "points"]);
  });
});

describe("normalize helpers", () => {
  it("passes known values through", () => {
    expect(normalizeProjectCategory("software")).toBe("software");
    expect(normalizeOperativeArea("schaden")).toBe("schaden");
    expect(normalizeProjectStatus("pausiert")).toBe("pausiert");
    expect(normalizePhaseStatus("in_arbeit")).toBe("in_arbeit");
    expect(normalizeTaskStatus("erledigt")).toBe("erledigt");
    expect(normalizeMilestoneStatus("verfehlt")).toBe("verfehlt");
    expect(normalizeRiskSeverity("hoch")).toBe("hoch");
    expect(normalizeRiskStatus("beobachtet")).toBe("beobachtet");
    expect(normalizeProjectMemberRole("leiter")).toBe("leiter");
    expect(normalizeBudgetEntryKind("ist")).toBe("ist");
    expect(normalizeTaskKind("projekt")).toBe("projekt");
    expect(normalizeSprintMetricsBasis("points")).toBe("points");
  });

  it("returns null for anything unknown or non-string", () => {
    expect(normalizeProjectCategory("umzug")).toBeNull();
    expect(normalizeOperativeArea("")).toBeNull();
    expect(normalizeProjectStatus(null)).toBeNull();
    expect(normalizePhaseStatus(undefined)).toBeNull();
    expect(normalizeTaskStatus(42)).toBeNull();
    expect(normalizeMilestoneStatus({})).toBeNull();
    expect(normalizeRiskSeverity("kritisch")).toBeNull();
    expect(normalizeRiskStatus("zu")).toBeNull();
    expect(normalizeProjectMemberRole("admin")).toBeNull();
    expect(normalizeBudgetEntryKind("soll")).toBeNull();
    expect(normalizeTaskKind("operative")).toBeNull();
    expect(normalizeSprintMetricsBasis("story_points")).toBeNull();
    expect(normalizeSprintMetricsBasis(null)).toBeNull();
  });

  it("does not confuse the overlapping values of different vocabularies", () => {
    // 'personal' is both a project category and an operative area, 'geplant'
    // is shared by four status lists — each helper must stay in its own list.
    expect(normalizeProjectCategory("angebot")).toBeNull();
    expect(normalizeOperativeArea("software")).toBeNull();
    expect(normalizeTaskStatus("abgeschlossen")).toBeNull();
    expect(normalizePhaseStatus("erledigt")).toBeNull();
    expect(normalizeProjectCategory("personal")).toBe("personal");
    expect(normalizeOperativeArea("personal")).toBe("personal");
  });
});

describe("label helpers", () => {
  it("returns the German label for known values", () => {
    expect(projectCategoryLabel("gruendung")).toBe("Gründung & Struktur");
    expect(projectCategoryLabel("qualitaet")).toBe("Qualität & Bewertungen");
    expect(operativeAreaLabel("kunde")).toBe("Kundenkontakt");
    expect(operativeAreaLabel("schaden")).toBe("Schadensfall");
    expect(projectStatusLabel("abgebrochen")).toBe("Abgebrochen");
    expect(taskStatusLabel("in_arbeit")).toBe("In Arbeit");
  });

  it("returns the German label for the other seven vocabularies", () => {
    expect(phaseStatusLabel("geplant")).toBe("Geplant");
    expect(phaseStatusLabel("in_arbeit")).toBe("In Arbeit");
    expect(phaseStatusLabel("abgeschlossen")).toBe("Abgeschlossen");
    expect(milestoneStatusLabel("geplant")).toBe("Geplant");
    expect(milestoneStatusLabel("erreicht")).toBe("Erreicht");
    expect(milestoneStatusLabel("verfehlt")).toBe("Verfehlt");
    expect(riskSeverityLabel("niedrig")).toBe("Niedrig");
    expect(riskSeverityLabel("mittel")).toBe("Mittel");
    expect(riskSeverityLabel("hoch")).toBe("Hoch");
    expect(riskStatusLabel("offen")).toBe("Offen");
    expect(riskStatusLabel("beobachtet")).toBe("Beobachtet");
    expect(riskStatusLabel("geschlossen")).toBe("Geschlossen");
    expect(projectMemberRoleLabel("leiter")).toBe("Projektleiter");
    expect(projectMemberRoleLabel("mitglied")).toBe("Mitglied");
    expect(projectMemberRoleLabel("beobachter")).toBe("Beobachter");
    expect(budgetEntryKindLabel("plan")).toBe("Planwert");
    expect(budgetEntryKindLabel("ist")).toBe("Istwert");
    expect(taskKindLabel("projekt")).toBe("Projektaufgabe");
    expect(taskKindLabel("operativ")).toBe("Operative Aufgabe");
  });

  it("returns an empty string from all eleven helpers for null and for unknown values", () => {
    const helpers = [
      projectCategoryLabel,
      operativeAreaLabel,
      projectStatusLabel,
      taskStatusLabel,
      phaseStatusLabel,
      milestoneStatusLabel,
      riskSeverityLabel,
      riskStatusLabel,
      projectMemberRoleLabel,
      budgetEntryKindLabel,
      taskKindLabel,
    ];
    expect(helpers).toHaveLength(11);
    for (const label of helpers) {
      expect(label(null)).toBe("");
      expect(label("gibt-es-nicht")).toBe("");
      expect(label("")).toBe("");
    }
    expect(projectCategoryLabel("umzug")).toBe("");
    expect(projectStatusLabel("laeuft")).toBe("");
  });

  it("does not leak a label across the vocabularies that share a value", () => {
    // 'geplant' is shared, the rest are not: a helper must never label a value
    // that belongs to a different list.
    expect(phaseStatusLabel("erledigt")).toBe("");
    expect(taskStatusLabel("abgeschlossen")).toBe("");
    expect(riskSeverityLabel("offen")).toBe("");
    expect(riskStatusLabel("hoch")).toBe("");
    expect(projectMemberRoleLabel("mittel")).toBe("");
    expect(budgetEntryKindLabel("projekt")).toBe("");
    expect(taskKindLabel("plan")).toBe("");
    expect(phaseStatusLabel("geplant")).toBe("Geplant");
    expect(milestoneStatusLabel("geplant")).toBe("Geplant");
  });
});

describe("the derived overdue state", () => {
  it("exports the literal that work-metrics and the UI share", () => {
    expect(OVERDUE_STATE).toBe("ueberfaellig");
    expect(overdueLabel()).toBe("Überfällig");
  });

  it("is never a stored task status", () => {
    expect((TASK_STATUS as readonly string[]).includes(OVERDUE_STATE)).toBe(false);
    expect(normalizeTaskStatus(OVERDUE_STATE)).toBeNull();
    expect(taskStatusLabel(OVERDUE_STATE)).toBe("");
  });
});

describe("icon and colour defaults", () => {
  it("derives the lucide icon from the category", () => {
    expect(defaultProjectIcon("leistung")).toBe("Wrench");
    expect(defaultProjectIcon("gruendung")).toBe("Building2");
    expect(defaultProjectIcon("software")).toBe("Cpu");
    expect(defaultProjectIcon("finanzen")).toBe("Wallet");
  });

  it("falls back to Folder for null and unknown categories", () => {
    expect(defaultProjectIcon(null)).toBe("Folder");
    expect(defaultProjectIcon("umzug")).toBe("Folder");
  });

  it("uses the category colour when the category is known", () => {
    expect(defaultProjectColor("leistung", "Egal wie das Projekt heisst")).toBe("#3b82f6");
    expect(defaultProjectColor("finanzen", "Buchhaltung & Belegprozess")).toBe("#84cc16");
  });

  it("hashes the name into a stable palette colour when the category is not known", () => {
    expect(defaultProjectColor(null, "Stuttmove")).toBe("#f97316");
    expect(defaultProjectColor("umzug", "IT-Transformation")).toBe("#ef4444");
    // Same input, same colour — the timeline row must not flicker between loads.
    expect(defaultProjectColor(null, "Stuttmove")).toBe(defaultProjectColor(null, "Stuttmove"));
    expect(defaultProjectColor(null, "")).toMatch(/^#[0-9a-f]{6}$/);
  });
});
