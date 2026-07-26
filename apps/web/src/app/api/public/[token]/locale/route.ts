// apps/web/src/app/api/public/[token]/locale/route.ts
//
// Persists the customer's portal language choice.
//
// The cookie is what the next request actually reads (see page.tsx); writing
// the link row as well means the choice survives a device change and is
// visible operator-side. Both happen here so the client fires one request.

import { NextRequest, NextResponse } from "next/server";
import {
  PORTAL_LOCALE_COOKIE,
  PORTAL_LOCALE_COOKIE_MAX_AGE,
  isPortalLocale,
} from "@openclaw-crm/customer-portal-core";
import { setPreferredLocaleForToken } from "@/services/customer-portal-data";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  let body: { locale?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: { code: "BAD_REQUEST" } }, { status: 400 });
  }

  if (!isPortalLocale(body.locale)) {
    return NextResponse.json(
      { error: { code: "INVALID_LOCALE" } },
      { status: 400 }
    );
  }
  const locale = body.locale;

  const result = await setPreferredLocaleForToken(token, locale);
  if (!result.ok) {
    const status =
      result.reason === "not_found" || result.reason === "invalid_token"
        ? 404
        : result.reason === "revoked"
          ? 410
          : 400;
    return NextResponse.json(
      { error: { code: result.reason.toUpperCase() } },
      { status }
    );
  }

  const res = NextResponse.json({ data: { locale } });
  // Not httpOnly on purpose: the error boundary is a client component with no
  // server context and reads this cookie to pick its language. It holds a
  // language tag, nothing sensitive.
  res.cookies.set(PORTAL_LOCALE_COOKIE, locale, {
    maxAge: PORTAL_LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return res;
}
