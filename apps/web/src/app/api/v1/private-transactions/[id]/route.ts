import { NextRequest } from "next/server";
import {
  getAuthContext,
  unauthorized,
  notFound,
  badRequest,
  success,
} from "@/lib/api-utils";
import {
  updatePrivateTransaction,
  deletePrivateTransaction,
} from "@/services/financial";

const VALID_METHODS = ["cash", "bank_transfer", "other"] as const;
const VALID_DIRECTIONS = ["einlage", "entnahme"] as const;
type Method = typeof VALID_METHODS[number];
type Direction = typeof VALID_DIRECTIONS[number];

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;
  const body = await req.json();
  const {
    date,
    amount,
    method,
    fromPartner,
    toPartner,
    operatingCompanyId,
    direction,
    notes,
  } = body;

  if (method && !VALID_METHODS.includes(method)) {
    return badRequest(`method must be one of: ${VALID_METHODS.join(", ")}`);
  }
  if (direction && !VALID_DIRECTIONS.includes(direction)) {
    return badRequest(`direction must be one of: ${VALID_DIRECTIONS.join(", ")}`);
  }

  const row = await updatePrivateTransaction(id, ctx.workspaceId, {
    ...(date !== undefined && { date }),
    ...(amount !== undefined && { amount: String(amount) }),
    ...(method !== undefined && { method: method as Method }),
    ...(fromPartner !== undefined && { fromPartner }),
    ...(toPartner !== undefined && { toPartner: toPartner || null }),
    ...(operatingCompanyId !== undefined && { operatingCompanyId }),
    ...(direction !== undefined && { direction: direction as Direction }),
    ...(notes !== undefined && { notes: notes || null }),
  });
  if (!row) return notFound("Private transaction not found");
  return success(row);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;
  const row = await deletePrivateTransaction(id, ctx.workspaceId);
  if (!row) return notFound("Private transaction not found");
  return success({ deleted: true });
}
