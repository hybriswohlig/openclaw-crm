/**
 * Operator-side endpoint for the three "live status" buttons in the
 * Auftragsübersicht:
 *
 *   POST {milestone: "departure"} → operator clicked "Anfahrt gestartet"
 *   POST {milestone: "onsite"}    → operator clicked "Vor Ort"
 *   POST {milestone: "finished"}  → operator clicked "Auftrag beendet"
 *
 * Each click stamps the corresponding column on `move_time_entries`. The
 * customer portal polls /api/public/[token]/state and re-derives Stage 3.
 */
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import {
  getAuthContext,
  unauthorized,
  badRequest,
  success,
} from "@/lib/api-utils";
import { db } from "@/db";
import { moveTimeEntries } from "@/db/schema/customer-portal";
import { maybeNotifyPortalEvent } from "@/services/customer-portal-notifications";

export const dynamic = "force-dynamic";

type Milestone = "departure" | "onsite" | "finished";
const VALID: Milestone[] = ["departure", "onsite", "finished"];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { recordId } = await params;
  const [row] = await db
    .select()
    .from(moveTimeEntries)
    .where(eq(moveTimeEntries.dealRecordId, recordId))
    .limit(1);
  return success(
    row ?? {
      dealRecordId: recordId,
      departureAt: null,
      onsiteAt: null,
      finishedAt: null,
    }
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { recordId } = await params;

  let body: { milestone?: string; clear?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return badRequest("Invalid JSON body");
  }
  const milestone = body.milestone as Milestone | undefined;
  if (!milestone || !VALID.includes(milestone)) {
    return badRequest("milestone must be one of: departure | onsite | finished");
  }

  const now = body.clear ? null : new Date();
  const column =
    milestone === "departure"
      ? "departureAt"
      : milestone === "onsite"
        ? "onsiteAt"
        : "finishedAt";

  const [existing] = await db
    .select()
    .from(moveTimeEntries)
    .where(eq(moveTimeEntries.dealRecordId, recordId))
    .limit(1);

  if (!existing) {
    await db.insert(moveTimeEntries).values({
      dealRecordId: recordId,
      workspaceId: ctx.workspaceId,
      [column]: now,
    });
  } else {
    await db
      .update(moveTimeEntries)
      .set({ [column]: now, updatedAt: new Date() })
      .where(
        and(
          eq(moveTimeEntries.dealRecordId, recordId),
          eq(moveTimeEntries.workspaceId, ctx.workspaceId)
        )
      );
  }

  // Fire-and-forget: tell the customer the crew is on its way.
  if (milestone === "departure" && !body.clear) {
    void maybeNotifyPortalEvent("departure", {
      workspaceId: ctx.workspaceId,
      dealRecordId: recordId,
    }).catch(() => {});
  }

  const [row] = await db
    .select()
    .from(moveTimeEntries)
    .where(eq(moveTimeEntries.dealRecordId, recordId))
    .limit(1);
  return success(row);
}
