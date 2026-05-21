/**
 * Thin Vercel API client, scoped to one Vercel project + team.
 *
 * Gated on the `VERCEL_API_TOKEN` env var. When unset, `isConfigured()` returns
 * false and the UI falls back to "Add this domain manually in your Vercel
 * dashboard" instructions. When set, the admin can attach + verify a domain
 * directly from the CRM settings.
 *
 * Required env vars (production-only):
 *   VERCEL_API_TOKEN     — a personal or team-scoped access token with
 *                          "Read/write projects + domains" scope.
 *   VERCEL_PROJECT_ID    — the prj_… id (already exists in .vercel/project.json
 *                          but not auto-exposed at runtime — set it as an env
 *                          var explicitly).
 *   VERCEL_TEAM_ID       — the team_… id (same).
 *
 * Docs reference (kept terse; actual API responses are read at runtime so we
 * never depend on a stale type definition):
 *   https://vercel.com/docs/rest-api/endpoints/projects#add-a-domain-to-a-project
 *   https://vercel.com/docs/rest-api/endpoints/projects#verify-project-domain
 */

const API_BASE = "https://api.vercel.com";

export interface VercelConfig {
  apiToken: string;
  projectId: string;
  teamId: string | null;
}

export function getVercelConfig(): VercelConfig | null {
  const apiToken = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_TEAM_ID ?? null;
  if (!apiToken || !projectId) return null;
  return { apiToken, projectId, teamId };
}

export function isConfigured(): boolean {
  return getVercelConfig() !== null;
}

export interface VercelVerificationRecord {
  type: string;
  domain: string;
  value: string;
  reason?: string;
}

export interface VercelDomainStatus {
  /** True when the domain row exists on the Vercel project. */
  attached: boolean;
  /** True when Vercel has finished its own verification (DNS + cert). */
  verified: boolean | null;
  /** TXT challenges or other actions Vercel still wants you to do. */
  verification: VercelVerificationRecord[];
  /** Raw error if a call failed. */
  error: string | null;
}

function teamParam(cfg: VercelConfig): string {
  return cfg.teamId ? `?teamId=${encodeURIComponent(cfg.teamId)}` : "";
}

async function call<T>(
  cfg: VercelConfig,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; body: T | null; rawText: string }> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.apiToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const rawText = await res.text();
  let parsed: T | null = null;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText) as T;
    } catch {
      parsed = null;
    }
  }
  return { ok: res.ok, status: res.status, body: parsed, rawText };
}

/**
 * Add a domain to the project. Idempotent on Vercel's side — a second add
 * returns 409 with code "domain_already_in_use" which we treat as success.
 */
export async function attachDomain(domain: string): Promise<VercelDomainStatus> {
  const cfg = getVercelConfig();
  if (!cfg) return { attached: false, verified: null, verification: [], error: "VERCEL_API_TOKEN not configured" };

  const path = `/v10/projects/${encodeURIComponent(cfg.projectId)}/domains${teamParam(cfg)}`;
  const res = await call<{ verification?: VercelVerificationRecord[]; error?: { code?: string; message?: string } }>(
    cfg,
    "POST",
    path,
    { name: domain }
  );

  if (res.ok && res.body) {
    return {
      attached: true,
      verified: null,
      verification: res.body.verification ?? [],
      error: null,
    };
  }

  const code = res.body?.error?.code;
  if (res.status === 409 && (code === "domain_already_in_use" || code === "domain_taken")) {
    // Already attached to this project — fetch status to populate verification.
    return getDomainStatus(domain);
  }
  return {
    attached: false,
    verified: null,
    verification: [],
    error: res.body?.error?.message ?? `Vercel API ${res.status}: ${res.rawText.slice(0, 200)}`,
  };
}

/**
 * Read the current state of a project domain.
 */
export async function getDomainStatus(domain: string): Promise<VercelDomainStatus> {
  const cfg = getVercelConfig();
  if (!cfg) return { attached: false, verified: null, verification: [], error: "VERCEL_API_TOKEN not configured" };

  const path = `/v9/projects/${encodeURIComponent(cfg.projectId)}/domains/${encodeURIComponent(domain)}${teamParam(cfg)}`;
  const res = await call<{
    verified?: boolean;
    verification?: VercelVerificationRecord[];
    error?: { message?: string };
  }>(cfg, "GET", path);

  if (res.status === 404) {
    return { attached: false, verified: null, verification: [], error: null };
  }
  if (!res.ok || !res.body) {
    return {
      attached: false,
      verified: null,
      verification: [],
      error: res.body?.error?.message ?? `Vercel API ${res.status}: ${res.rawText.slice(0, 200)}`,
    };
  }
  return {
    attached: true,
    verified: res.body.verified ?? false,
    verification: res.body.verification ?? [],
    error: null,
  };
}

/**
 * Tell Vercel to re-run its own verification (DNS + TXT challenge). Useful
 * after the operator has added the requested DNS records.
 */
export async function triggerVerify(domain: string): Promise<VercelDomainStatus> {
  const cfg = getVercelConfig();
  if (!cfg) return { attached: false, verified: null, verification: [], error: "VERCEL_API_TOKEN not configured" };

  const path = `/v9/projects/${encodeURIComponent(cfg.projectId)}/domains/${encodeURIComponent(domain)}/verify${teamParam(cfg)}`;
  const res = await call<{
    verified?: boolean;
    verification?: VercelVerificationRecord[];
    error?: { message?: string };
  }>(cfg, "POST", path);

  if (!res.ok || !res.body) {
    return {
      attached: true,
      verified: false,
      verification: [],
      error: res.body?.error?.message ?? `Vercel API ${res.status}: ${res.rawText.slice(0, 200)}`,
    };
  }
  return {
    attached: true,
    verified: res.body.verified ?? false,
    verification: res.body.verification ?? [],
    error: null,
  };
}

/**
 * Remove a domain from the project. We expose this for the eventual "remove
 * domain" button in settings — not wired into the UI yet.
 */
export async function detachDomain(domain: string): Promise<{ ok: boolean; error: string | null }> {
  const cfg = getVercelConfig();
  if (!cfg) return { ok: false, error: "VERCEL_API_TOKEN not configured" };

  const path = `/v9/projects/${encodeURIComponent(cfg.projectId)}/domains/${encodeURIComponent(domain)}${teamParam(cfg)}`;
  const res = await call<{ error?: { message?: string } }>(cfg, "DELETE", path);
  if (!res.ok) {
    return { ok: false, error: res.body?.error?.message ?? `Vercel API ${res.status}` };
  }
  return { ok: true, error: null };
}
