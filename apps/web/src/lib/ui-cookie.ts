import { NextResponse } from "next/server";
import { UI_COOKIE, UI_COOKIE_MAX_AGE, type UiVersion } from "@/lib/handy-links";

/** Spiegel-Cookie `crm_ui` auf eine Antwort setzen. Die Datenbank bleibt die Wahrheit. */
export function uiCookieSetzen(res: NextResponse, v: UiVersion): NextResponse {
  res.cookies.set(UI_COOKIE, v, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: UI_COOKIE_MAX_AGE,
  });
  return res;
}
