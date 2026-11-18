import { NextRequest } from "next/server";
import { success } from "@/lib/api-utils";
import { kvKoerper, kvRoute, standAnlegenSchema, type KvParams } from "@/lib/kv-editor-route";
import { standAnlegen } from "@/services/kv-editor";

export const dynamic = "force-dynamic";

/** POST `{ vorgaengerId, setzen, zuruecksetzen, kiNachrichtId? }` → 201 `KvStandKopf` (neuer Entwurf, Spec 7.2). */
export async function POST(req: NextRequest, { params }: KvParams) {
  return kvRoute(req, params, async (ctx, deal, wer) => {
    const e = await kvKoerper(req, standAnlegenSchema);
    return success(await standAnlegen(ctx.workspaceId, deal, e, wer.userId), 201);
  });
}
