import { NextRequest } from "next/server";
import { getAuthContext, notFound, success, unauthorized } from "@/lib/api-utils";
import { betriebsfirmaImWorkspace, ladeKasse } from "@/services/kasse";

export const dynamic = "force-dynamic";

/** GET `?firma=<ocId>` → `{ data: KasseAntwort }`. Liest nur; Nur-Lesen-Schlüssel und Agenten dürfen. */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const firma = req.nextUrl.searchParams.get("firma") || null;
  if (firma && !(await betriebsfirmaImWorkspace(ctx.workspaceId, firma))) return notFound();
  return success(await ladeKasse(ctx.workspaceId, firma));
}
