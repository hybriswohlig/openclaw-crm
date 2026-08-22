// apps/web/src/services/project-plan-ai.ts
// The Anlege-Wizard's single AI call (spec §9): one runAITask round on the
// crm-tools path, zod-validated. Offsets are days relative to the project
// start so the output never depends on the model's system date. A failure
// is never fatal — the wizard shows a hint and continues manually.

import { z } from "zod";
// Both date helpers come from the pure lib module — project-plan-ai must
// never import a service module (and its db/drizzle graph) for a string
// conversion.
import { offsetDaysToDate, phaseEndOffset, toIsoDay } from "@/lib/work-metrics";
import { runAITask } from "./ai/run-task";
import { AI_TASK_SLUGS } from "./ai/task-registry";
import type { CreateProjectInput } from "./projects";

const PrioritySchema = z.enum(["sehr_hoch", "hoch", "mittel", "niedrig"]);

export const ProjectPlanSchema = z.object({
  scopeIn: z
    .array(z.string().min(1))
    .default([])
    .describe("Punkte, die im Projekt enthalten sind"),
  scopeOut: z
    .array(z.string().min(1))
    .default([])
    .describe("Punkte, die ausdrücklich NICHT im Projekt enthalten sind"),
  phases: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().default(""),
        startOffsetDays: z.number().int().min(0).default(0),
        durationDays: z.number().int().min(1).default(7),
        tasks: z
          .array(
            z.object({
              title: z.string().min(1),
              description: z.string().optional(),
              offsetDays: z.number().int().min(0).default(0),
              priority: PrioritySchema.default("mittel"),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
  milestones: z
    .array(
      z.object({
        name: z.string().min(1),
        phaseIndex: z.number().int().min(0).nullable().default(null),
        offsetDays: z.number().int().min(0).default(0),
      }),
    )
    .default([]),
  risks: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string().default(""),
        severity: z.enum(["niedrig", "mittel", "hoch"]).default("mittel"),
        mitigation: z.string().default(""),
      }),
    )
    .default([]),
});

export type ProjectPlan = z.infer<typeof ProjectPlanSchema>;

export interface ProjectPlanInput {
  workspaceId: string;
  name: string;
  shortDescription: string | null;
  category: string;
  priority: string;
  startDate: string | null;
  endDate: string | null;
  problemStatement: string | null;
  goalStatement: string | null;
  successCriteria: string | null;
  scopeIn: string[];
  scopeOut: string[];
}

const SYSTEM_PROMPT = `Du bist Projektplaner in einem deutschen Umzugsunternehmen (Kottke Umzüge, Stuttgart). Du bekommst die Eckdaten eines geplanten internen Projekts und erstellst daraus einen ersten, realistischen Projektplan.

Regeln:
- Antworte auf Deutsch, im Du-Ton, ohne Werbesprache.
- scopeIn / scopeOut: je 3 bis 8 kurze, konkrete Punkte. scopeOut nennt, was bewusst NICHT dazugehört.
- phases: 3 bis 6 Phasen in sinnvoller Reihenfolge. startOffsetDays und durationDays sind ganze Tage ab Projektstart, die Phasen dürfen sich leicht überlappen.
- Jede Phase bekommt 2 bis 6 konkrete Aufgaben. offsetDays ist die Fälligkeit in Tagen ab Projektstart. priority ist genau einer der Werte sehr_hoch, hoch, mittel, niedrig.
- milestones: 2 bis 5 überprüfbare Ergebnisse. phaseIndex ist der Index der zugehörigen Phase (0-basiert) oder null.
- risks: 2 bis 5 realistische Risiken mit severity niedrig, mittel oder hoch und einer konkreten Gegenmaßnahme.
- Erfinde keine Zahlen, Preise oder Namen, die nicht in der Eingabe stehen.

Antworte NUR mit dem JSON-Objekt, ohne Erklärung und ohne Markdown.`;

function buildPrompt(input: ProjectPlanInput): string {
  const lines = [
    `# Projekt`,
    `Name: ${input.name}`,
    `Bereich: ${input.category}`,
    `Priorität: ${input.priority}`,
  ];
  if (input.shortDescription) lines.push(`Kurzbeschreibung: ${input.shortDescription}`);
  if (input.startDate) lines.push(`Geplanter Start: ${input.startDate}`);
  if (input.endDate) lines.push(`Geplantes Ende: ${input.endDate}`);
  if (input.problemStatement) lines.push(`\n# Ausgangssituation\n${input.problemStatement}`);
  if (input.goalStatement) lines.push(`\n# Ziel\n${input.goalStatement}`);
  if (input.successCriteria) lines.push(`\n# Erfolgskriterien\n${input.successCriteria}`);
  if (input.scopeIn.length > 0) {
    lines.push(`\n# Grober Scope (enthalten)\n${input.scopeIn.map((s) => `- ${s}`).join("\n")}`);
  }
  if (input.scopeOut.length > 0) {
    lines.push(
      `\n# Grober Scope (nicht enthalten)\n${input.scopeOut.map((s) => `- ${s}`).join("\n")}`,
    );
  }
  lines.push(
    `\nErzeuge daraus verfeinerte Scope-Punkte, Phasen mit Aufgaben, Meilensteine und Erst-Risiken.`,
  );
  return lines.join("\n");
}

export interface MaterializedPlan {
  scopeIn: string[];
  scopeOut: string[];
  phases: NonNullable<CreateProjectInput["phases"]>;
  milestones: NonNullable<CreateProjectInput["milestones"]>;
  risks: NonNullable<CreateProjectInput["risks"]>;
}

/**
 * The ONE offset → date conversion in the system.
 *
 * The generator returns day offsets relative to the project start so its
 * output never depends on the model's system date (spec §9). Turning those
 * into the nested slice of `CreateProjectInput` is done here, built on
 * Phase 1's tested `offsetDaysToDate` — no caller (UI, MCP, script) may
 * re-implement the arithmetic, which is how the two off-by-one variants got
 * into the codebase in the first place.
 *
 * `startDate` / `dueDate` are `date` columns → "YYYY-MM-DD" strings.
 * `deadline` is a TIMESTAMP column → a full ISO instant at LOCAL midnight.
 */
export function materializeProjectPlan(
  plan: ProjectPlan,
  projectStart: Date,
): MaterializedPlan {
  const isoDay = (offset: number) => toIsoDay(offsetDaysToDate(projectStart, offset));
  const isoStamp = (offset: number) => offsetDaysToDate(projectStart, offset).toISOString();

  return {
    scopeIn: [...plan.scopeIn],
    scopeOut: [...plan.scopeOut],
    phases: plan.phases.map((p) => ({
      name: p.name,
      description: p.description || null,
      startDate: isoDay(p.startOffsetDays),
      // `phaseEndOffset` is the ONE copy of the inclusive end formula — the
      // wizard calls the same helper, so preview and write cannot drift.
      dueDate: isoDay(phaseEndOffset(p.startOffsetDays, p.durationDays)),
      status: "geplant",
      tasks: p.tasks.map((t) => ({
        content: t.title,
        description: t.description ?? null,
        deadline: isoStamp(t.offsetDays),
        startDate: isoDay(t.offsetDays),
        priority: t.priority,
      })),
    })),
    milestones: plan.milestones.map((m) => ({
      name: m.name,
      phaseIndex: m.phaseIndex,
      dueDate: isoDay(m.offsetDays),
      status: "geplant",
    })),
    risks: plan.risks.map((r) => ({
      title: r.title,
      description: r.description || null,
      severity: r.severity,
      mitigation: r.mitigation || null,
    })),
  };
}

export async function generateProjectPlan(
  input: ProjectPlanInput,
): Promise<{ ok: true; plan: ProjectPlan } | { ok: false; error: string }> {
  const result = await runAITask({
    workspaceId: input.workspaceId,
    taskSlug: AI_TASK_SLUGS.PROJECT_PLAN_GENERATE,
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(input),
    schema: ProjectPlanSchema,
  });

  if (!result.ok) {
    console.warn(`[project-plan-ai] ${input.name}: ${result.error}`);
    return { ok: false, error: result.error };
  }
  return { ok: true, plan: result.output };
}
