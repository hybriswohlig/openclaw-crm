import { NextRequest, NextResponse } from "next/server";
import { recordCrewRatings } from "@/services/customer-portal-data";

export const dynamic = "force-dynamic";

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "0.0.0.0";
}

interface RateBody {
  ratings: Array<{ employeeId: string; stars: number; comment?: string | null }>;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  let body: RateBody;
  try {
    body = (await req.json()) as RateBody;
  } catch {
    return NextResponse.json({ error: { code: "BAD_REQUEST" } }, { status: 400 });
  }
  if (!Array.isArray(body.ratings)) {
    return NextResponse.json({ error: { code: "BAD_REQUEST" } }, { status: 400 });
  }

  const result = await recordCrewRatings(
    token,
    body.ratings.map((r) => ({
      employeeId: String(r.employeeId),
      stars: Number(r.stars),
      comment: r.comment ?? null,
    })),
    { ipAddress: clientIp(req) }
  );

  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : result.reason === "revoked" ? 410 : 400;
    return NextResponse.json({ error: { code: result.reason.toUpperCase() } }, { status });
  }
  return NextResponse.json({ data: { ok: true, count: result.count } });
}
