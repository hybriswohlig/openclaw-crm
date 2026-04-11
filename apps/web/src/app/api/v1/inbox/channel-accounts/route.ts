import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success, requireAdmin } from "@/lib/api-utils";
import { getChannelAccounts, createChannelAccount, seedEmailAccountsFromEnv } from "@/services/inbox";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  await seedEmailAccountsFromEnv(ctx.workspaceId);

  const rows = await getChannelAccounts(ctx.workspaceId);
  // Strip credentials from non-admin responses
  if (ctx.workspaceRole !== "admin") {
    return success(rows.map(({ credential: _c, ...rest }) => rest));
  }
  return success(rows);
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const deny = requireAdmin(ctx);
  if (deny) return deny;

  const body = await req.json();
  const { name, channelType, address, credential, operatingCompanyRecordId, imapHost, smtpHost, wabaId, waPhoneNumberId } = body;

  if (!name || !channelType || !address) {
    return NextResponse.json({ error: "name, channelType and address are required" }, { status: 400 });
  }

  const row = await createChannelAccount(ctx.workspaceId, {
    name, channelType, address, credential, operatingCompanyRecordId,
    imapHost, smtpHost, wabaId, waPhoneNumberId,
  });
  return success(row);
}
