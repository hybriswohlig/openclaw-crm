import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, badRequest, success } from "@/lib/api-utils";
import {
  listPrivateTransactions,
  createPrivateTransaction,
} from "@/services/financial";

const VALID_METHODS = ["cash", "bank_transfer", "other"] as const;
const VALID_DIRECTIONS = ["einlage", "entnahme"] as const;
type Method = typeof VALID_METHODS[number];
type Direction = typeof VALID_DIRECTIONS[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isValidAmount = (v: unknown) => Number.isFinite(Number(v)) && Number(v) > 0;
const isValidDate = (v: unknown) =>
  typeof v === "string" && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const data = await listPrivateTransactions(ctx.workspaceId);
  return success(data);
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

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

  if (!date || !amount) return badRequest("date and amount are required");
  if (!isValidDate(date)) return badRequest("Ungültiges Datum (JJJJ-MM-TT erwartet)");
  if (!isValidAmount(amount)) return badRequest("Betrag muss größer 0 sein");
  if (!fromPartner) return badRequest("fromPartner is required");
  if (!operatingCompanyId) return badRequest("operatingCompanyId is required");
  if (!method || !VALID_METHODS.includes(method)) {
    return badRequest(`method must be one of: ${VALID_METHODS.join(", ")}`);
  }
  if (!direction || !VALID_DIRECTIONS.includes(direction)) {
    return badRequest(`direction must be one of: ${VALID_DIRECTIONS.join(", ")}`);
  }

  const row = await createPrivateTransaction(ctx.workspaceId, {
    date,
    amount: String(amount),
    method: method as Method,
    fromPartner,
    toPartner: toPartner || null,
    operatingCompanyId,
    direction: direction as Direction,
    notes: notes || null,
  });
  return success(row, 201);
}
