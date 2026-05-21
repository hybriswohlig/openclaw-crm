/**
 * Operator-side endpoint to read / create / revoke a customer status link for
 * a specific deal. Lives under /api/v1 so it follows the existing auth
 * conventions (cookie or oc_sk_* Bearer).
 *
 * GET    → returns { token, url, viewCount, firstViewedAt, lastViewedAt, revokedAt }
 * POST   → ensure link exists (idempotent); returns the same shape
 * DELETE → revokes the link (soft — sets revoked_at, doesn't drop the row)
 */
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getAuthContext, unauthorized, notFound, success } from "@/lib/api-utils";
import { db } from "@/db";
import { customerStatusLinks } from "@/db/schema/customer-portal";
import {
  ensureCustomerStatusLink,
  revokeCustomerStatusLink,
} from "@/services/customer-portal-data";

export const dynamic = "force-dynamic";

function publicUrlFor(token: string, origin: string): string {
  return `${origin.replace(/\/+$/, "")}/s/${token}`;
}

function resolveOrigin(req: NextRequest): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (envUrl) return envUrl;
  const host = req.headers.get("host");
  if (host) {
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host}`;
  }
  return "http://localhost:3001";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ dealRecordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { dealRecordId } = await params;

  const [row] = await db
    .select()
    .from(customerStatusLinks)
    .where(
      and(
        eq(customerStatusLinks.workspaceId, ctx.workspaceId),
        eq(customerStatusLinks.dealRecordId, dealRecordId)
      )
    )
    .limit(1);

  if (!row) return notFound("No customer link for this deal");

  return success({
    token: row.token,
    url: publicUrlFor(row.token, resolveOrigin(req)),
    viewCount: row.viewCount,
    firstViewedAt: row.firstViewedAt,
    lastViewedAt: row.lastViewedAt,
    revokedAt: row.revokedAt,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealRecordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { dealRecordId } = await params;

  const result = await ensureCustomerStatusLink({
    workspaceId: ctx.workspaceId,
    dealRecordId,
    createdBy: ctx.userId,
  });
  if (result.skipped || !result.token) {
    return success({
      token: null,
      url: null,
      skipped: true,
      reason: "feature_disabled_for_operating_company",
    });
  }

  return success({
    token: result.token,
    url: publicUrlFor(result.token, resolveOrigin(req)),
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ dealRecordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { dealRecordId } = await params;

  const [row] = await db
    .select({ token: customerStatusLinks.token })
    .from(customerStatusLinks)
    .where(
      and(
        eq(customerStatusLinks.workspaceId, ctx.workspaceId),
        eq(customerStatusLinks.dealRecordId, dealRecordId)
      )
    )
    .limit(1);
  if (!row) return notFound();

  await revokeCustomerStatusLink(row.token);
  return success({ revoked: true });
}
