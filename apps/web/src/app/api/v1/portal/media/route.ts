import { NextRequest } from "next/server";
import { head } from "@vercel/blob";
import { db } from "@/db";
import { jobMedia } from "@/db/schema";
import { getEmployeePortalContextFromHeaders } from "@/lib/employee-portal-auth";
import { unauthorized, badRequest, success } from "@/lib/api-utils";

const VALID_CATEGORIES = [
  "stairwell",
  "loading",
  "overview",
  "damage",
  "truck_loaded",
  "final_loaded",
  "receipt",
  "other",
] as const;
type Category = (typeof VALID_CATEGORIES)[number];

/**
 * Register an uploaded blob as job_media. Called by the client right after the
 * direct Blob upload completes. The blob is verified server-side via head()
 * (real size/contentType), never trusting the client's claims.
 */
export async function POST(req: NextRequest) {
  const ctx = await getEmployeePortalContextFromHeaders(req.headers);
  if (!ctx) return unauthorized();

  const body = await req.json();
  const { pathname, dealRecordId, category, caption, capturedAt } = body;
  if (!pathname) return badRequest("pathname required");
  const cat: Category = VALID_CATEGORIES.includes(category) ? category : "other";

  // Verify the blob exists and belongs to this workspace's prefix.
  if (!String(pathname).startsWith(`ws/${ctx.workspaceId}/`)) {
    return badRequest("pathname outside workspace scope");
  }
  let meta;
  try {
    meta = await head(pathname);
  } catch {
    return badRequest("blob not found");
  }

  const [row] = await db
    .insert(jobMedia)
    .values({
      workspaceId: ctx.workspaceId,
      dealRecordId: dealRecordId ?? null,
      employeeId: ctx.employeeId,
      uploadedByUserId: ctx.userId,
      category: cat,
      blobPathname: pathname,
      blobUrl: meta.url,
      contentType: meta.contentType ?? "application/octet-stream",
      sizeBytes: meta.size ?? 0,
      caption: caption ?? null,
      capturedAt: capturedAt ? new Date(capturedAt) : null,
    })
    .returning({ id: jobMedia.id });

  return success({ id: row.id }, 201);
}
