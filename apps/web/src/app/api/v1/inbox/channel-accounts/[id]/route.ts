import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success, requireAdmin } from "@/lib/api-utils";
import { updateChannelAccount, deleteChannelAccount } from "@/services/inbox";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const deny = requireAdmin(ctx);
  if (deny) return deny;

  const { id } = await params;
  const body = await req.json();

  // Never allow wiping the credential to null via PATCH — only overwrite
  // it when a non-empty new value is provided. This prevents the edit form
  // (which initialises the field to "") from accidentally clearing the
  // stored API token / password.
  if (body.credential === null || body.credential === "") {
    delete body.credential;
  }

  const row = await updateChannelAccount(ctx.workspaceId, id, body);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return success(row);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const deny = requireAdmin(ctx);
  if (deny) return deny;

  const { id } = await params;
  const deleted = await deleteChannelAccount(ctx.workspaceId, id);
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
