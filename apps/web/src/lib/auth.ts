import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import * as schema from "@/db/schema";

/** Normalize origin: trim, no trailing slash. */
function addOrigin(set: Set<string>, value: string | undefined) {
  if (!value) return;
  const o = value.trim().replace(/\/+$/, "");
  if (o) set.add(o);
}

/** Hostname only (no scheme/path). Used for AUTH_TRUSTED_HOSTS. */
const HOST_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

function addTrustedHost(set: Set<string>, host: string | undefined) {
  if (!host) return;
  const h = host.trim().toLowerCase();
  if (!HOST_RE.test(h)) return;
  addOrigin(set, `https://${h}`);
}

/**
 * Better Auth rejects requests when the browser Origin is not listed here.
 * - NEXT_PUBLIC_APP_URL + TRUSTED_ORIGINS (full origins)
 * - VERCEL_URL / VERCEL_BRANCH_URL / VERCEL_PROJECT_PRODUCTION_URL (Vercel system vars)
 * - AUTH_TRUSTED_HOSTS: comma-separated hostnames for custom domains that are not Vercel’s
 *   “shortest production URL” (e.g. darioushkottke.online while primary remains *.vercel.app)
 */
function buildTrustedOrigins(): string[] {
  const origins = new Set<string>();
  addOrigin(origins, process.env.NEXT_PUBLIC_APP_URL);
  for (const part of (process.env.TRUSTED_ORIGINS || "").split(",")) {
    addOrigin(origins, part.trim());
  }
  for (const part of (process.env.AUTH_TRUSTED_HOSTS || "").split(",")) {
    addTrustedHost(origins, part.trim());
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    addOrigin(origins, `https://${vercelUrl}`);
  }

  const vercelBranch = process.env.VERCEL_BRANCH_URL?.trim();
  if (vercelBranch) {
    addOrigin(origins, vercelBranch);
  }

  const vercelProd =
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProd) {
    if (vercelProd.startsWith("http://") || vercelProd.startsWith("https://")) {
      addOrigin(origins, vercelProd);
    } else {
      addOrigin(origins, `https://${vercelProd}`);
    }
  }

  return [...origins];
}

function resolveAuthBaseURL(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3001";
}

export const auth = betterAuth({
  baseURL: resolveAuthBaseURL(),
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: buildTrustedOrigins(),
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID || "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
      enabled: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      enabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
  },
});

export type Session = typeof auth.$Infer.Session;
