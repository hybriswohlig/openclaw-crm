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

/**
 * Better Auth rejects requests when the browser Origin is not listed here.
 * On Vercel, every deployment has its own hostname (…-git-… or …-hash…);
 * VERCEL_URL is set automatically to that host so sign-up works on those URLs
 * while NEXT_PUBLIC_APP_URL can stay on the stable production domain.
 */
function buildTrustedOrigins(): string[] {
  const origins = new Set<string>();
  addOrigin(origins, process.env.NEXT_PUBLIC_APP_URL);
  for (const part of (process.env.TRUSTED_ORIGINS || "").split(",")) {
    addOrigin(origins, part);
  }
  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    addOrigin(origins, `https://${vercelUrl}`);
  }
  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProd) {
    addOrigin(origins, `https://${vercelProd}`);
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
