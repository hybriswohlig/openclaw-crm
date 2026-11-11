/**
 * Re-pair one existing in-house Baileys account.
 *
 * The add flow calls POST /integrations/baileys/start, which asks the bridge
 * to open a socket. Start reloads auth from the CRM on every spawn, but a
 * logged-out row still has (or can flush) a dead session, so the socket
 * closes again before a QR is issued and the dialog treats `logged_out` as
 * terminal.
 *
 * This route, for the account id in the body only:
 *   1. stops a live socket for that id, if the bridge has one
 *   2. waits out the bridge's 500ms auth-persist debounce so the old socket
 *      cannot write the dead creds back
 *   3. deletes `baileys.auth_state.<id>`
 *   4. marks that row active and awaiting a QR
 *   5. calls the same bridge `POST /accounts/:id/start` the add flow uses
 *
 * No other account is selected, stopped, or cleared. Nothing is sent on
 * WhatsApp. The bridge process does not need a new endpoint or a restart:
 * `/health`, `/stop`, and `/start` are the control plane the CRM already calls.
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
import { baileysAuthStateKey } from "@/lib/baileys-repair";
import { deleteSetting } from "@/services/workspace-settings";

export const dynamic = "force-dynamic";

/**
 * `crm-auth-state` debounces writes by 500ms and a flush that finds an
 * in-flight write schedules one more. 800ms lets that last write land
 * before we delete the blob.
 */
export const BAILEYS_REPAIR_FLUSH_WAIT_MS = 800;

function bridgeHeaders(secret: string): HeadersInit {
  return { "X-Bridge-Secret": secret };
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const deny = requireChannelManager(ctx);
  if (deny) return deny;

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
    .select({
      id: channelAccounts.id,
      isActive: channelAccounts.isActive,
      baileysPairingStatus: channelAccounts.baileysPairingStatus,
    })
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

  if (account.isActive && account.baileysPairingStatus === "connected") {
    return NextResponse.json(
      {
        error: {
          code: "ALREADY_CONNECTED",
          message: "Dieses WhatsApp-Konto ist bereits verbunden.",
        },
      },
      { status: 409 },
    );
  }

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

  let health: Response;
  try {
    health = await fetch(`${url}/accounts/${account.id}/health`, {
      headers: bridgeHeaders(secret),
    });
  } catch (err) {
    console.error("[baileys-repair] bridge health failed", err);
    return NextResponse.json(
      {
        error: {
          code: "BRIDGE_UNREACHABLE",
          message: "Die WhatsApp-Bridge ist nicht erreichbar.",
        },
      },
      { status: 502 },
    );
  }
  if (health.status === 401) {
    return NextResponse.json(
      {
        error: {
          code: "BRIDGE_REJECTED",
          message: "Die WhatsApp-Bridge hat die Anmeldung abgelehnt.",
        },
      },
      { status: 502 },
    );
  }

  // 404 = this account has no socket. Any other status means a socket may
  // still flush dead creds, so stop it and wait out the debounce first.
  if (health.status !== 404) {
    const stop = await fetch(`${url}/accounts/${account.id}/stop`, {
      method: "POST",
      headers: bridgeHeaders(secret),
    });
    if (stop.status === 401) {
      return NextResponse.json(
        {
          error: {
            code: "BRIDGE_REJECTED",
            message: "Die WhatsApp-Bridge hat die Anmeldung abgelehnt.",
          },
        },
        { status: 502 },
      );
    }
    await new Promise((resolve) => setTimeout(resolve, BAILEYS_REPAIR_FLUSH_WAIT_MS));
  }

  try {
    await deleteSetting(ctx.workspaceId, baileysAuthStateKey(account.id));
  } catch (err) {
    console.error("[baileys-repair] failed to clear auth state", err);
    return NextResponse.json(
      {
        error: {
          code: "AUTH_CLEAR_FAILED",
          message: "Die alte WhatsApp-Sitzung konnte nicht gelöscht werden.",
        },
      },
      { status: 500 },
    );
  }

  const now = new Date();
  await db
    .update(channelAccounts)
    .set({
      isActive: true,
      baileysPairingStatus: "awaiting_qr",
      baileysQrPayload: null,
      baileysQrUpdatedAt: null,
      baileysPairingCode: null,
      baileysLastDisconnectReason: null,
      baileysLastSeenAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(channelAccounts.id, account.id),
        eq(channelAccounts.workspaceId, ctx.workspaceId),
      ),
    );

  let start: Response;
  try {
    start = await fetch(`${url}/accounts/${account.id}/start`, {
      method: "POST",
      headers: bridgeHeaders(secret),
    });
  } catch (err) {
    console.error("[baileys-repair] bridge start failed", err);
    return NextResponse.json(
      {
        error: {
          code: "BRIDGE_UNREACHABLE",
          message:
            "Die Sitzung wurde zurückgesetzt, aber die Bridge hat den Start nicht angenommen. Bitte erneut versuchen.",
        },
      },
      { status: 502 },
    );
  }
  if (!start.ok) {
    const json = (await start.json().catch(() => ({}))) as { error?: string };
    return NextResponse.json(
      {
        error: {
          code: "BRIDGE_REJECTED",
          status: start.status,
          message: json.error ?? `bridge returned ${start.status}`,
        },
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, accountId: account.id });
}
