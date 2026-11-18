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

describe("deal.kv-editor registry entry", () => {
  it("passt zu Spec 8 und dem Vertrag (KV_EDITOR_KI_SLUG)", async () => {
    const { KV_EDITOR_KI_SLUG } = await import("@/lib/kv-editor");
    expect(AI_TASK_SLUGS.DEAL_KV_EDITOR).toBe(KV_EDITOR_KI_SLUG);
    expect(getTaskDefinition("deal.kv-editor")).toMatchObject({
      defaultProvider: "crm-tools",
      defaultModel: "grok-4.6",
      defaultFallbackModel: "claude-code",
      defaultTemperature: 0.2,
      defaultMaxTokens: 2048,
    });
    expect(getTaskDefinition("deal.kv-editor")?.humanizeOutput).toBeFalsy();
    expect(listTaskDefinitions().map((d) => d.slug)).toContain("deal.kv-editor");
  });
});
