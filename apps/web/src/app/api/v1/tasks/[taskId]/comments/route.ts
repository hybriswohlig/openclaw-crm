import { NextRequest, NextResponse } from "next/server";
import {
  getAuthContext,
  unauthorized,
  badRequest,
  success,
} from "@/lib/api-utils";
import {
  listTaskComments,
  createTaskComment,
  commentAudience,
} from "@/services/task-comments";

/** GET /api/v1/tasks/[taskId]/comments — list comments (oldest first) */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const ctx = await getAuthContext(req);
    if (!ctx) return unauthorized();

    const { taskId } = await params;
    const rows = await listTaskComments(taskId, ctx.workspaceId);
    return success(rows);
  } catch (err) {
    console.error("GET task comments error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to load comments" } },
      { status: 500 }
    );
  }
}

/** POST /api/v1/tasks/[taskId]/comments — add a comment + push the audience */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const ctx = await getAuthContext(req);
    if (!ctx) return unauthorized();

    const { taskId } = await params;

    const body = (await req.json().catch(() => null)) as { body?: string } | null;
    const text = body?.body?.trim();
    if (!text) return badRequest("body is required");

    const comment = await createTaskComment({
      taskId,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      body: text,
    });
    if (!comment) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Task not found" } },
        { status: 404 }
      );
    }

    // Push the audience (assignees + creator − commenter). Fire-and-forget
    // via waitUntil so the comment shows up instantly in the UI even if
    // the push pipeline is slow.
    const { waitUntil } = await import("@vercel/functions");
    const { sendPush } = await import("@/services/push");
    waitUntil(
      (async () => {
        const targets = await commentAudience({
          taskId,
          workspaceId: ctx.workspaceId,
          commentAuthorId: ctx.userId,
        });
        if (targets.length === 0) return;
        const authorName =
          comment.user?.name?.trim().split(/\s+/)[0] || "Kollege";
        const preview =
          text.length > 100 ? text.slice(0, 99) + "…" : text;
        await sendPush(
          {
            title: `Neuer Kommentar von ${authorName}`,
            body: preview,
            url: `/tasks?taskId=${taskId}`,
            tag: `task-${taskId}`,
          },
          { workspaceId: ctx.workspaceId, userIds: targets }
        );
      })()
    );

    return success(comment, 201);
  } catch (err) {
    console.error("POST task comments error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to add comment" } },
      { status: 500 }
    );
  }
}
