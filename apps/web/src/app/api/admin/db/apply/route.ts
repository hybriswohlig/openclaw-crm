import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin-auth";
import {
  assertPgDataType,
  assertPgIdentifier,
  getTargetDatabaseUrl,
  quoteIdent,
  withSqlClient,
} from "@/lib/admin-db";
const dataTypeEnum = z.enum([
  "text",
  "uuid",
  "boolean",
  "integer",
  "bigint",
  "numeric",
  "double precision",
  "timestamp",
  "timestamptz",
  "date",
  "jsonb",
]);

const defaultPresetEnum = z.enum([
  "none",
  "now",
  "uuid",
  "true",
  "false",
  "empty_text",
  "empty_json",
]);

const renameOp = z.object({
  kind: z.literal("rename_column"),
  table: z.string(),
  from: z.string(),
  to: z.string(),
});

const addOp = z.object({
  kind: z.literal("add_column"),
  table: z.string(),
  column: z.string(),
  dataType: dataTypeEnum,
  nullable: z.boolean(),
  defaultPreset: defaultPresetEnum,
});

const bodySchema = z.object({
  operations: z.array(z.discriminatedUnion("kind", [renameOp, addOp])).min(1).max(20),
});

function sqlTypeFragment(dataType: string): string {
  const t = assertPgDataType(dataType);
  if (t === "timestamptz") return "TIMESTAMPTZ";
  if (t === "double precision") return "DOUBLE PRECISION";
  return t.toUpperCase();
}

function defaultClause(
  preset: z.infer<typeof defaultPresetEnum>,
  dataType: string
): string {
  const t = assertPgDataType(dataType);
  switch (preset) {
    case "none":
      return "";
    case "now":
      if (t !== "timestamp" && t !== "timestamptz") {
        throw new Error("DEFAULT now() is only valid for timestamp / timestamptz columns");
      }
      return " DEFAULT now()";
    case "uuid":
      if (t !== "uuid") {
        throw new Error("DEFAULT gen_random_uuid() is only valid for uuid columns");
      }
      return " DEFAULT gen_random_uuid()";
    case "true":
      if (t !== "boolean") throw new Error("DEFAULT TRUE is only valid for boolean columns");
      return " DEFAULT TRUE";
    case "false":
      if (t !== "boolean") throw new Error("DEFAULT FALSE is only valid for boolean columns");
      return " DEFAULT FALSE";
    case "empty_text":
      if (t !== "text") throw new Error("DEFAULT '' is only valid for text columns");
      return " DEFAULT ''";
    case "empty_json":
      if (t !== "jsonb") throw new Error("DEFAULT '{}' is only valid for jsonb columns");
      return " DEFAULT '{}'::jsonb";
    default:
      return "";
  }
}

export async function POST(req: NextRequest) {
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

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Invalid JSON" } },
      { status: 400 }
    );
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: parsed.error.issues.map((i) => i.message).join("; "),
        },
      },
      { status: 400 }
    );
  }

  const { operations } = parsed.data;
  const preview: string[] = [];

  try {
    for (const op of operations) {
      assertPgIdentifier(op.table, "table name");
      if (op.kind === "rename_column") {
        assertPgIdentifier(op.from, "column name");
        assertPgIdentifier(op.to, "column name");
        preview.push(
          `ALTER TABLE ${quoteIdent(op.table)} RENAME COLUMN ${quoteIdent(op.from)} TO ${quoteIdent(op.to)};`
        );
      } else {
        assertPgIdentifier(op.column, "column name");
        const typeFrag = sqlTypeFragment(op.dataType);
        const nullFrag = op.nullable ? "NULL" : "NOT NULL";
        const defFrag = defaultClause(op.defaultPreset, op.dataType);
        preview.push(
          `ALTER TABLE ${quoteIdent(op.table)} ADD COLUMN ${quoteIdent(op.column)} ${typeFrag} ${nullFrag}${defFrag};`
        );
      }
    }
  } catch (e) {
    return NextResponse.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : String(e),
        },
      },
      { status: 400 }
    );
  }

  try {
    await withSqlClient(url, async (sql) => {
      await sql.begin(async (tx) => {
        for (const stmt of preview) {
          await tx.unsafe(stmt);
        }
      });
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        error: {
          code: "APPLY_FAILED",
          message,
        },
        data: { preview },
      },
      { status: 422 }
    );
  }

  return NextResponse.json({ data: { ok: true, applied: preview } });
}
