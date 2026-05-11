import { z } from "zod";

const ConfigSchema = z.object({
  CRM_BASE_URL: z.string().url(),
  CRM_API_KEY: z.string().min(8),
  BRIDGE_SECRET: z.string().min(16),
  BRIDGE_PORT: z.coerce.number().int().min(1024).max(65535).default(8787),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  // Polling cadence for the bootstrap account watcher. Keep modest — the
  // primary signal is HTTP push from the CRM (start/stop). This is the
  // safety net for missed pushes / cold-start.
  ACCOUNT_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(5000)
    .default(30_000),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    const lines = Object.entries(flat.fieldErrors).map(
      ([k, errs]) => `  ${k}: ${(errs ?? []).join(", ")}`,
    );
    throw new Error(
      `[baileys-bridge] invalid env:\n${lines.join("\n")}`,
    );
  }
  return parsed.data;
}
