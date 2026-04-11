import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, badRequest, success } from "@/lib/api-utils";
import { listExpenses, createExpense } from "@/services/financial";

const VALID_CATEGORIES = ["fuel", "truck_rental", "equipment", "subcontractor", "toll", "other"] as const;
type Category = typeof VALID_CATEGORIES[number];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;
  const data = await listExpenses(recordId);
  return success(data);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;
  const body = await req.json();
  const { date, amount, category, description, recipient, paymentMethod, receiptFile } = body;

  if (!date || !amount) return badRequest("date and amount are required");
  if (category && !VALID_CATEGORIES.includes(category)) {
    return badRequest(`category must be one of: ${VALID_CATEGORIES.join(", ")}`);
  }

  const row = await createExpense(ctx.workspaceId, recordId, {
    date,
    amount: String(amount),
    category: (category as Category) ?? "other",
    description,
    recipient,
    paymentMethod,
    receiptFile,
  });
  return success(row, 201);
}
