import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { db } from "@/db";
import { objects, attributes } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import { eq, and } from "drizzle-orm";

/**
 * GET /api/v1/operating-companies
 *
 * Returns a flat list of operating company records: `{ id, name }[]`.
 * Used by channel account forms to link an inbox number to a company.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  // 1. Find the operating_companies object.
  const [obj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(
      and(
        eq(objects.workspaceId, ctx.workspaceId),
        eq(objects.slug, "operating_companies"),
      ),
    )
    .limit(1);

  if (!obj) return success([]);

  // 2. Find the "name" attribute.
  const [nameAttr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, obj.id), eq(attributes.slug, "name")))
    .limit(1);

  if (!nameAttr) return success([]);

  // 3. Join records → recordValues to get id + name in one query.
  const rows = await db
    .select({
      id: records.id,
      name: recordValues.textValue,
    })
    .from(records)
    .innerJoin(
      recordValues,
      and(
        eq(recordValues.recordId, records.id),
        eq(recordValues.attributeId, nameAttr.id),
      ),
    )
    .where(eq(records.objectId, obj.id))
    .orderBy(recordValues.textValue);

  return success(
    rows.map((r) => ({ id: r.id, name: r.name ?? "Unnamed" })),
  );
}
