import { NextRequest } from "next/server";
import { success } from "@/lib/api-utils";
import { kvRoute, type KvStandParams } from "@/lib/kv-editor-route";
import { uebertragen } from "@/services/kv-editor";

export const dynamic = "force-dynamic";

/** POST (leer) → 201 `KvStandKopf`: Liste dieses Stands als Entwurf auf den aktuellen KV (`KALKULATION_NEU`, `quelle_ohne_stand`). */
export async function POST(req: NextRequest, { params }: KvStandParams) {
  return kvRoute(req, params, async (ctx, deal, wer) => {
    const { standId } = await params;
    return success(await uebertragen(ctx.workspaceId, deal, standId, wer.userId), 201);
  });
}
