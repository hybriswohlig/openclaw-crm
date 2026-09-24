import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, badRequest, success } from "@/lib/api-utils";
import { getObjectBySlug } from "@/services/objects";
import { getRecord } from "@/services/records";
import { getLeadWebHistory, linkLeadWebVisit, unlinkLeadWebVisit } from "@/services/website-analytics";

type Params = { params: Promise<{ recordId: string }> };

/** Lead muss im Workspace des Nutzers liegen und ein Deal sein. */
async function loadDeal(workspaceId: string, recordId: string) {
  const obj = await getObjectBySlug(workspaceId, "deals");
  if (!obj) return null;
  return getRecord(obj.id, recordId);
}

export async function GET(req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { recordId } = await params;
  if (!(await loadDeal(ctx.workspaceId, recordId))) return notFound("Lead nicht gefunden");

  const atParam = req.nextUrl.searchParams.get("at");
  const at = atParam ? new Date(atParam) : null;
  if (at && Number.isNaN(at.getTime())) return badRequest("Ungültiger Zeitpunkt");

  try {
    return success(await getLeadWebHistory(ctx.workspaceId, recordId, at));
  } catch (err) {
    console.error("[visibility] lead history failed:", err);
    return Response.json(
      { error: { code: "UPSTREAM", message: "PostHog-Daten konnten nicht geladen werden." } },
      { status: 502 }
    );
  }
}

/** Kandidaten bestätigen: { sessionId, distinctId } */
export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { recordId } = await params;
  if (!(await loadDeal(ctx.workspaceId, recordId))) return notFound("Lead nicht gefunden");

  const body = (await req.json().catch(() => null)) as { sessionId?: unknown; distinctId?: unknown } | null;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.slice(0, 200) : "";
  const distinctId = typeof body?.distinctId === "string" ? body.distinctId.slice(0, 200) : "";
  if (!sessionId || !distinctId) return badRequest("sessionId und distinctId fehlen");

  await linkLeadWebVisit({ workspaceId: ctx.workspaceId, dealId: recordId, sessionId, distinctId, actorId: ctx.userId });
  return success({ ok: true });
}

/** Zuordnung wieder lösen. */
export async function DELETE(req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { recordId } = await params;
  if (!(await loadDeal(ctx.workspaceId, recordId))) return notFound("Lead nicht gefunden");

  await unlinkLeadWebVisit({ workspaceId: ctx.workspaceId, dealId: recordId, actorId: ctx.userId });
  return success({ ok: true });
}
