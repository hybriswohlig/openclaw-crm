import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, badRequest, success } from "@/lib/api-utils";
import { generateProjectPlan } from "@/services/project-plan-ai";
import { normalizeProjectCategory } from "@/lib/project-constants";
import { normalizePriority } from "@/lib/task-priority";

// The crm-tools path polls for up to 290 s (spec §9).
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Ungültiger JSON-Body.");
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return badRequest("Projektname ist erforderlich.");
  const category = normalizeProjectCategory(body.category);
  if (!category) return badRequest("Ungültiger Projektbereich.");

  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const list = (v: unknown) =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim().length > 0) : [];

  try {
    const result = await generateProjectPlan({
      workspaceId: ctx.workspaceId,
      name,
      shortDescription: str(body.shortDescription),
      category,
      priority: normalizePriority(body.priority) ?? "mittel",
      startDate: str(body.startDate),
      endDate: str(body.endDate),
      problemStatement: str(body.problemStatement),
      goalStatement: str(body.goalStatement),
      successCriteria: str(body.successCriteria),
      scopeIn: list(body.scopeIn),
      scopeOut: list(body.scopeOut),
    });

    // A failure must never block the wizard — it shows a hint and lets the
    // operator continue manually (spec §9).
    if (!result.ok) return success({ plan: null, error: result.error });
    return success({ plan: result.plan, error: null });
  } catch (err) {
    console.error("POST plan-generate error:", err);
    return success({ plan: null, error: "Der KI-Vorschlag ist gerade nicht verfügbar." });
  }
}
