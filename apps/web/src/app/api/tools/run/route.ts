// apps/web/src/app/api/tools/run/route.ts
//
// Start a job on the crm-tools FastAPI. Returns { job_id } to the browser.
// The browser then polls /api/tools/jobs/<id> until status=done.
import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, badRequest } from "@/lib/api-utils";
import { db } from "@/db";
import { inboxMessageAttachments } from "@/db/schema/inbox";
import { and, eq, inArray } from "drizzle-orm";

const CRM_TOOLS_API_URL = process.env.CRM_TOOLS_API_URL;
const CRM_TOOLS_AUTH_TOKEN = process.env.CRM_TOOLS_AUTH_TOKEN;

// Cap on total bytes of forwarded images. 15 MB stays well under the
// per-job timeout budget and avoids blowing up the FastAPI request body.
const MAX_IMAGE_BYTES_TOTAL = 15 * 1024 * 1024;
const MAX_IMAGES_FORWARDED = 8;

interface RunBody {
  skill: string;
  params?: Record<string, unknown>;
  timeout_sec?: number;
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  if (!CRM_TOOLS_API_URL || !CRM_TOOLS_AUTH_TOKEN) {
    return NextResponse.json(
      { error: "crm-tools env not configured" },
      { status: 500 }
    );
  }

  const body = (await req.json()) as RunBody;
  if (!body.skill || typeof body.skill !== "string") {
    return badRequest("skill is required");
  }

  // Whitelist what the browser is allowed to ask for — guards against the UI
  // accidentally exposing an unfinished skill.
  const ALLOWED_SKILLS = new Set([
    "echo-test",
    "rechnungen-und-auftragsbestaetigungen",
    "auftragsanweisung",
  ]);
  if (!ALLOWED_SKILLS.has(body.skill)) {
    return badRequest(`skill '${body.skill}' is not allowed`);
  }

  // If the dialog sent _image_attachment_ids, resolve them to base64 payloads
  // server-side and inline them into params._images. We never let the browser
  // upload raw image bytes here — IDs only, dereferenced under the user's
  // workspace scope. This is what gives the headless skill image context
  // (apartment photos etc.) for volume / Stockwerk / besonderheiten.
  const params: Record<string, unknown> = { ...(body.params ?? {}) };
  const imageIds = Array.isArray(params._image_attachment_ids)
    ? (params._image_attachment_ids as unknown[])
        .filter((x): x is string => typeof x === "string")
        .slice(0, MAX_IMAGES_FORWARDED)
    : [];
  delete params._image_attachment_ids;
  if (imageIds.length > 0) {
    const rows = await db
      .select({
        id: inboxMessageAttachments.id,
        fileName: inboxMessageAttachments.fileName,
        mimeType: inboxMessageAttachments.mimeType,
        fileContent: inboxMessageAttachments.fileContent,
      })
      .from(inboxMessageAttachments)
      .where(
        and(
          eq(inboxMessageAttachments.workspaceId, ctx.workspaceId),
          inArray(inboxMessageAttachments.id, imageIds)
        )
      );

    const images: { filename: string; mime: string; base64: string }[] = [];
    let total = 0;
    for (const r of rows) {
      if (!r.mimeType.startsWith("image/")) continue;
      const size = Math.floor((r.fileContent.length * 3) / 4); // base64 → bytes (approx)
      if (total + size > MAX_IMAGE_BYTES_TOTAL) break;
      total += size;
      images.push({ filename: r.fileName, mime: r.mimeType, base64: r.fileContent });
    }
    if (images.length > 0) params._images = images;
  }

  const upstream = await fetch(
    `${CRM_TOOLS_API_URL}/skills/${encodeURIComponent(body.skill)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CRM_TOOLS_AUTH_TOKEN}`,
      },
      body: JSON.stringify({
        params: {
          ...params,
          // Always tag the workspace so the skill has the right scope. The
          // skill can decide whether to use it.
          _workspace_id: ctx.workspaceId,
          _user_id: ctx.userId,
        },
        timeout_sec: body.timeout_sec,
      }),
    }
  );

  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return NextResponse.json(
      { error: "upstream error", upstream: data },
      { status: upstream.status }
    );
  }
  return NextResponse.json(data);
}
