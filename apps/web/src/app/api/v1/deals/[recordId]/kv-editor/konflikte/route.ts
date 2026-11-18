import { NextRequest } from "next/server";
import { success } from "@/lib/api-utils";
import { konflikteSchema, kvKoerper, kvRoute, type KvParams } from "@/lib/kv-editor-route";
import { konflikteEntscheiden } from "@/services/kv-editor";

export const dynamic = "force-dynamic";

/** POST `{ standId, entscheidungen }` → `KonflikteAntwort` (`{ stand, neuerEntwurf }`, Spec 7.6 Schritt 5). */
export async function POST(req: NextRequest, { params }: KvParams) {
  return kvRoute(req, params, async (ctx, deal, wer) => {
    const e = await kvKoerper(req, konflikteSchema);
    return success(await konflikteEntscheiden(ctx.workspaceId, deal, e, wer.userId));
  });
}
