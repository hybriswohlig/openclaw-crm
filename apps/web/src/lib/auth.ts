import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import * as schema from "@/db/schema";

function buildTrustedOrigins(): string[] {
  const raw = process.env.TRUSTED_ORIGINS || "";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";
  const fromEnv = raw.split(",").map((s) => s.trim()).filter(Boolean);

  const origins = new Set([appUrl, ...fromEnv]);

  // Also trust the www. variant of each https origin
  for (const origin of [...origins]) {
    try {
      const u = new URL(origin);
      if (u.protocol === "https:" && !u.hostname.startsWith("www.")) {
        origins.add(`https://www.${u.hostname}`);
      }
    } catch {
      // ignore malformed entries
    }
  }

  return Array.from(origins);
}

function getBootstrapAdminEmails(): Set<string> {
  const raw = process.env.CRM_ADMIN_EMAILS || "";
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

export const auth = betterAuth({
  baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001",
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: buildTrustedOrigins(),
  user: {
    additionalFields: {
      approvalStatus: {
        type: "string",
        required: false,
        defaultValue: "pending",
      },
      isAppAdmin: {
        type: "boolean",
        required: false,
        defaultValue: false,
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const email = (user.email || "").toLowerCase().trim();
          const admins = getBootstrapAdminEmails();

          // Bootstrap admins get app-admin privileges
          if (admins.has(email)) {
            return {
              data: {
                approvalStatus: "approved",
                isAppAdmin: true,
              },
            };
          }

          // Anyone with a @vi-kang.com email is auto-approved
          if (email.endsWith("@vi-kang.com")) {
            return {
              data: {
                approvalStatus: "approved",
                isAppAdmin: false,
              },
            };
          }

          // All other users go on the waiting list
          return {
            data: {
              approvalStatus: "pending",
              isAppAdmin: false,
            },
          };
        },
      },
    },
  },
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
