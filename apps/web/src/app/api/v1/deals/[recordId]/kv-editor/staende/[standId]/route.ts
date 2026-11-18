import { NextRequest } from "next/server";
import { success } from "@/lib/api-utils";
import { kvRoute, type KvStandParams } from "@/lib/kv-editor-route";
import { standLesen } from "@/services/kv-editor";

export const dynamic = "force-dynamic";

/** GET → `KvStandDetail` (die Oberfläche fragt druckende Stände alle 5 s ab). */
export async function GET(req: NextRequest, { params }: KvStandParams) {
  return kvRoute(req, params, async (ctx, deal) => {
    const { standId } = await params;
    return success(await standLesen(ctx.workspaceId, deal, standId));
  });
}
