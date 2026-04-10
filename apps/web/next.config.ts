import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

// Next only loads `.env*` from `apps/web` by default. Match `drizzle.config.ts` so repo-root
// `.env.local` (e.g. `CRM_ADMIN_EMAILS`, `DATABASE_URL`) is visible to the server.
const webDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webDir, "../..");
for (const filePath of [
  path.join(repoRoot, ".env"),
  path.join(repoRoot, ".env.local"),
  path.join(webDir, ".env"),
  path.join(webDir, ".env.local"),
]) {
  loadEnv({ path: filePath, override: true, quiet: true });
}

const nextConfig: NextConfig = {
  transpilePackages: ["@openclaw-crm/shared"],
  // output: "standalone" is set via NEXT_OUTPUT in Dockerfile for Docker builds
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
