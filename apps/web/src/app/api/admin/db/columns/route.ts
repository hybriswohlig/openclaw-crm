import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin-auth";
import {
  assertPgIdentifier,
  getTargetDatabaseUrl,
  withSqlClient,
} from "@/lib/admin-db";

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!isAdminEmail(session?.user?.email)) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Admin access required" } },
      { status: 403 }
    );
  }

  const table = req.nextUrl.searchParams.get("table") ?? "";
  try {
    assertPgIdentifier(table, "table name");
  } catch (e) {
    return NextResponse.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Invalid table",
        },
      },
      { status: 400 }
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
    const columns = await withSqlClient(url, async (sql) => {
      return sql<
        {
          column_name: string;
          data_type: string;
          is_nullable: string;
          column_default: string | null;
        }[]
      >`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${table}
        ORDER BY ordinal_position
      `;
    });
    return NextResponse.json({ data: { columns } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: { code: "QUERY_FAILED", message } },
      { status: 422 }
    );
  }
}
