/**
 * Side-effect env loader for the dev scripts. Import this FIRST, before any
 * "@/" module, so modules that read env at import time (e.g. run-task.ts's
 * module-level CRM_TOOLS_API_URL / CRM_TOOLS_AUTH_TOKEN consts) see the values.
 * Mirrors next.config.ts precedence: repo-root .env(.local) first, then the
 * apps/web ones override.
 */
import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(__dirname, "../../../.env"), quiet: true });
loadEnv({ path: path.resolve(__dirname, "../../../.env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(__dirname, "../.env"), override: true, quiet: true });
loadEnv({ path: path.resolve(__dirname, "../.env.local"), override: true, quiet: true });

// The db client only enables SSL when NODE_ENV=production (src/db/index.ts:18),
// and Neon refuses non-SSL connections. Default it so the scripts connect.
if (!process.env.NODE_ENV) {
  (process.env as unknown as { NODE_ENV?: string }).NODE_ENV = "production";
}
