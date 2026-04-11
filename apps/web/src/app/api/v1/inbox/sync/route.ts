import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized } from "@/lib/api-utils";
import { seedEmailAccountsFromEnv } from "@/services/inbox";
import { syncAllEmailAccounts } from "@/services/inbox-email";

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  try {
    await seedEmailAccountsFromEnv(ctx.workspaceId);
    await syncAllEmailAccounts(ctx.workspaceId);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[inbox/sync]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}
