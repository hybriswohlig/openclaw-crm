import { NextRequest } from "next/server";
import { success } from "@/lib/api-utils";
import { chatSchema, kvKoerper, kvRoute, type KvParams } from "@/lib/kv-editor-route";
import { kvChat, kvChatVerlauf } from "@/services/kv-editor";

export const dynamic = "force-dynamic";
/** KI bis 240 s (Zeitgrenze im Dienst), dazu Laden und Prüfen. */
export const maxDuration = 300;

/** GET → `KvChatBeitrag[]`, älteste zuerst, höchstens 200. */
export async function GET(req: NextRequest, { params }: KvParams) {
  return kvRoute(req, params, async (ctx, deal) => success(await kvChatVerlauf(ctx.workspaceId, deal)));
}

/** POST `{ standId, text }` → `KiAntwort` (Vorschläge, Ablehnungen, `nachrichtId` fürs Übernehmen). */
export async function POST(req: NextRequest, { params }: KvParams) {
  return kvRoute(req, params, async (ctx, deal, wer) => {
    const e = await kvKoerper(req, chatSchema);
    return success(await kvChat(ctx.workspaceId, deal, e, wer.userId));
  });
}
