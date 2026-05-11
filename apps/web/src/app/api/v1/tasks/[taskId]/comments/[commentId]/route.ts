import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, notFound, success } from "@/lib/api-utils";
import { deleteTaskComment } from "@/services/task-comments";

/** DELETE /api/v1/tasks/[taskId]/comments/[commentId] — author-only delete */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string; commentId: string }> }
) {
  try {
    const ctx = await getAuthContext(req);
    if (!ctx) return unauthorized();

    const { commentId } = await params;
    const ok = await deleteTaskComment({
      commentId,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
    });
    if (!ok) return notFound("Comment not found or not yours");
    return success({ deleted: true });
  } catch (err) {
    console.error("DELETE task comment error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to delete comment" } },
      { status: 500 }
    );
  }
}
