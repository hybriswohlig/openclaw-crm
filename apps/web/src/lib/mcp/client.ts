/**
 * HTTP client used by MCP tools to call the CRM REST API with the caller's auth.
 */
import { MAX_MCP_INLINE_BYTES } from "@/lib/attachment-content";

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

    // Decide how to read the body BEFORE consuming it. Calling res.text() on a
    // JPEG mangles the bytes beyond recovery, which is how every attempt to
    // fetch a customer photo through crm_api ended as "INVALID_JSON" with the
    // pixels already destroyed.
    const contentType = res.headers.get("content-type") ?? "";
    if (isBinaryContentType(contentType)) {
      return (await readBinary(res, url, contentType)) as T;
    }

    // A missing content-type is exactly where a body is most likely to be
    // binary (the crm-tools job proxy forwards the upstream header only when
    // it is present), so decide by decoding rather than by assuming text.
    let text: string;
    if (!contentType) {
      const decoded = await readUntypedBody(res, url);
      if (typeof decoded !== "string") return decoded as T;
      text = decoded;
    } else {
      text = await res.text();
    }
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        // HTML is never a tool result, whatever the status. A 200 reaches here
        // when middleware redirects an unauthenticated /api/ call to /login and
        // the redirect is followed — returning the login page as data would be
        // the same silent lie in a different costume.
        if (!res.ok || looksLikeHtml(text)) {
          throw new CrmApiError(
            res.status,
            looksLikeHtml(text) ? "NOT_JSON_HTML" : "INVALID_JSON",
            nonJsonMessage(url, res.status, text),
            undefined
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

/**
 * Envelope returned for a binary response body.
 *
 * Wrapping rather than failing is what makes `crm_api` honest about routes
 * that stream bytes (attachment `/content`, rendered PDFs): the caller gets
 * real base64 in real JSON instead of a parse error over a destroyed body.
 */
export interface BinaryResponseEnvelope {
  _binary: true;
  mimeType: string;
  byteLength: number;
  fileName?: string;
  contentBase64: string;
  note: string;
}

const JSON_CONTENT_TYPE = /^application\/([\w.+-]+\+)?json\b/i;

/** text/* (except HTML we still want to inspect) and JSON are read as text. */
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

/**
 * Message for a response that could not be parsed as JSON.
 *
 * The status is left exactly as the server sent it — a Next.js app-shell 404
 * really is a 404 — but the text now says *why* and what to call instead,
 * rather than dumping HTML under a code the caller cannot act on.
 */
function nonJsonMessage(url: URL, status: number, text: string): string {
  if (looksLikeHtml(text)) {
    const hint = attachmentHint(url.pathname);
    // Only a 404 licenses "this path has no route handler". A 500, a 504 or a
    // platform 413 also answer with HTML, and telling an agent the endpoint
    // does not exist would stop it retrying a route that is real and merely
    // failing right now.
    const cause =
      status === 404
        ? "which means this path has no route handler"
        : "which usually means the request never reached a route handler " +
          "(platform error, timeout, or an auth redirect) — the route may " +
          "well exist and be failing transiently";
    return (
      `Got HTML, not JSON, from ${url.pathname} (HTTP ${status}), ${cause}.` +
      (hint ? ` ${hint}` : "")
    );
  }
  return `Response was not JSON (HTTP ${status}): ${text.slice(0, 500)}`;
}

/** Point attachment-shaped misses at the tool that actually returns pixels. */
function attachmentHint(pathname: string): string | null {
  if (!/attachment/i.test(pathname)) return null;
  return (
    "For inbox attachment bytes use the crm_get_attachment tool " +
    "(or GET /api/v1/inbox/attachments/{id})."
  );
}

/**
 * Read a body that arrived without a content-type.
 *
 * Returns the decoded string when the bytes are valid UTF-8, otherwise the
 * binary envelope. Decoding strictly is the whole point: `res.text()` would
 * happily turn a PDF into replacement characters and lose it for good.
 */
async function readUntypedBody(
  res: Response,
  url: URL
): Promise<string | BinaryResponseEnvelope> {
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0) return "";
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return buildBinaryEnvelope(buffer, url, "application/octet-stream", null);
  }
}

async function readBinary(
  res: Response,
  url: URL,
  contentType: string
): Promise<BinaryResponseEnvelope> {
  const buffer = Buffer.from(await res.arrayBuffer());

  if (!res.ok) {
    throw new CrmApiError(
      res.status,
      "HTTP_ERROR",
      `HTTP ${res.status} with a ${contentType || "binary"} body ` +
        `(${buffer.length} bytes) from ${url.pathname}`
    );
  }

  return buildBinaryEnvelope(
    buffer,
    url,
    contentType,
    res.headers.get("content-disposition")
  );
}

function buildBinaryEnvelope(
  buffer: Buffer,
  url: URL,
  contentType: string,
  disposition: string | null
): BinaryResponseEnvelope {
  if (buffer.length > MAX_MCP_INLINE_BYTES) {
    throw new CrmApiError(
      413,
      "BINARY_TOO_LARGE",
      `${url.pathname} returned ${buffer.length} bytes of ${contentType || "binary"}, ` +
        `over the ${MAX_MCP_INLINE_BYTES}-byte inline limit. ` +
        (attachmentHint(url.pathname) ??
          "Fetch it in a browser session instead of through MCP.")
    );
  }

  return {
    _binary: true,
    mimeType: contentType.split(";")[0].trim() || "application/octet-stream",
    byteLength: buffer.length,
    ...(fileNameFromDisposition(disposition) ?? {}),
    contentBase64: buffer.toString("base64"),
    note:
      "Binary response wrapped as base64. Decode contentBase64 to get the file. " +
      "For inbox photos prefer crm_get_attachment, which also returns a " +
      "renderable image block.",
  };
}

function fileNameFromDisposition(
  header: string | null
): { fileName: string } | null {
  if (!header) return null;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  if (!match) return null;
  try {
    return { fileName: decodeURIComponent(match[1]) };
  } catch {
    return { fileName: match[1] };
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
