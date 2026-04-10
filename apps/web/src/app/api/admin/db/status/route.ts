import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin-auth";
import {
  ADMIN_TARGET_DB_COOKIE,
  getConfiguredDatabaseUrl,
  getTargetDatabaseUrl,
  maskDatabaseUrl,
} from "@/lib/admin-db";

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!isAdminEmail(session?.user?.email)) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Admin access required" } },
      { status: 403 }
    );
  }

  const configured = getConfiguredDatabaseUrl();
  const active = getTargetDatabaseUrl(req);
  const hasCookieOverride = Boolean(req.cookies.get(ADMIN_TARGET_DB_COOKIE)?.value);

  return NextResponse.json({
    data: {
      envDatabase: maskDatabaseUrl(configured),
      activeDatabase: maskDatabaseUrl(active),
      usingCookieOverride: hasCookieOverride,
      usingEnvTarget: Boolean(process.env.DATABASE_TARGET_URL?.trim()),
    },
  });
}
