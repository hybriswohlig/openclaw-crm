import { NextRequest } from "next/server";
import { success } from "@/lib/api-utils";
import { kvRoute, type KvStandParams } from "@/lib/kv-editor-route";
import { standLesen } from "@/services/kv-editor";

export const dynamic = "force-dynamic";

/** GET → `KvStandDetail` (einmal beim Wählen und wenn ein Druck endet; die Abfrage nutzt `…/kopf`). */
export async function GET(req: NextRequest, { params }: KvStandParams) {
  return kvRoute(req, params, async (ctx, deal) => {
    const { standId } = await params;
    return success(await standLesen(ctx.workspaceId, deal, standId));
  });
}
