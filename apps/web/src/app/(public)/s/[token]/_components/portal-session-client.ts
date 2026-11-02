"use client";

/**
 * Stable per-browser session id for one portal token. Shared by the visit
 * beacon and the PDF links so a download can be tied to the open.
 * Also sets a cookie the document route can read on Range requests that
 * drop the query string.
 */

const COOKIE = "kottke_portal_sid";

export function ensurePortalSession(token: string): string {
  const key = `kottke.portal.session.${token}`;
  let sid = "";
  try {
    sid = window.localStorage.getItem(key) ?? "";
  } catch {
    // private mode
  }
  if (!sid || sid.length > 64 || !/^[A-Za-z0-9_-]+$/.test(sid)) {
    sid = randomUuid();
    try {
      window.localStorage.setItem(key, sid);
    } catch {
      // ignore
    }
  }
  try {
    document.cookie = `${COOKIE}=${encodeURIComponent(sid)}; Path=/api/public/${encodeURIComponent(token)}; SameSite=Lax; Max-Age=2592000`;
  } catch {
    // ignore
  }
  return sid;
}

/** Append sid (and optional query flags) without touching a path-only URL's origin. */
export function withPortalSession(
  url: string,
  sid: string | null,
  extra?: Record<string, string>
): string {
  const parsed = new URL(url, "http://portal.local");
  if (sid) parsed.searchParams.set("sid", sid);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) parsed.searchParams.set(key, value);
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function randomUuid(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    // ignore
  }
  return (
    "fb-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  );
}
