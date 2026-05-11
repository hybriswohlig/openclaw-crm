/**
 * Bridge entry point.
 *
 * 1. Load env, build logger, CRM client, socket manager.
 * 2. Start the HTTP control plane.
 * 3. Bootstrap: fetch all 'inhouse' Baileys accounts from the CRM and
 *    start a socket for each. The CRM is the source of truth — the
 *    bridge holds no persistent local state beyond live sockets.
 * 4. Run a periodic re-sync (default every 30s) so accounts the
 *    operator activates while the bridge is running get picked up
 *    without an explicit /accounts/:id/start call.
 *
 * Crashes exit non-zero so Docker `restart: unless-stopped` cycles us.
 */
import { loadConfig } from "./config.js";
import { createLogger } from "./lib/logger.js";
import { CrmClient } from "./lib/crm-client.js";
import { SocketManager } from "./sockets/socket-manager.js";
import { buildServer } from "./http/server.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = createLogger(cfg.LOG_LEVEL);
  log.info({ port: cfg.BRIDGE_PORT }, "[bridge] starting");

  const crm = new CrmClient(cfg.CRM_BASE_URL, cfg.CRM_API_KEY, log);
  const manager = new SocketManager({ crm, log });

  const server = await buildServer({
    port: cfg.BRIDGE_PORT,
    bridgeSecret: cfg.BRIDGE_SECRET,
    manager,
    log,
  });
  await server.listen({ host: "0.0.0.0", port: cfg.BRIDGE_PORT });
  log.info({ port: cfg.BRIDGE_PORT }, "[bridge] http listening");

  // Bootstrap + periodic reconcile.
  const reconcile = async (): Promise<void> => {
    try {
      const accounts = await crm.listInhouseAccounts();
      log.debug({ count: accounts.length }, "[bridge] reconcile tick");
      for (const a of accounts) {
        if (!manager.has(a.id)) {
          log.info(
            { accountId: a.id, name: a.name },
            "[bridge] starting socket from reconcile",
          );
          // Fire-and-forget; manager handles its own errors.
          void manager.start(a.id);
        }
      }
      // We intentionally do NOT stop sockets that the CRM no longer lists.
      // The /accounts/:id/stop control endpoint is the only way to stop —
      // this avoids a race where a transient list error would tear down
      // healthy sockets.
    } catch (err) {
      log.warn({ err }, "[bridge] reconcile failed");
    }
  };

  await reconcile();
  setInterval(() => void reconcile(), cfg.ACCOUNT_POLL_INTERVAL_MS);

  // Graceful shutdown.
  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, "[bridge] shutdown signal");
    try {
      await server.close();
    } catch (err) {
      log.warn({ err }, "[bridge] server close failed");
    }
    try {
      await manager.stopAll();
    } catch (err) {
      log.warn({ err }, "[bridge] manager stop failed");
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

process.on("uncaughtException", (err) => {
  console.error("[bridge] uncaughtException", err);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  console.error("[bridge] unhandledRejection", err);
  process.exit(1);
});

void main().catch((err: unknown) => {
  console.error("[bridge] fatal startup", err);
  process.exit(1);
});
