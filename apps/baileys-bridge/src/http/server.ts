/**
 * Bridge HTTP control plane.
 *
 * Fastify with a shared-secret guard. The CRM web app calls these to
 * start/stop sockets and to send outbound messages. Health is unguarded
 * for Docker healthcheck.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import type { Logger } from "../lib/logger.js";
import type { SocketManager } from "../sockets/socket-manager.js";

export interface ServerOptions {
  port: number;
  bridgeSecret: string;
  manager: SocketManager;
  log: Logger;
}

// Either a digits-only WA id (legacy path, defaults to `@s.whatsapp.net`)
// or a full JID `digits[:N]@(lid|hosted.lid|hosted|s.whatsapp.net|c.us|g.us)`.
// The CRM passes the full JID for contacts whose Meta identity has migrated
// to LID-routing; the hosted variants cover cloud-hosted business accounts.
const PEER_WA_ID = z
  .string()
  .min(6)
  .regex(
    /^\+?\d{6,20}(?::\d+)?(?:@(?:lid|hosted\.lid|hosted|s\.whatsapp\.net|c\.us|g\.us))?$/,
    "peerWaId must be digits or a JID like 123@lid / 123@s.whatsapp.net",
  );

const SendBody = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    peerWaId: PEER_WA_ID,
    text: z.string().min(1),
  }),
  z.object({
    kind: z.enum(["image", "video", "audio", "document"]),
    peerWaId: PEER_WA_ID,
    mediaBase64: z.string().min(1),
    mimeType: z.string().min(3),
    fileName: z.string().optional(),
    caption: z.string().optional(),
  }),
]);

export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.addHook("onRequest", async (req, reply) => {
    if (req.routeOptions.url === "/healthz") return;
    const provided = req.headers["x-bridge-secret"];
    if (typeof provided !== "string" || provided !== opts.bridgeSecret) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.get("/healthz", async () => ({
    ok: true,
    sockets: opts.manager.health(),
  }));

  app.post<{ Params: { id: string } }>(
    "/accounts/:id/start",
    async (req, reply) => {
      const { id } = req.params;
      try {
        await opts.manager.start(id);
        return { ok: true };
      } catch (err) {
        opts.log.error({ err, accountId: id }, "[http] start failed");
        return reply.code(500).send({ error: "start_failed" });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/accounts/:id/stop",
    async (req) => {
      const { id } = req.params;
      await opts.manager.stop(id);
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/accounts/:id/send",
    async (req, reply) => {
      const { id } = req.params;
      const parsed = SendBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_body",
          issues: parsed.error.flatten(),
        });
      }
      const body = parsed.data;
      try {
        if (body.kind === "text") {
          const r = await opts.manager.sendText(id, body.peerWaId, body.text);
          return { ok: true, externalMessageId: r.keyId };
        }
        const r = await opts.manager.sendMedia(id, body.peerWaId, {
          kind: body.kind,
          mediaBase64: body.mediaBase64,
          mimeType: body.mimeType,
          fileName: body.fileName,
          caption: body.caption,
        });
        return { ok: true, externalMessageId: r.keyId };
      } catch (err) {
        opts.log.error({ err, accountId: id }, "[http] send failed");
        return reply.code(500).send({
          error: "send_failed",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/accounts/:id/health",
    async (req, reply) => {
      const { id } = req.params;
      const h = opts.manager.health().find((x) => x.id === id);
      if (!h) return reply.code(404).send({ error: "not_found" });
      return h;
    },
  );

  return app;
}
