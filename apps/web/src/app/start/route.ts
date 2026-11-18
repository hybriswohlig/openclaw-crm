import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-utils";
import { uiCookieSetzen } from "@/lib/ui-cookie";
import { getUserSettings } from "@/services/user-settings";
import { ALTE_STARTSEITE } from "@/lib/ui-version";

/** Startweiche: neue Oberfläche nach Heute, sonst der Einstieg der alten (`ALTE_STARTSEITE`), ohne Sitzung zum Login. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = await getAuthContext(req);
  if (!ctx) return NextResponse.redirect(new URL("/login", req.url));

  try {
    const settings = await getUserSettings(ctx.userId);
    const ziel = settings.uiVersion === "neu" ? "/app/heute" : ALTE_STARTSEITE;
    return uiCookieSetzen(NextResponse.redirect(new URL(ziel, req.url)), settings.uiVersion);
  } catch {
    return NextResponse.redirect(new URL(ALTE_STARTSEITE, req.url));
  }
}
