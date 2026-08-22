import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, notFound, badRequest, success } from "@/lib/api-utils";
import { getBudget, createBudgetEntry } from "@/services/project-budget";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { projectId } = await params;
  try {
    const budget = await getBudget(ctx.workspaceId, projectId);
    if (!budget) return notFound("Projekt nicht gefunden");
    return success(budget);
  } catch (err) {
    console.error("GET budget error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: String(err) } },
      { status: 500 },
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { projectId } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Ungültiger JSON-Body.");
  }

  try {
    const entry = await createBudgetEntry(ctx.workspaceId, projectId, ctx.userId, {
      label: String(body.label ?? ""),
      amountCents: typeof body.amountCents === "number" ? body.amountCents : Number.NaN,
      kind: String(body.kind ?? ""),
      bookedAt: typeof body.bookedAt === "string" ? body.bookedAt : null,
      note: typeof body.note === "string" ? body.note : null,
    });
    if (!entry) return notFound("Projekt nicht gefunden");
    return success(entry, 201);
  } catch (err) {
    return badRequest(
      err instanceof Error ? err.message : "Budgetposten konnte nicht angelegt werden.",
    );
  }
}
