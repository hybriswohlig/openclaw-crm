// apps/web/src/app/api/tools/run/route.ts
//
// Start a job on the crm-tools FastAPI. Returns { job_id } to the browser.
// The browser then polls /api/tools/jobs/<id> until status=done.
import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, badRequest } from "@/lib/api-utils";

const CRM_TOOLS_API_URL = process.env.CRM_TOOLS_API_URL;
const CRM_TOOLS_AUTH_TOKEN = process.env.CRM_TOOLS_AUTH_TOKEN;

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
  ]);
  if (!ALLOWED_SKILLS.has(body.skill)) {
    return badRequest(`skill '${body.skill}' is not allowed`);
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
          ...body.params,
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
