import type { McpConfig } from "./config.js";
import {
  AuthStore,
  cookiesFromSetCookie,
  mergeCookies,
} from "./auth-store.js";

export class CrmApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "CrmApiError";
  }
}

export interface RequestOptions {
  method?: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  /** Skip auto-login on 401 (used during login itself) */
  skipAuthRetry?: boolean;
}

export class CrmClient {
  readonly config: McpConfig;
  readonly auth: AuthStore;
  private autoLoginAttempted = false;

  constructor(config: McpConfig, auth: AuthStore) {
    this.config = config;
    this.auth = auth;
  }

  authMode(): "api_key" | "session" | "env_password" | "none" {
    if (this.auth.getSessionCookie()) return "session";
    if (this.config.apiKey) return "api_key";
    if (this.config.email && this.config.password) return "env_password";
    return "none";
  }

  isAuthenticated(): boolean {
    return this.authMode() !== "none";
  }

  /**
   * Sign in with email/password via better-auth.
   * Stores the session cookie for subsequent API calls.
   */
  async login(email: string, password: string): Promise<{ user?: unknown; ok: true }> {
    const url = `${this.config.baseUrl}/api/auth/sign-in/email`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ email, password }),
      redirect: "manual",
    });

    const setCookies = getSetCookieHeaders(res);
    if (setCookies.length > 0) {
      const jar = cookiesFromSetCookie(setCookies);
      this.auth.setSessionCookie(
        mergeCookies(this.auth.getSessionCookie(), jar)
      );
    }

    let data: unknown = null;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      const msg =
        (data as { message?: string; error?: { message?: string } })?.message ||
        (data as { error?: { message?: string } })?.error?.message ||
        `Login failed (${res.status})`;
      throw new CrmApiError(res.status, "LOGIN_FAILED", msg, data);
    }

    // Some better-auth builds return user without Set-Cookie when already logged in;
    // if we still have no cookie, treat as failure for MCP use.
    if (!this.auth.getSessionCookie() && !this.config.apiKey) {
      throw new CrmApiError(
        401,
        "LOGIN_NO_SESSION",
        "Login succeeded but no session cookie was returned. Use a CRM_API_KEY instead.",
        data
      );
    }

    return { ok: true, user: (data as { user?: unknown })?.user ?? data };
  }

  async logout(): Promise<void> {
    const cookie = this.auth.getSessionCookie();
    if (cookie) {
      try {
        await fetch(`${this.config.baseUrl}/api/auth/sign-out`, {
          method: "POST",
          headers: {
            Cookie: cookie,
            Accept: "application/json",
          },
        });
      } catch {
        // ignore network errors on logout
      }
    }
    this.auth.clear();
    this.autoLoginAttempted = false;
  }

  /**
   * Call CRM REST API. Paths are relative to origin, e.g. `/api/v1/search`.
   */
  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    await this.ensureAuth();

    const res = await this.rawRequest(path, options);

    if (res.status === 401 && !options.skipAuthRetry) {
      // One retry after env-based re-login
      if (this.config.email && this.config.password && !this.config.apiKey) {
        this.auth.clear();
        this.autoLoginAttempted = false;
        await this.ensureAuth();
        const retry = await this.rawRequest(path, { ...options, skipAuthRetry: true });
        return this.parseResponse<T>(retry);
      }
    }

    return this.parseResponse<T>(res);
  }

  private async ensureAuth(): Promise<void> {
    if (this.config.apiKey) return;
    if (this.auth.getSessionCookie()) return;
    if (this.config.email && this.config.password && !this.autoLoginAttempted) {
      this.autoLoginAttempted = true;
      await this.login(this.config.email, this.config.password);
      return;
    }
    if (!this.isAuthenticated()) {
      throw new CrmApiError(
        401,
        "NOT_AUTHENTICATED",
        "Not authenticated. Set CRM_API_KEY, or CRM_EMAIL+CRM_PASSWORD, or call crm_login."
      );
    }
  }

  private async rawRequest(path: string, options: RequestOptions): Promise<Response> {
    const method = options.method ?? (options.body !== undefined ? "POST" : "GET");
    const url = new URL(
      path.startsWith("http") ? path : `${this.config.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`
    );

    if (options.query) {
      for (const [k, v] of Object.entries(options.query)) {
        if (v === undefined || v === null || v === "") continue;
        url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }

    const cookie = this.auth.getSessionCookie();
    if (cookie && !this.config.apiKey) {
      headers.Cookie = cookie;
    } else if (cookie && this.config.apiKey) {
      // Prefer API key; still attach cookie if both present (harmless)
      headers.Cookie = cookie;
    }

    let body: string | undefined;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    return fetch(url, { method, headers, body, redirect: "manual" });
  }

  private async parseResponse<T>(res: Response): Promise<T> {
    // Decide how to read the body before consuming it: res.text() on a JPEG or
    // a PDF destroys the bytes, and the failure then surfaces as a JSON parse
    // error with nothing left to recover. Mirrors apps/web/src/lib/mcp/client.ts.
    const contentType = res.headers.get("content-type") ?? "";
    if (isBinaryContentType(contentType)) {
      return (await readBinary(res, contentType)) as T;
    }

    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        if (!res.ok) {
          throw new CrmApiError(
            res.status,
            looksLikeHtml(text) ? "NOT_JSON_HTML" : "INVALID_JSON",
            looksLikeHtml(text)
              ? `No JSON API at ${new URL(res.url || "http://x/").pathname} — the server ` +
                `returned an HTML page (HTTP ${res.status}), which means this path has ` +
                "no route handler. Check the path."
              : `Response was not JSON (HTTP ${res.status}): ${text.slice(0, 500)}`
          );
        }
        return text as T;
      }
    }

    if (!res.ok) {
      const err = json as {
        error?: { code?: string; message?: string };
        message?: string;
      } | null;
      throw new CrmApiError(
        res.status,
        err?.error?.code ?? "HTTP_ERROR",
        err?.error?.message ?? err?.message ?? `HTTP ${res.status}`,
        json
      );
    }

    // CRM envelope: { data: ... }
    if (json && typeof json === "object" && "data" in json) {
      return (json as { data: T }).data;
    }
    return json as T;
  }
}

function getSetCookieHeaders(res: Response): string[] {
  // Node 20+ undici supports getSetCookie()
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") {
    return anyHeaders.getSetCookie();
  }
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

export function formatToolResult(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export function formatToolError(err: unknown): string {
  if (err instanceof CrmApiError) {
    return JSON.stringify(
      {
        error: true,
        status: err.status,
        code: err.code,
        message: err.message,
        details: err.body,
      },
      null,
      2
    );
  }
  if (err instanceof Error) {
    return JSON.stringify({ error: true, message: err.message }, null, 2);
  }
  return JSON.stringify({ error: true, message: String(err) }, null, 2);
}


/** Envelope for a binary response body, so bytes survive a JSON-only client. */
export interface BinaryResponseEnvelope {
  _binary: true;
  mimeType: string;
  byteLength: number;
  contentBase64: string;
  note: string;
}

/** 8 MB, matching apps/web's MCP inline ceiling. */
const MAX_INLINE_BYTES = 8 * 1024 * 1024;

const JSON_CONTENT_TYPE = /^application\/([\w.+-]+\+)?json\b/i;

function isBinaryContentType(contentType: string): boolean {
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (!type) return false;
  if (JSON_CONTENT_TYPE.test(type)) return false;
  if (type.startsWith("text/")) return false;
  if (type === "application/xml" || type === "application/javascript") return false;
  return true;
}

function looksLikeHtml(text: string): boolean {
  return /^\s*(<!doctype html|<html[\s>])/i.test(text);
}

async function readBinary(
  res: Response,
  contentType: string
): Promise<BinaryResponseEnvelope> {
  const buffer = Buffer.from(await res.arrayBuffer());

  if (!res.ok) {
    throw new CrmApiError(
      res.status,
      "HTTP_ERROR",
      `HTTP ${res.status} with a ${contentType || "binary"} body (${buffer.length} bytes)`
    );
  }
  if (buffer.length > MAX_INLINE_BYTES) {
    throw new CrmApiError(
      413,
      "BINARY_TOO_LARGE",
      `Response is ${buffer.length} bytes of ${contentType || "binary"}, over the ` +
        `${MAX_INLINE_BYTES}-byte inline limit.`
    );
  }

  return {
    _binary: true,
    mimeType: contentType.split(";")[0].trim() || "application/octet-stream",
    byteLength: buffer.length,
    contentBase64: buffer.toString("base64"),
    note: "Binary response wrapped as base64. Decode contentBase64 to get the file.",
  };
}
