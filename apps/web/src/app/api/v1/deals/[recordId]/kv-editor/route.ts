import { NextRequest } from "next/server";
import { success } from "@/lib/api-utils";
import { kvRoute, type KvParams } from "@/lib/kv-editor-route";
import { ansicht } from "@/services/kv-editor";

export const dynamic = "force-dynamic";

/** GET → `KvEditorAnsicht`; legt bei Bedarf „Stand 1, Ausgangs-KV“ an (Spec 7.4). */
export async function GET(req: NextRequest, { params }: KvParams) {
  return kvRoute(req, params, async (ctx, deal, wer) => success(await ansicht(ctx.workspaceId, deal, wer)));
}
