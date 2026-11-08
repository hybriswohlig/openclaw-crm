import { NextRequest } from "next/server";
import { forbidden, getAuthContext, notFound, success, unauthorized } from "@/lib/api-utils";
import { ladeKundenAkte } from "@/services/kunden";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** GET → Kundenakte. 404 bei gelöscht, fremd oder keiner Person. Nur Sitzung. */
export async function GET(req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  if (ctx.authMethod !== "cookie") return forbidden("Kunden sind nur in der angemeldeten Sitzung lesbar.");

  const { id } = await params;
  const akte = await ladeKundenAkte(ctx.workspaceId, id);
  if (!akte) return notFound("Person nicht gefunden.");
  return success(akte);
}
