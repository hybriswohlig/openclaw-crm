import { afterEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { UI_COOKIE, UI_COOKIE_MAX_AGE } from "./handy-links";
import { uiCookieSetzen } from "./ui-cookie";

function setCookie(res: NextResponse): string {
  return res.headers.getSetCookie().find((zeile) => zeile.startsWith(`${UI_COOKIE}=`)) ?? "";
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("uiCookieSetzen", () => {
  it("setzt crm_ui httpOnly, SameSite=lax, Path=/ und das Max-Age", () => {
    const res = NextResponse.json({ ok: true });
    expect(uiCookieSetzen(res, "neu")).toBe(res);
    expect(res.cookies.get(UI_COOKIE)?.value).toBe("neu");
    const header = setCookie(res);
    expect(header).toContain("HttpOnly");
    expect(header.toLowerCase()).toContain("samesite=lax");
    expect(header).toContain("Path=/");
    expect(header).toContain(`Max-Age=${UI_COOKIE_MAX_AGE}`);
    expect(header.toLowerCase()).not.toContain("secure");
  });

  it("setzt Secure nur in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = uiCookieSetzen(NextResponse.json({ ok: true }), "alt");
    expect(res.cookies.get(UI_COOKIE)?.value).toBe("alt");
    expect(setCookie(res).toLowerCase()).toContain("secure");
  });
});
