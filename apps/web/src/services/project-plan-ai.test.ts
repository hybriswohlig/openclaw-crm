import { describe, expect, it } from "vitest";
import { ProjectPlanSchema, materializeProjectPlan } from "./project-plan-ai";

describe("ProjectPlanSchema", () => {
  it("accepts a complete plan", () => {
    const parsed = ProjectPlanSchema.parse({
      scopeIn: ["Leistungsseiten", "SEO"],
      scopeOut: ["Online-Shop"],
      phases: [
        {
          name: "Konzept",
          description: "Struktur und Inhalte festlegen",
          startOffsetDays: 0,
          durationDays: 14,
          tasks: [
            { title: "Seitenstruktur festlegen", offsetDays: 2, priority: "hoch" },
            { title: "Texte briefen", description: "Claims", offsetDays: 5, priority: "mittel" },
          ],
        },
      ],
      milestones: [{ name: "Konzept freigegeben", phaseIndex: 0, offsetDays: 14 }],
      risks: [
        {
          title: "Texte kommen zu spät",
          description: "Freigaben dauern",
          severity: "mittel",
          mitigation: "Frühzeitig briefen",
        },
      ],
    });
    expect(parsed.phases[0].tasks).toHaveLength(2);
    expect(parsed.milestones[0].phaseIndex).toBe(0);
  });

  it("fills every list with an empty array when the model omits it", () => {
    const parsed = ProjectPlanSchema.parse({});
    expect(parsed).toEqual({
      scopeIn: [],
      scopeOut: [],
      phases: [],
      milestones: [],
      risks: [],
    });
  });

  it("defaults a task's priority to mittel and its offset to 0", () => {
    const parsed = ProjectPlanSchema.parse({
      phases: [{ name: "P", tasks: [{ title: "T" }] }],
    });
    expect(parsed.phases[0].tasks[0].priority).toBe("mittel");
    expect(parsed.phases[0].tasks[0].offsetDays).toBe(0);
    expect(parsed.phases[0].durationDays).toBe(7);
  });

  it("accepts the sehr_hoch priority step", () => {
    const parsed = ProjectPlanSchema.parse({
      phases: [{ name: "P", tasks: [{ title: "T", priority: "sehr_hoch" }] }],
    });
    expect(parsed.phases[0].tasks[0].priority).toBe("sehr_hoch");
  });

  it("rejects a phase without a name", () => {
    expect(() => ProjectPlanSchema.parse({ phases: [{ description: "keine" }] })).toThrow();
  });

  it("rejects a negative offset — offsets are days after the project start", () => {
    expect(() =>
      ProjectPlanSchema.parse({ milestones: [{ name: "M", offsetDays: -3 }] }),
    ).toThrow();
  });

  it("rejects an unknown risk severity", () => {
    expect(() =>
      ProjectPlanSchema.parse({ risks: [{ title: "R", severity: "katastrophal" }] }),
    ).toThrow();
  });

  it("allows a milestone that belongs to no phase", () => {
    const parsed = ProjectPlanSchema.parse({ milestones: [{ name: "Go-live", offsetDays: 60 }] });
    expect(parsed.milestones[0].phaseIndex).toBeNull();
  });
});

describe("materializeProjectPlan — the ONE offset → date conversion", () => {
  const start = new Date(2026, 8, 1); // 1 September 2026, local midnight

  it("turns phase offsets into an inclusive YYYY-MM-DD range", () => {
    const out = materializeProjectPlan(
      ProjectPlanSchema.parse({
        phases: [{ name: "Konzept", startOffsetDays: 0, durationDays: 14, tasks: [] }],
      }),
      start,
    );
    expect(out.phases[0].startDate).toBe("2026-09-01");
    // 14 days starting on the 1st ends on the 14th, not the 15th.
    expect(out.phases[0].dueDate).toBe("2026-09-14");
  });

  it("dates a task at its own offset, in the LOCAL calendar", () => {
    const out = materializeProjectPlan(
      ProjectPlanSchema.parse({
        phases: [{ name: "P", tasks: [{ title: "Struktur festlegen", offsetDays: 7 }] }],
      }),
      start,
    );
    const task = out.phases[0].tasks![0];
    expect(task.content).toBe("Struktur festlegen");
    expect(task.startDate).toBe("2026-09-08");
    // deadline is a TIMESTAMP column → a full instant at local midnight.
    expect(new Date(task.deadline!).getDate()).toBe(8);
    expect(new Date(task.deadline!).getHours()).toBe(0);
  });

  it("keeps the phase link of a milestone and converts its offset", () => {
    const out = materializeProjectPlan(
      ProjectPlanSchema.parse({
        phases: [{ name: "P" }],
        milestones: [{ name: "Konzept freigegeben", phaseIndex: 0, offsetDays: 14 }],
      }),
      start,
    );
    expect(out.milestones[0]).toEqual({
      name: "Konzept freigegeben",
      phaseIndex: 0,
      dueDate: "2026-09-15",
      status: "geplant",
    });
  });

  it("does not drift across the October DST change", () => {
    // Europe/Berlin leaves CEST on 2026-10-25. An offset that crosses it
    // must still land on the calendar day the user expects.
    const out = materializeProjectPlan(
      ProjectPlanSchema.parse({ milestones: [{ name: "Go-live", offsetDays: 60 }] }),
      start,
    );
    expect(out.milestones[0].dueDate).toBe("2026-10-31");
  });

  it("passes scope and risks straight through", () => {
    const out = materializeProjectPlan(
      ProjectPlanSchema.parse({
        scopeIn: ["Leistungsseiten"],
        scopeOut: ["Shop"],
        risks: [{ title: "Texte zu spät", severity: "hoch", mitigation: "früh briefen" }],
      }),
      start,
    );
    expect(out.scopeIn).toEqual(["Leistungsseiten"]);
    expect(out.scopeOut).toEqual(["Shop"]);
    expect(out.risks[0]).toEqual({
      title: "Texte zu spät",
      description: null,
      severity: "hoch",
      mitigation: "früh briefen",
    });
  });

  it("is empty for an empty plan", () => {
    const out = materializeProjectPlan(ProjectPlanSchema.parse({}), start);
    expect(out).toEqual({ scopeIn: [], scopeOut: [], phases: [], milestones: [], risks: [] });
  });
});
