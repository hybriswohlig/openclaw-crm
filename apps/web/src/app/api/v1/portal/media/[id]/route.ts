import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { jobMedia, dealEmployees } from "@/db/schema";
import { getEmployeePortalContextFromHeaders } from "@/lib/employee-portal-auth";

/**
 * Streams a private job-media blob to an authorized employee. Allowed if the
 * employee uploaded it, it belongs to them, or they are assigned to its deal —
 * always scoped to their workspace.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getEmployeePortalContextFromHeaders(req.headers);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const [media] = await db
    .select()
    .from(jobMedia)
    .where(and(eq(jobMedia.id, id), eq(jobMedia.workspaceId, ctx.workspaceId)))
    .limit(1);
  if (!media) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let allowed =
    media.uploadedByUserId === ctx.userId || media.employeeId === ctx.employeeId;
  if (!allowed && media.dealRecordId) {
    const [assigned] = await db
      .select({ id: dealEmployees.id })
      .from(dealEmployees)
      .where(
        and(
          eq(dealEmployees.dealRecordId, media.dealRecordId),
          eq(dealEmployees.employeeId, ctx.employeeId)
        )
      )
      .limit(1);
    allowed = !!assigned;
  }
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const result = await get(media.blobPathname, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const wantDownload = req.nextUrl.searchParams.get("download") === "1";
  return new NextResponse(result.stream, {
    headers: {
      "Content-Type": media.contentType,
      "Content-Disposition": `${wantDownload ? "attachment" : "inline"}; filename="${id}"`,
      "Cache-Control": "private, no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
