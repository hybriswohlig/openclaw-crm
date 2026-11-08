import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { inboxConversations } from "@/db/schema";
import { altesZiel, neuesZiel, weiterZielAus, type UiVersion } from "@/lib/handy-links";
import { getAuthContext } from "@/lib/api-utils";
import { uiCookieSetzen } from "@/lib/ui-cookie";
import { getUserSettings } from "@/services/user-settings";

export const dynamic = "force-dynamic";

/** Deal eines Gesprächs in diesem Workspace. Unbekannt, fremd oder Lesefehler: null. */
async function dealDesGespraechs(workspaceId: string, convId: string): Promise<string | null> {
  try {
    const [zeile] = await db
      .select({ dealRecordId: inboxConversations.dealRecordId })
      .from(inboxConversations)
      .where(and(eq(inboxConversations.id, convId), eq(inboxConversations.workspaceId, workspaceId)))
      .limit(1);
    return zeile?.dealRecordId ?? null;
  } catch {
    return null;
  }
}

function umleiten(req: NextRequest, pfad: string, version: UiVersion | null): NextResponse {
  const res = NextResponse.redirect(new URL(pfad, req.url), 307);
  res.headers.set("Cache-Control", "no-store");
  return version ? uiCookieSetzen(res, version) : res;
}

/** Neutrale Weiche: Sitzung, dann Oberfläche aus der Datenbank, Ziel nur aus dem Vertrag. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = await getAuthContext(req);
  if (!ctx) {
    const login = new URL("/login", req.url);
    login.searchParams.set("redirect", req.nextUrl.pathname + req.nextUrl.search);
    return umleiten(req, `${login.pathname}${login.search}`, null);
  }

  const ziel = weiterZielAus(req.nextUrl.searchParams);
  // Lesefehler: Ziel alt, aber kein Cookie, sonst bliebe ein kurzer DB-Fehler ein Jahr
  // lang als „alt“ stehen (wie /start).
  let version: UiVersion | null = null;
  try {
    version = (await getUserSettings(ctx.userId)).uiVersion;
  } catch {
    version = null;
  }

  const pfad =
    version === "neu"
      ? neuesZiel(ziel, ziel.art === "gespraech" ? await dealDesGespraechs(ctx.workspaceId, ziel.id) : null)
      : altesZiel(ziel);
  return umleiten(req, pfad, version);
}
