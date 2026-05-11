import webpush from "web-push";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";

let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:hello@kottke-umzuege.de";
  if (!publicKey || !privateKey) {
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

interface SendOptions {
  workspaceId: string;
  /** If set, push goes only to these userIds (otherwise: all members in workspace) */
  userIds?: string[];
  /** Don't send to this user (e.g., the one who triggered the event) */
  excludeUserId?: string;
}

/**
 * Sends a push notification to every active subscription in the workspace.
 * Subscriptions that respond 404/410 are pruned automatically.
 *
 * Returns the number of successful deliveries. Silently returns 0 if VAPID
 * is not configured — pushes are an enhancement, never a hard dependency.
 */
export async function sendPush(
  payload: PushPayload,
  options: SendOptions
): Promise<number> {
  if (!ensureConfigured()) {
    console.warn("[push] VAPID keys not configured — skipping send");
    return 0;
  }

  const filters = [eq(pushSubscriptions.workspaceId, options.workspaceId)];
  if (options.userIds && options.userIds.length > 0) {
    filters.push(inArray(pushSubscriptions.userId, options.userIds));
  }

  const rows = await db
    .select()
    .from(pushSubscriptions)
    .where(and(...filters));

  const targets = options.excludeUserId
    ? rows.filter((r) => r.userId !== options.excludeUserId)
    : rows;

  if (targets.length === 0) return 0;

  const body = JSON.stringify(payload);
  const expired: string[] = [];

  const results = await Promise.allSettled(
    targets.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
          { TTL: 60 * 60 } // drop if undeliverable for an hour
        );
        return true;
      } catch (err) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          expired.push(sub.id);
          return false;
        }
        console.error("[push] send failed", {
          endpoint: sub.endpoint.slice(0, 60),
          statusCode,
          error: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    })
  );

  if (expired.length > 0) {
    try {
      await db
        .delete(pushSubscriptions)
        .where(inArray(pushSubscriptions.id, expired));
    } catch (err) {
      console.error("[push] prune expired failed", err);
    }
  }

  return results.filter((r) => r.status === "fulfilled" && r.value).length;
}

export function pushPublicKey(): string | null {
  return (
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ??
    process.env.VAPID_PUBLIC_KEY ??
    null
  );
}
