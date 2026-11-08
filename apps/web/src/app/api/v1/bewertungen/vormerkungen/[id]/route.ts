/**
 * PATCH /api/v1/bewertungen/vormerkungen/[id] { aktion: "verwerfen" }
 * Nur offene Zeilen des eigenen Workspace. Sonst 404.
 */
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { reviewVormerkungen } from "@/db/schema";
import { badRequest, forbidden, getAuthContext, notFound, success, unauthorized } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  if (ctx.authMethod !== "cookie") return forbidden("Nur in der angemeldeten Sitzung.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest("Ungültige Eingabe.");
  if ((body as { aktion?: unknown }).aktion !== "verwerfen") return badRequest("Aktion muss verwerfen sein.");

  const { id } = await params;
  const jetzt = new Date();
  const rows = await db
    .update(reviewVormerkungen)
    .set({ status: "verworfen", erledigtAt: jetzt, erledigtVon: ctx.userId, updatedAt: jetzt })
    .where(
      and(eq(reviewVormerkungen.id, id), eq(reviewVormerkungen.workspaceId, ctx.workspaceId), eq(reviewVormerkungen.status, "offen"))
    )
    .returning({ id: reviewVormerkungen.id });
  if (rows.length === 0) return notFound();
  return success({ id, status: "verworfen" });
}
