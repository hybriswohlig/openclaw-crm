import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, badRequest, success } from "@/lib/api-utils";
import { updateBudgetEntry, deleteBudgetEntry } from "@/services/project-budget";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; entryId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { entryId } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Ungültiger JSON-Body.");
  }

  try {
    const entry = await updateBudgetEntry(ctx.workspaceId, entryId, body);
    if (!entry) return notFound("Budgetposten nicht gefunden");
    return success(entry);
  } catch (err) {
    return badRequest(
      err instanceof Error ? err.message : "Budgetposten konnte nicht geändert werden.",
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; entryId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { entryId } = await params;

  const ok = await deleteBudgetEntry(ctx.workspaceId, entryId);
  if (!ok) return notFound("Budgetposten nicht gefunden");
  return success({ deleted: true });
}
