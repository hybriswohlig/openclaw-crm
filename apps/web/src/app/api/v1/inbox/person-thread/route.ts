import { NextRequest } from "next/server";
import { getAuthContext, isReadOnlyApiKey, unauthorized, success } from "@/lib/api-utils";
import { getPersonMessages, markConversationRead } from "@/services/inbox";

// GET ?ids=conv1,conv2 → all messages of a person's conversations merged into one
// chronological stream, each tagged with its channel (KOT-IDENTITY merged view).
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { searchParams } = new URL(req.url);
  const ids = (searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);
  const messages = await getPersonMessages(ctx.workspaceId, ids);
  // Viewing the merged thread counts as reading every underlying conversation,
  // otherwise the unread counters never clear from the Gesamt view. Best-effort:
  // a failed mark-read must never break the message response. Read-only keys
  // do not clear unread state.
  if (!isReadOnlyApiKey(ctx)) {
    await Promise.all(
      ids.map((id) =>
        markConversationRead(id, ctx.workspaceId).catch((err) =>
          console.error("[inbox] person-thread mark-read failed:", err)
        )
      )
    );
  }
  return success(messages);
}
