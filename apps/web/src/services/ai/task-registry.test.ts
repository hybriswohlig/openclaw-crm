import { describe, expect, it } from "vitest";
import { AI_TASK_SLUGS, getTaskDefinition, listTaskDefinitions } from "./task-registry";

describe("project_plan_generate registry entry", () => {
  it("uses the slug from spec §9 verbatim", () => {
    expect(AI_TASK_SLUGS.PROJECT_PLAN_GENERATE).toBe("project_plan_generate");
  });

  it("is resolvable through getTaskDefinition", () => {
    const def = getTaskDefinition("project_plan_generate");
    expect(def).not.toBeNull();
    expect(def?.defaultProvider).toBe("crm-tools");
    expect(def?.defaultModel).toBe("grok-build");
    expect(def?.defaultFallbackModel).toBe("grok-4.6");
  });

  it("does NOT humanize its output — it is structured JSON, not customer prose", () => {
    expect(getTaskDefinition("project_plan_generate")?.humanizeOutput).toBeFalsy();
  });

  it("shows up in the AI-tasks settings list", () => {
    expect(listTaskDefinitions().map((d) => d.slug)).toContain("project_plan_generate");
  });
});
