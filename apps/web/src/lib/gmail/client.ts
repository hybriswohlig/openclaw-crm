/**
 * Gmail REST API + OAuth2 plumbing for Google Workspace mailboxes.
 *
 * Server-side only (imports googleapis). Never import from a client component.
 *
 * Kottke (kottke-umzuege.de) and Ceylan (ceylan-operations.de) are SEPARATE
 * Workspace orgs → separate GCP projects → separate OAuth clients. We resolve
 * which client to use by the mailbox domain, so one deployment can serve both
 * tenants without losing the per-domain "Internal" consent-screen exemption.
 */

import { google } from "googleapis";

// gmail.modify: read + send + label. Enough to receive, reply, and (Phase 2)
// write our lead/info lanes back as Gmail labels. No full-mailbox delete.
export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];

/** Resolve the app's public base URL (mirrors resolveAuthBaseURL in lib/auth). */
export function getAppBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3001";
}

/** The redirect URI registered on each tenant's OAuth client. */
export function getGmailRedirectUri(): string {
  return `${getAppBaseUrl()}/api/integrations/gmail/oauth/callback`;
}

/**
 * Per-tenant OAuth client credentials, resolved by the mailbox domain. Configure
 * either a domain-keyed JSON map (preferred — covers both tenants in one env):
 *
 *   GMAIL_OAUTH_CLIENTS = {
 *     "kottke-umzuege.de":   { "clientId": "...", "clientSecret": "..." },
 *     "ceylan-operations.de":{ "clientId": "...", "clientSecret": "..." }
 *   }
 *
 * or a single fallback pair GOOGLE_GMAIL_CLIENT_ID / GOOGLE_GMAIL_CLIENT_SECRET
 * (useful for a one-tenant test). These are DISTINCT from the Better-Auth login
 * client (GOOGLE_CLIENT_ID/SECRET).
 */
export function getGmailClientConfig(address: string): {
  clientId: string;
  clientSecret: string;
} {
  const domain = address.split("@")[1]?.toLowerCase() ?? "";

  const raw = process.env.GMAIL_OAUTH_CLIENTS?.trim();
  if (raw) {
    try {
      const map = JSON.parse(raw) as Record<
        string,
        { clientId?: string; clientSecret?: string }
      >;
      const hit = map[domain];
      if (hit?.clientId && hit?.clientSecret) {
        return { clientId: hit.clientId, clientSecret: hit.clientSecret };
      }
    } catch (err) {
      console.error("[gmail] GMAIL_OAUTH_CLIENTS is not valid JSON:", err);
    }
  }

  const clientId = process.env.GOOGLE_GMAIL_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      `No Gmail OAuth client configured for domain "${domain}". ` +
        "Set GMAIL_OAUTH_CLIENTS (domain-keyed JSON) or GOOGLE_GMAIL_CLIENT_ID/SECRET."
    );
  }
  return { clientId, clientSecret };
}

/** Bare OAuth2 client for the connect flow (no user credentials set yet). */
export function makeOAuthClient(address: string) {
  const { clientId, clientSecret } = getGmailClientConfig(address);
  return new google.auth.OAuth2(clientId, clientSecret, getGmailRedirectUri());
}

/**
 * Authed Gmail API client built from a stored refresh token. The library
 * transparently exchanges it for short-lived access tokens on each call, so we
 * never persist access tokens ourselves.
 */
export function gmailFromRefreshToken(address: string, refreshToken: string) {
  const oauth = makeOAuthClient(address);
  oauth.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth: oauth });
}

/** True when a thrown googleapis error means the refresh token is dead. */
export function isGmailAuthError(err: unknown): boolean {
  const e = err as {
    code?: number | string;
    response?: { status?: number; data?: { error?: string; error_description?: string } };
    message?: string;
  };
  const status = Number(e?.code ?? e?.response?.status);
  const reason =
    e?.response?.data?.error ??
    e?.response?.data?.error_description ??
    e?.message ??
    "";
  return status === 401 || /invalid_grant|invalid_token|unauthorized/i.test(String(reason));
}

/** True when an incremental historyId is too old and we must do a full re-sync. */
export function isHistoryExpiredError(err: unknown): boolean {
  const e = err as { code?: number | string; response?: { status?: number } };
  const status = Number(e?.code ?? e?.response?.status);
  return status === 404 || status === 400;
}
