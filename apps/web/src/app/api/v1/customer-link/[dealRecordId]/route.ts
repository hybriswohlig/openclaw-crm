/**
 * Operator-side endpoint to read / create / revoke a customer status link for
 * a specific deal. Lives under /api/v1 so it follows the existing auth
 * conventions (cookie or oc_sk_* Bearer).
 *
 * GET    → returns { token, url, dealNumber, viewCount, firstViewedAt, lastViewedAt, revokedAt }
 * POST   → ensure link exists (idempotent); returns the same shape
 * DELETE → revokes the link (soft — sets revoked_at, doesn't drop the row)
 *
 * URL resolution: prefers the per-OC `customDomain` once verified, falls back
 * to NEXT_PUBLIC_APP_URL. See resolveCustomerLinkOrigin in
 * services/customer-portal-data.ts.
 */
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getAuthContext, unauthorized, notFound, success } from "@/lib/api-utils";
import { db } from "@/db";
import { customerStatusLinks } from "@/db/schema/customer-portal";
import { dealNumbers } from "@/db/schema/financial";
import {
  ensureCustomerStatusLink,
  reactivateCustomerStatusLink,
  resolveCustomerLinkOrigin,
  revokeCustomerStatusLink,
} from "@/services/customer-portal-data";

export const dynamic = "force-dynamic";

function envFallback(req: NextRequest): string | null {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (envUrl) return envUrl;
  const host = req.headers.get("host");
  if (host) {
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host}`;
  }
  return null;
}

async function loadDealNumber(dealRecordId: string): Promise<string | null> {
  const [row] = await db
    .select({ dealNumber: dealNumbers.dealNumber })
    .from(dealNumbers)
    .where(eq(dealNumbers.dealRecordId, dealRecordId))
    .limit(1);
  return row?.dealNumber ?? null;
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

  const origin = await resolveCustomerLinkOrigin(
    dealRecordId,
    ctx.workspaceId,
    envFallback(req)
  );
  const dealNumber = await loadDealNumber(dealRecordId);

  return success({
    token: row.token,
    url: `${origin}/s/${row.token}`,
    dealNumber,
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
      dealNumber: null,
      skipped: true,
      reason: "feature_disabled_for_operating_company",
    });
  }

  const origin = await resolveCustomerLinkOrigin(
    dealRecordId,
    ctx.workspaceId,
    envFallback(req)
  );
  const dealNumber = await loadDealNumber(dealRecordId);

  return success({
    token: result.token,
    url: `${origin}/s/${result.token}`,
    dealNumber,
  });
}

/**
 * PATCH: un-revokes an existing revoked link. Idempotent. Returns the same
 * shape as POST so the share panel can drop the response straight back into
 * state.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ dealRecordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { dealRecordId } = await params;

  const result = await reactivateCustomerStatusLink({
    workspaceId: ctx.workspaceId,
    dealRecordId,
  });
  if (!result) return notFound("No customer link for this deal");

  const origin = await resolveCustomerLinkOrigin(
    dealRecordId,
    ctx.workspaceId,
    envFallback(req)
  );
  const dealNumber = await loadDealNumber(dealRecordId);

  return success({
    token: result.token,
    url: `${origin}/s/${result.token}`,
    dealNumber,
    reactivated: true,
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
