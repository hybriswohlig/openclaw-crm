import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin-auth";
import { getTargetDatabaseUrl, withSqlClient } from "@/lib/admin-db";

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!isAdminEmail(session?.user?.email)) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Admin access required" } },
      { status: 403 }
    );
  }

  const url = getTargetDatabaseUrl(req);
  if (!url) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "No database URL configured" } },
      { status: 400 }
    );
  }

  try {
    const tables = await withSqlClient(url, async (sql) => {
      const rows = await sql<{ table_name: string }[]>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `;
      return rows.map((r) => r.table_name);
    });
    return NextResponse.json({ data: { tables } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: { code: "QUERY_FAILED", message } },
      { status: 422 }
    );
  }
}
