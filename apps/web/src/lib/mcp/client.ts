/**
 * HTTP client used by MCP tools to call the CRM REST API with the caller's auth.
 */

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

export interface McpAuthContext {
  /** Bearer token (API key) if present */
  bearerToken?: string;
  /** Cookie header for session auth */
  cookie?: string;
  userId: string;
  workspaceId: string;
  workspaceRole: "admin" | "member";
  baseUrl: string;
}

export interface RequestOptions {
  method?: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
}

export class CrmClient {
  constructor(private readonly auth: McpAuthContext) {}

  get context(): McpAuthContext {
    return this.auth;
  }

  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? (options.body !== undefined ? "POST" : "GET");
    const url = new URL(
      path.startsWith("http")
        ? path
        : `${this.auth.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`
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

    if (this.auth.bearerToken) {
      headers.Authorization = this.auth.bearerToken.startsWith("Bearer ")
        ? this.auth.bearerToken
        : `Bearer ${this.auth.bearerToken}`;
    }
    if (this.auth.cookie) {
      headers.Cookie = this.auth.cookie;
    }

    let body: string | undefined;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    const res = await fetchFollowingSelfRedirects(url, { method, headers, body });
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        if (!res.ok) {
          throw new CrmApiError(res.status, "INVALID_JSON", text.slice(0, 500));
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

    if (json && typeof json === "object" && "data" in json) {
      return (json as { data: T }).data;
    }
    return json as T;
  }
}

/**
 * Origins that are unambiguously this deployment. Used to decide whether the
 * Authorization/Cookie headers may be replayed on a redirect — replaying them
 * anywhere else would hand the caller's API key to the redirect target.
 */
function selfOrigins(): Set<string> {
  const out = new Set<string>();
  const add = (raw?: string | null) => {
    if (!raw) return;
    const withProto = raw.startsWith("http") ? raw : `https://${raw}`;
    try {
      out.add(new URL(withProto).origin);
    } catch {
      // ignore unparseable config
    }
  };
  add(process.env.NEXT_PUBLIC_APP_URL?.trim());
  add(process.env.CRM_BASE_URL?.trim());
  add(process.env.VERCEL_URL);
  add(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  add(process.env.VERCEL_BRANCH_URL);
  return out;
}

const MAX_SELF_REDIRECTS = 3;

/**
 * Follow redirects that stay inside this deployment, replaying auth headers.
 *
 * Vercel 307-redirects a project's *.vercel.app origin to its production
 * domain. When the MCP self-call starts from the wrong origin every tool
 * fails with HTTP_ERROR 307, so treat such a hop as a misconfiguration to
 * absorb rather than an error to surface. Redirects that leave our own
 * origins are returned untouched — auth is never replayed off-origin.
 */
async function fetchFollowingSelfRedirects(
  url: URL,
  init: { method: string; headers: Record<string, string>; body?: string }
): Promise<Response> {
  let current = url;
  let res = await fetch(current, { ...init, redirect: "manual" });

  for (let hop = 0; hop < MAX_SELF_REDIRECTS; hop++) {
    if (res.status < 300 || res.status >= 400) return res;

    const location = res.headers.get("location");
    if (!location) return res;

    const target = new URL(location, current);
    const trusted =
      target.origin === current.origin || selfOrigins().has(target.origin);
    if (!trusted) return res;

    console.warn(
      `[mcp] self-call redirected ${current.origin} → ${target.origin}; ` +
        "set NEXT_PUBLIC_APP_URL to the canonical domain to avoid the extra hop."
    );

    current = target;
    res = await fetch(current, { ...init, redirect: "manual" });
  }

  return res;
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

/**
 * Resolve the public origin of this deployment for self-calls.
 *
 * The incoming request's host wins over env/VERCEL_URL on purpose. A self-call
 * has to go to a host that answers directly, and the host the client actually
 * reached is the only one guaranteed to do so. Both NEXT_PUBLIC_APP_URL and
 * VERCEL_URL can point at a *.vercel.app origin that Vercel 307-redirects to
 * the project's production domain, which turned every tool call into an
 * HTTP_ERROR 307 (the client does not follow redirects by default).
 */
export function resolveBaseUrl(req?: Request): string {
  if (req) {
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
    const proto = req.headers.get("x-forwarded-proto") || "https";
    if (host) return `${proto}://${host}`.replace(/\/+$/, "");
  }

  // No request context (background jobs, tests) — fall back to config.
  const fromEnv =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.CRM_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/\/+$/, "")}`;
  }

  return "http://localhost:3001";
}
