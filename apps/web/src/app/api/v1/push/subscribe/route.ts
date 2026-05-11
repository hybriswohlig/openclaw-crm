import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, badRequest, success } from "@/lib/api-utils";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { and, eq } from "drizzle-orm";

interface BrowserPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface SubscribeBody {
  subscription: BrowserPushSubscription;
  deviceLabel?: string;
}

/**
 * POST — upserts a push subscription owned by the current user.
 * The subscription endpoint is globally unique; if it already exists for a
 * different user we re-bind it (browser endpoints don't change across logins
 * on the same device, so the latest signed-in user wins).
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext(req);
    if (!ctx) return unauthorized();

    const body = (await req.json().catch(() => null)) as SubscribeBody | null;
    const sub = body?.subscription;
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      return badRequest("subscription.endpoint, keys.p256dh and keys.auth are required");
    }

    const userAgent = req.headers.get("user-agent") ?? null;

    const existing = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, sub.endpoint))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(pushSubscriptions)
        .set({
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          p256dh: sub.keys.p256dh,
          auth: sub.keys.auth,
          deviceLabel: body?.deviceLabel ?? existing[0].deviceLabel ?? null,
          userAgent,
          lastSeenAt: new Date(),
        })
        .where(eq(pushSubscriptions.endpoint, sub.endpoint));
    } else {
      await db.insert(pushSubscriptions).values({
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        deviceLabel: body?.deviceLabel ?? null,
        userAgent,
      });
    }

    return success({ subscribed: true });
  } catch (err) {
    console.error("POST /api/v1/push/subscribe error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to save subscription" } },
      { status: 500 }
    );
  }
}

/** DELETE — removes the subscription for the supplied endpoint (or all of this user's). */
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await getAuthContext(req);
    if (!ctx) return unauthorized();

    const url = new URL(req.url);
    const endpoint = url.searchParams.get("endpoint");

    if (endpoint) {
      await db
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.endpoint, endpoint),
            eq(pushSubscriptions.userId, ctx.userId)
          )
        );
    } else {
      await db
        .delete(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, ctx.userId));
    }

    return success({ deleted: true });
  } catch (err) {
    console.error("DELETE /api/v1/push/subscribe error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to delete subscription" } },
      { status: 500 }
    );
  }
}

/** GET — returns the current user's active subscriptions (for the settings page). */
export async function GET(req: NextRequest) {
  try {
    const ctx = await getAuthContext(req);
    if (!ctx) return unauthorized();

    const rows = await db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        deviceLabel: pushSubscriptions.deviceLabel,
        userAgent: pushSubscriptions.userAgent,
        createdAt: pushSubscriptions.createdAt,
        lastSeenAt: pushSubscriptions.lastSeenAt,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, ctx.userId));

    return success(rows);
  } catch (err) {
    console.error("GET /api/v1/push/subscribe error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to list subscriptions" } },
      { status: 500 }
    );
  }
}
