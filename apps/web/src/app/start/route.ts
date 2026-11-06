import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-utils";
import { getUserSettings } from "@/services/user-settings";

/** Startweiche: neue Oberfläche nach Heute, sonst die alte Startseite, ohne Sitzung zum Login. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = await getAuthContext(req);
  if (!ctx) return NextResponse.redirect(new URL("/login", req.url));

  try {
    const settings = await getUserSettings(ctx.userId);
    const ziel = settings.uiVersion === "neu" ? "/app/heute" : "/home";
    return NextResponse.redirect(new URL(ziel, req.url));
  } catch {
    return NextResponse.redirect(new URL("/home", req.url));
  }
}
