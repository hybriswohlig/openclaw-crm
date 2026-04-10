import { NextRequest, NextResponse } from "next/server";

const publicPaths = ["/login", "/register", "/api/auth"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

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
