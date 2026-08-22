import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, badRequest, success } from "@/lib/api-utils";
import { listProjects, createProject, parseProjectInput } from "@/services/projects";
import type { CreateProjectInput } from "@/services/projects";
import { normalizeProjectCategory, normalizeProjectStatus } from "@/lib/project-constants";

/**
 * GET /api/v1/projects — project cards incl. their KPI block.
 *
 * ORDER: `updated_at DESC, id ASC`. Any write re-orders the list — including
 * the Notizen autosave and a scope-textarea blur — so a "first N" affordance
 * built on this is unstable by design. The `id` tiebreaker exists because
 * `updated_at` is not unique and a paged sort on a non-unique key can show a
 * row twice or never.
 *
 * `limit` defaults to 50, caps at 200, and `limit=0` means COUNT ONLY:
 * `{ projects: [], pagination: { total } }`.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await getAuthContext(req);
    if (!ctx) return unauthorized();

    const { searchParams } = new URL(req.url);
    // `Number("abc")` is NaN, `Math.min(NaN, 200)` is NaN, and `.limit(NaN)`
    // is a Postgres syntax error — a 500 on a typo in the query string.
    // `limit=0` is meaningful here (count-only), so it is preserved.
    const rawLimit = Number(searchParams.get("limit") ?? 50);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 0), 200) : 50;
    const rawOffset = Number(searchParams.get("offset") ?? 0);
    const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;

    const result = await listProjects(ctx.workspaceId, ctx.userId, {
      status: normalizeProjectStatus(searchParams.get("status")) ?? undefined,
      category: normalizeProjectCategory(searchParams.get("category")) ?? undefined,
      sprintId: searchParams.get("sprintId") || undefined,
      // The parameter is `favoritesOnly` — that is what the MCP tool
      // crm_list_projects, the UI and openapi.json all send.
      favoritesOnly: searchParams.get("favoritesOnly") === "true",
      includeArchived: searchParams.get("includeArchived") === "true",
      limit,
      offset,
    });

    return success({
      projects: result.projects,
      pagination: { limit, offset, total: result.total },
    });
  } catch (err) {
    console.error("GET /api/v1/projects error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: String(err) } },
      { status: 500 },
    );
  }
}

/**
 * POST /api/v1/projects — create a project. The Anlege-Wizard additionally
 * sends members/phases/milestones/risks/budgetEntries; everything is then
 * written in one transaction (spec §8.3).
 */
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Ungültiger JSON-Body.");
  }

  const parsed = parseProjectInput(body, "create");
  if (!parsed.ok) return badRequest(parsed.error);

  try {
    const project = await createProject(
      ctx.workspaceId,
      ctx.userId,
      parsed.input as CreateProjectInput,
    );
    return success(project, 201);
  } catch (err) {
    console.error("POST /api/v1/projects error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Projekt konnte nicht angelegt werden." } },
      { status: 500 },
    );
  }
}
