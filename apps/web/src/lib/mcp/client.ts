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

    const res = await fetch(url, { method, headers, body, redirect: "manual" });
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

/** Resolve the public origin of this deployment for self-calls. */
export function resolveBaseUrl(req?: Request): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.CRM_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/\/+$/, "")}`;
  }

  if (req) {
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
    const proto = req.headers.get("x-forwarded-proto") || "https";
    if (host) return `${proto}://${host}`.replace(/\/+$/, "");
  }

  return "http://localhost:3001";
}
