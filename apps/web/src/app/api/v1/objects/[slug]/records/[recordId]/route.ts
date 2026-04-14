import { NextRequest } from "next/server";
import {
  getAuthContext,
  unauthorized,
  notFound,
  badRequest,
  forbidden,
  success,
  type AuthContext,
} from "@/lib/api-utils";
import { getObjectBySlug } from "@/services/objects";
import { getRecord, updateRecord, deleteRecord } from "@/services/records";
import type { FlatRecord } from "@/services/records";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { slug, recordId } = await params;
  const obj = await getObjectBySlug(ctx.workspaceId, slug);
  if (!obj) return notFound("Object not found");

  const record = await getRecord(obj.id, recordId);
  if (!record) return notFound("Record not found");

  return success(record);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { slug, recordId } = await params;
  const obj = await getObjectBySlug(ctx.workspaceId, slug);
  if (!obj) return notFound("Object not found");

  // Ownership gate: non-admin members can only edit records assigned to them
  // (or unassigned records, so they can claim them by self-assigning).
  const current = await getRecord(obj.id, recordId);
  if (!current) return notFound("Record not found");

  const guard = assertCanEdit(ctx, current);
  if (guard) return guard;

  const body = await req.json();
  const { values } = body;

  if (!values || typeof values !== "object") {
    return badRequest("values object is required");
  }

  const record = await updateRecord(obj.id, recordId, values, ctx.userId);
  if (!record) return notFound("Record not found");

  return success(record);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { slug, recordId } = await params;
  const obj = await getObjectBySlug(ctx.workspaceId, slug);
  if (!obj) return notFound("Object not found");

  const current = await getRecord(obj.id, recordId);
  if (!current) return notFound("Record not found");

  const guard = assertCanEdit(ctx, current);
  if (guard) return guard;

  const deleted = await deleteRecord(obj.id, recordId);
  if (!deleted) return notFound("Record not found");

  return success({ id: deleted.id, deleted: true });
}

/**
 * Admins can edit anything. Plain members can edit a record only if:
 *   (a) the record has no `owner` set (unclaimed), OR
 *   (b) the `owner` field equals the member's user id.
 * Returns a forbidden() response when the guard fires, otherwise null.
 */
function assertCanEdit(ctx: AuthContext, record: FlatRecord) {
  if (ctx.workspaceRole === "admin") return null;

  const ownerVal = record.values.owner;
  if (ownerVal === undefined || ownerVal === null || ownerVal === "") return null;

  // actor_reference values are stored as the user id (string)
  if (typeof ownerVal === "string" && ownerVal === ctx.userId) return null;

  // Hydrated shape: { id, name, email } — fall back to comparing id
  if (
    typeof ownerVal === "object" &&
    ownerVal !== null &&
    "id" in (ownerVal as Record<string, unknown>) &&
    (ownerVal as { id: unknown }).id === ctx.userId
  ) {
    return null;
  }

  return forbidden(
    "You can only edit records assigned to you. Ask a workspace admin to reassign this record."
  );
}
