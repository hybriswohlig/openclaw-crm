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
import type { BridgeSendRecord } from "../outbound/record-send.js";
import type { SocketManager } from "../sockets/socket-manager.js";

/** The control-plane surface the HTTP server needs. SocketManager satisfies it. */
export interface BridgeControl {
  start(accountId: string): Promise<void>;
  stop(accountId: string): Promise<void>;
  sendText(
    accountId: string,
    peerWaId: string,
    body: string,
  ): Promise<{ keyId: string }>;
  sendMedia(
    accountId: string,
    peerWaId: string,
    media: {
      kind: "image" | "video" | "audio" | "document";
      mediaBase64: string;
      mimeType: string;
      fileName?: string;
      caption?: string;
    },
  ): Promise<{ keyId: string }>;
  health(): ReturnType<SocketManager["health"]>;
  /** Persist a send that already succeeded. Must not call sendMessage. */
  recordBridgeSend(args: BridgeSendRecord): Promise<boolean>;
}

export interface ServerOptions {
  port: number;
  bridgeSecret: string;
  manager: BridgeControl;
  log: Logger;
}

/**
 * 20 MB attachments arrive as base64 JSON (~26.7 MB) plus a small envelope.
 * Fastify's default bodyLimit is 1 MiB, so anything over about 750 KB was a
 * 413. 30 MiB covers that file and stays under nginx `client_max_body_size 50m`
 * on the bridge host. The CRM guard uses the same number
 * (`INBOX_BRIDGE_BODY_LIMIT_BYTES`).
 */
export const BRIDGE_BODY_LIMIT_BYTES = 30 * 1024 * 1024;

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
  const app = Fastify({ logger: false, bodyLimit: BRIDGE_BODY_LIMIT_BYTES });

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
          const recorded = await recordAfterSend(opts, {
            accountId: id,
            peerWaId: body.peerWaId,
            externalMessageId: r.keyId,
            kind: "text",
            body: body.text,
          });
          return { ok: true, externalMessageId: r.keyId, recorded };
        }
        const r = await opts.manager.sendMedia(id, body.peerWaId, {
          kind: body.kind,
          mediaBase64: body.mediaBase64,
          mimeType: body.mimeType,
          fileName: body.fileName,
          caption: body.caption,
        });
        const caption = body.caption?.trim() ?? "";
        const recorded = await recordAfterSend(opts, {
          accountId: id,
          peerWaId: body.peerWaId,
          externalMessageId: r.keyId,
          kind: body.kind,
          body: caption,
          previewLabel: caption
            ? null
            : body.kind === "image"
              ? "📷 Bild"
              : body.kind === "video"
                ? "🎞️ Video"
                : body.kind === "audio"
                  ? "🎤 Sprachnachricht"
                  : "📎 Dokument",
          mimeType: body.mimeType,
          fileName: body.fileName,
          mediaBase64: body.mediaBase64,
        });
        return { ok: true, externalMessageId: r.keyId, recorded };
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

/**
 * CRM history write for a send that WhatsApp already accepted.
 * Swallows recorder failures: the message is on the wire, and a 500 would
 * make the caller retry and deliver it twice.
 */
async function recordAfterSend(
  opts: ServerOptions,
  args: BridgeSendRecord,
): Promise<boolean> {
  try {
    return await opts.manager.recordBridgeSend(args);
  } catch (err) {
    opts.log.error(
      { err, accountId: args.accountId, externalMessageId: args.externalMessageId },
      "[http] CRM record threw after a successful send",
    );
    return false;
  }
}
