/**
 * CTO-callable flip for the post-move reviews engine ([KOT-603] / [KOT-747]).
 *
 * Writes `workspaces.settings.reviews_engine_enabled` on the singleton
 * workspace. Auth mirrors `/api/cron/reviews-send`: `Bearer ${CRON_SECRET}`.
 * Sits under `/api/cron/` so the existing public-paths middleware exemption
 * applies — no session, no admin user required, which is what the [KOT-747](/KOT/issues/KOT-747)
 * Option A handoff explicitly asked for.
 *
 * Idempotent. The body must be `{ enabled: boolean }`; any other shape is
 * a 400 so a typo can't silently leave the flag in the wrong state.
 *
 * The cron at `/api/cron/reviews-send` reads `settings.reviews_engine_enabled
 * === false` to short-circuit, so:
 *   - `{ enabled: true }`  → cron sends. Key set to `true`.
 *   - `{ enabled: false }` → cron skips with `engine_disabled`. Key set to `false`.
 *
 * Other settings keys on the row are preserved (read-merge-write); this
 * endpoint is scoped to the one flag.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workspaces } from "@/db/schema";
import { getSingletonWorkspaceId } from "@/services/workspace";
import { requireCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { enabled?: unknown }).enabled !== "boolean"
  ) {
    return NextResponse.json(
      { error: "expected_body_enabled_boolean" },
      { status: 400 }
    );
  }
  const enabled = (body as { enabled: boolean }).enabled;

  const workspaceId = await getSingletonWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ error: "no_workspace" }, { status: 500 });
  }

  const [row] = await db
    .select({ settings: workspaces.settings })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  const current = (row?.settings as Record<string, unknown> | null) ?? {};
  const previous =
    typeof current["reviews_engine_enabled"] === "boolean"
      ? (current["reviews_engine_enabled"] as boolean)
      : null;

  const nextSettings = { ...current, reviews_engine_enabled: enabled };
  await db
    .update(workspaces)
    .set({ settings: nextSettings, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId));

  return NextResponse.json({
    ok: true,
    workspaceId,
    reviews_engine_enabled: enabled,
    previous,
  });
}
