/**
 * Operator-facing start trigger for an in-house Baileys channel account.
 *
 * Verifies the account belongs to the caller's workspace and is flagged
 * `baileys_bridge_provider='inhouse'`, then forwards to the bridge's
 * control endpoint at POST /accounts/:id/start. Idempotent — calling
 * this on an already-running socket is a no-op.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { channelAccounts } from "@/db/schema/inbox";
import { and, eq, isNull } from "drizzle-orm";
import {
  getAuthContext,
  unauthorized,
  badRequest,
  notFound,
  requireChannelManager,
} from "@/lib/api-utils";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const deny = requireChannelManager(ctx);
  if (deny) return deny;

  const url = process.env.BAILEYS_BRIDGE_URL;
  const secret = process.env.BAILEYS_BRIDGE_SECRET;
  if (!url || !secret) {
    return NextResponse.json(
      {
        error: {
          code: "BAILEYS_BRIDGE_NOT_CONFIGURED",
          message:
            "BAILEYS_BRIDGE_URL / BAILEYS_BRIDGE_SECRET not set on the CRM. Configure these env vars to enable the in-house bridge.",
        },
      },
      { status: 503 },
    );
  }

  let body: { accountId?: string } = {};
  try {
    body = (await req.json()) as { accountId?: string };
  } catch {
    return badRequest("invalid_json");
  }
  if (!body.accountId || typeof body.accountId !== "string") {
    return badRequest("accountId required");
  }

  const [account] = await db
    .select({ id: channelAccounts.id })
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.id, body.accountId),
        eq(channelAccounts.workspaceId, ctx.workspaceId),
        eq(channelAccounts.channelType, "whatsapp"),
        eq(channelAccounts.baileysBridgeProvider, "inhouse"),
        isNull(channelAccounts.waPhoneNumberId),
      ),
    )
    .limit(1);
  if (!account) return notFound("Baileys (in-house) account not found");

  const res = await fetch(`${url}/accounts/${account.id}/start`, {
    method: "POST",
    headers: { "X-Bridge-Secret": secret },
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
  };
  if (!res.ok) {
    return NextResponse.json(
      {
        error: {
          code: "BRIDGE_REJECTED",
          status: res.status,
          message: json.error ?? `bridge returned ${res.status}`,
        },
      },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true });
}
