import { NextRequest, NextResponse } from "next/server";

// Public paths that never require a session cookie. Cron and webhook endpoints
// must be here — they are hit by Vercel's cron scheduler and third-party
// platforms (Meta, etc.) that have no browser session, but they do their own
// bearer/HMAC auth inside the route handler.
const publicPaths = [
  "/login",
  "/register",
  "/api/auth",
  "/api/webhooks",
  "/api/cron",
  // MessageBird inbound SMS webhook — HMAC-signed inside the route handler.
  // No session, no Bearer token. Without this entry the production webhook
  // 307s to /login and MessageBird drops the inbound message.
  "/api/v1/inbox/sms/messagebird-inbound",
  // Customer status portal — token-scoped, no session
  "/s/",
  "/api/public/",
  // Employee portal APIs — they enforce employee auth in the handler
  // (getEmployeePortalContextFromHeaders) or are token-based (set-password).
  "/api/v1/portal/",
  // Client-error diagnostic sink (temporary).
  "/api/v1/diag/",
];

/** The mobile employee portal lives on its own host (kottke-mitarbeiter.*). */
function isEmployeePortalHost(host: string): boolean {
  const h = host.split(":")[0].toLowerCase();
  return h.startsWith("kottke-mitarbeiter.") || h === "mitarbeiter.localhost";
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const host = req.headers.get("host") || "";

  // ── Employee portal subdomain ────────────────────────────────────────────
  // kottke-mitarbeiter.<domain> serves the mobile portal: every page path is
  // rewritten under /mitarbeiter, with its own login gate. Shared APIs and
  // assets pass through (APIs do their own auth in the handler).
  if (isEmployeePortalHost(host)) {
    if (
      pathname.startsWith("/api/") ||
      pathname.startsWith("/_next") ||
      pathname.startsWith("/favicon") ||
      pathname === "/manifest.webmanifest" ||
      pathname === "/sw.js"
    ) {
      return NextResponse.next();
    }

    const portalPublic = pathname === "/login" || pathname === "/passwort-setzen";
    if (!portalPublic) {
      const cookie =
        req.cookies.get("better-auth.session_token") ||
        req.cookies.get("__Secure-better-auth.session_token");
      if (!cookie) {
        const loginUrl = new URL("/login", req.url);
        if (pathname !== "/") loginUrl.searchParams.set("redirect", pathname);
        return NextResponse.redirect(loginUrl);
      }
    }

    const url = req.nextUrl.clone();
    url.pathname = `/mitarbeiter${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(url);
  }

  // On the CRM host the portal routes are hidden.
  if (pathname === "/mitarbeiter" || pathname.startsWith("/mitarbeiter/")) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  // Former marketing/docs routes → home (bookmarks)
  if (
    pathname === "/docs" ||
    pathname.startsWith("/docs/") ||
    pathname === "/blog" ||
    pathname.startsWith("/blog/") ||
    pathname === "/compare" ||
    pathname.startsWith("/compare/")
  ) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (pathname === "/select-workspace" || pathname.startsWith("/select-workspace/")) {
    return NextResponse.redirect(new URL("/home", req.url));
  }

  // Allow public paths and static assets
  if (
    publicPaths.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/"
  ) {
    return NextResponse.next();
  }

  // Allow API requests with Bearer tokens (auth checked in getAuthContext)
  if (
    pathname.startsWith("/api/") &&
    req.headers.get("authorization")?.startsWith("Bearer ")
  ) {
    return NextResponse.next();
  }

  // Allow public API spec endpoints and SEO files without auth
  if (pathname === "/openapi.json" || pathname === "/llms.txt" || pathname === "/llms-api.txt" || pathname === "/llms-full.txt" || pathname === "/robots.txt" || pathname === "/sitemap.xml") {
    return NextResponse.next();
  }

  // PWA core: manifest, service worker, and the public VAPID key endpoint must
  // be reachable without a session so the browser can install the app and the
  // service worker can register before the user signs in.
  if (
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    pathname === "/api/v1/push/vapid-public-key"
  ) {
    return NextResponse.next();
  }

  // Check for Better Auth session cookie
  const sessionCookie =
    req.cookies.get("better-auth.session_token") ||
    req.cookies.get("__Secure-better-auth.session_token");

  if (!sessionCookie) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all paths except static files
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
