import { NextRequest } from "next/server";
import { success } from "@/lib/api-utils";
import { kvRoute, type KvStandParams } from "@/lib/kv-editor-route";
import { neuDrucken } from "@/services/kv-editor";

export const dynamic = "force-dynamic";

/** POST (leer) → 201 `KvStandKopf`: neuer Stand mit derselben Liste und Grundlage (Kimi 21). */
export async function POST(req: NextRequest, { params }: KvStandParams) {
  return kvRoute(req, params, async (ctx, deal, wer) => {
    const { standId } = await params;
    return success(await neuDrucken(ctx.workspaceId, deal, standId, wer.userId), 201);
  });
}
