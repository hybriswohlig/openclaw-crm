import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { getPersonMessages } from "@/services/inbox";

// GET ?ids=conv1,conv2 → all messages of a person's conversations merged into one
// chronological stream, each tagged with its channel (KOT-IDENTITY merged view).
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { searchParams } = new URL(req.url);
  const ids = (searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);
  return success(await getPersonMessages(ctx.workspaceId, ids));
}
