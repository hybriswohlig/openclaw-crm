import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getEmployeePortalContextFromHeaders } from "@/lib/employee-portal-auth";
import { JOB_MEDIA_CONTENT_TYPES, JOB_MEDIA_MAX_BYTES } from "@/lib/blob";

/**
 * Issues a short-lived client-upload token for the PRIVATE blob store. The
 * employee uploads directly from the phone to Blob; the server only authorizes
 * here. The DB row is written afterwards via /api/v1/portal/media (register).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        const ctx = await getEmployeePortalContextFromHeaders(req.headers);
        if (!ctx) throw new Error("Nicht angemeldet.");
        // Defense in depth: the upload path must live under the caller's workspace.
        if (!pathname.startsWith(`ws/${ctx.workspaceId}/`)) {
          throw new Error("Ungültiger Upload-Pfad.");
        }
        return {
          access: "private",
          addRandomSuffix: true,
          allowedContentTypes: JOB_MEDIA_CONTENT_TYPES,
          maximumSizeInBytes: JOB_MEDIA_MAX_BYTES,
          tokenPayload: JSON.stringify({
            workspaceId: ctx.workspaceId,
            employeeId: ctx.employeeId,
            userId: ctx.userId,
          }),
        };
      },
      // DB write happens in the register step (synchronous, session-authed),
      // not here — onUploadCompleted is unreachable on localhost.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(json);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 }
    );
  }
}
