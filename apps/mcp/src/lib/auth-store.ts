import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Holds the active better-auth session cookie after login.
 * Prefer API keys for long-lived MCP configs; session is for interactive login.
 */
export class AuthStore {
  private sessionCookie: string | null = null;
  private sessionFile: string | null;

  constructor(sessionFile: string | null = null) {
    this.sessionFile = sessionFile;
    if (sessionFile && existsSync(sessionFile)) {
      try {
        const raw = readFileSync(sessionFile, "utf8").trim();
        if (raw) this.sessionCookie = raw;
      } catch {
        // ignore corrupt session file
      }
    }
  }

  getSessionCookie(): string | null {
    return this.sessionCookie;
  }

  setSessionCookie(cookie: string | null): void {
    this.sessionCookie = cookie;
    if (!this.sessionFile) return;
    try {
      if (!cookie) {
        if (existsSync(this.sessionFile)) unlinkSync(this.sessionFile);
        return;
      }
      mkdirSync(dirname(this.sessionFile), { recursive: true });
      writeFileSync(this.sessionFile, cookie, { mode: 0o600 });
    } catch {
      // persistence is best-effort
    }
  }

  clear(): void {
    this.setSessionCookie(null);
  }
}

/**
 * Parse Set-Cookie headers into a Cookie request header value for better-auth.
 * Keeps name=value pairs; drops attributes (Path, HttpOnly, etc.).
 */
export function cookiesFromSetCookie(setCookies: string[]): string {
  const pairs: string[] = [];
  for (const line of setCookies) {
    const first = line.split(";")[0]?.trim();
    if (first && first.includes("=")) pairs.push(first);
  }
  return pairs.join("; ");
}

/** Merge cookie header strings (later overrides same name). */
export function mergeCookies(...parts: Array<string | null | undefined>): string {
  const map = new Map<string, string>();
  for (const part of parts) {
    if (!part) continue;
    for (const pair of part.split(";")) {
      const trimmed = pair.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const name = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      map.set(name, value);
    }
  }
  return Array.from(map.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}
