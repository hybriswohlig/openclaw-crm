const BASE = "https://x.invalid";

/**
 * Validates a `?redirect=` target before navigating to it after login.
 * Only a path on our own site passes; `javascript:` URLs, other hosts and
 * protocol-relative tricks (`//host`, `/\host` — browsers treat `\` as `/`)
 * get the fallback.
 */
export function safeRedirectPath(value: string | null | undefined, fallback: string): string {
  if (!value || !value.startsWith("/")) return fallback;
  if (value[1] === "/" || value.includes("\\")) return fallback;
  if (/[\x00-\x1f\x7f]/.test(value)) return fallback;

  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  // Dot segments collapse during parsing: "/a/..//evil.example" becomes
  // "//evil.example", which the browser reads as another host.
  if (url.pathname.startsWith("//")) return fallback;
  return url.pathname + url.search + url.hash;
}
