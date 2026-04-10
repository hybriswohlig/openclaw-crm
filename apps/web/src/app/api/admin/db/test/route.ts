import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin-auth";
import { getTargetDatabaseUrl, testConnection } from "@/lib/admin-db";

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!isAdminEmail(session?.user?.email)) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Admin access required" } },
      { status: 403 }
    );
  }

  let body: { url?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const url = typeof body.url === "string" && body.url.trim()
    ? body.url.trim()
    : getTargetDatabaseUrl(req);

  if (!url) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "No database URL configured" } },
      { status: 400 }
    );
  }

  const result = await testConnection(url);
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: "CONNECTION_FAILED", message: result.message } },
      { status: 422 }
    );
  }

  return NextResponse.json({ data: { ok: true } });
}
