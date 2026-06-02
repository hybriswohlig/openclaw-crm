import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success, badRequest } from "@/lib/api-utils";
import { getMergeSuggestions, acceptMergeSuggestion, rejectMergeSuggestion } from "@/services/identity-suggestions";

// GET  → live name-similarity merge suggestions (excludes already-decided pairs).
// POST → { action: "merge" | "reject", idA, idB } confirm or dismiss a suggestion.

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  return success(await getMergeSuggestions(ctx.workspaceId));
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { action?: string; idA?: string; idB?: string };
  if (!body.idA || !body.idB) return badRequest("idA and idB are required");
  try {
    if (body.action === "reject") {
      await rejectMergeSuggestion(ctx.workspaceId, body.idA, body.idB, ctx.userId);
    } else {
      await acceptMergeSuggestion(ctx.workspaceId, body.idA, body.idB, ctx.userId);
    }
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "merge failed");
  }
  return success({ ok: true });
}
