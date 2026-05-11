/**
 * Baileys auth-state proxy.
 *
 * The bridge does not have direct Postgres access (it runs on a different
 * VPS). It reads and writes its Baileys `AuthenticationState` (signal-protocol
 * keys + creds) through this endpoint. We persist it encrypted at rest in
 * `workspace_settings` under key `baileys.auth_state.<channelAccountId>` via
 * the existing pgp_sym_encrypt path.
 *
 *   GET  → returns { state: <plaintext-json> | null }
 *   PUT  → body: { state: <plaintext-json> } — re-encrypts and persists
 *
 * Auth: Bearer `oc_sk_*` API key, scoped to a workspace. Cross-workspace
 * access is blocked by the channel-account ownership check below.
 *
 * The state blob is a Baileys-shaped JSON document; we treat it as opaque.
 * Tens of KB typically; a few hundred KB for long-lived sessions with many
 * counterparties.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { channelAccounts } from "@/db/schema/inbox";
import { and, eq, isNull } from "drizzle-orm";
import { getAuthContext, unauthorized, badRequest } from "@/lib/api-utils";
import {
  getSecret,
  setSecret,
  deleteSetting,
} from "@/services/workspace-settings";

export const dynamic = "force-dynamic";

function authStateKey(accountId: string): string {
  return `baileys.auth_state.${accountId}`;
}

async function resolveAccount(
  workspaceId: string,
  accountId: string
): Promise<{ id: string; workspaceId: string } | null> {
  const [row] = await db
    .select({
      id: channelAccounts.id,
      workspaceId: channelAccounts.workspaceId,
    })
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.id, accountId),
        eq(channelAccounts.workspaceId, workspaceId),
        eq(channelAccounts.channelType, "whatsapp"),
        isNull(channelAccounts.waPhoneNumberId)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { accountId } = await params;
  const account = await resolveAccount(ctx.workspaceId, accountId);
  if (!account) {
    return NextResponse.json(
      { error: "channel_account_not_baileys_or_not_found" },
      { status: 404 }
    );
  }

  const value = await getSecret(ctx.workspaceId, authStateKey(account.id));
  if (!value) {
    return NextResponse.json({ state: null });
  }

  // The bridge stored the state as a JSON string; deliver it parsed so the
  // bridge doesn't have to round-trip the parse / stringify itself.
  let state: unknown = null;
  try {
    state = JSON.parse(value);
  } catch (err) {
    console.error(
      "[baileys-creds] stored auth state is not valid JSON:",
      err
    );
    // Treat as cold start — bridge will re-pair.
    return NextResponse.json({ state: null });
  }

  return NextResponse.json({ state });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { accountId } = await params;
  const account = await resolveAccount(ctx.workspaceId, accountId);
  if (!account) {
    return NextResponse.json(
      { error: "channel_account_not_baileys_or_not_found" },
      { status: 404 }
    );
  }

  let body: { state?: unknown } | null = null;
  try {
    body = (await req.json()) as { state?: unknown };
  } catch {
    return badRequest("invalid_json");
  }

  if (!body || body.state === undefined) {
    return badRequest("state required (object or null)");
  }

  // Bridge MAY send `state: null` to clear the row (e.g. on logout — but we
  // also clear it server-side from the pairing webhook).
  if (body.state === null) {
    try {
      await deleteSetting(ctx.workspaceId, authStateKey(account.id));
    } catch (err) {
      console.error("[baileys-creds] failed to delete state:", err);
      return NextResponse.json(
        { error: "failed_to_delete_state" },
        { status: 500 }
      );
    }
    return NextResponse.json({ success: true, cleared: true });
  }

  const serialized = JSON.stringify(body.state);
  try {
    await setSecret(ctx.workspaceId, authStateKey(account.id), serialized);
  } catch (err) {
    console.error("[baileys-creds] failed to persist state:", err);
    return NextResponse.json(
      { error: "failed_to_persist_state" },
      { status: 500 }
    );
  }
  return NextResponse.json({ success: true, sizeBytes: serialized.length });
}
