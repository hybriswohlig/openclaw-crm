/**
 * Identity advertised in the MCP `initialize` result.
 *
 * Hosts cache tools/list for this name and version. A reconnect does not ask
 * again while the version stays 0.1.0, and Cursor in particular ignores a
 * reconnect unless it also receives notifications/tools/list_changed.
 * Bump MCP_SERVER_VERSION whenever a tool schema changes. Keep the stdio
 * server in apps/mcp/src/server-info.ts on the same literal.
 */
export const MCP_SERVER_NAME = "openclaw-crm";
export const MCP_SERVER_VERSION = "0.2.0";

/** Fresh tools/list must not be stored by Next, Vercel, or a shared cache. */
export const MCP_CACHE_CONTROL =
  "private, no-store, no-cache, max-age=0, must-revalidate";

export const TOOLS_LIST_CHANGED_METHOD = "notifications/tools/list_changed";

export function applyMcpCacheHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", MCP_CACHE_CONTROL);
  headers.set("CDN-Cache-Control", "no-store");
  headers.set("Vercel-CDN-Cache-Control", "no-store");
  headers.set("Pragma", "no-cache");
  headers.set("X-MCP-Server-Version", MCP_SERVER_VERSION);
  const vary = headers.get("Vary");
  if (!vary) headers.set("Vary", "Authorization");
  else if (!vary.toLowerCase().split(",").some((part) => part.trim().toLowerCase() === "authorization")) {
    headers.set("Vary", `${vary}, Authorization`);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Streamable-HTTP notification stream. mcp-handler answers GET with 405, so a
 * client never hears that the tool list changed and keeps the snapshot it
 * stored for server version 0.1.0. One notification at the start of the stream
 * is enough: the client then calls tools/list on the existing session.
 */
export function toolsChangedStream(signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      send(
        `event: message\ndata: ${JSON.stringify({
          jsonrpc: "2.0",
          method: TOOLS_LIST_CHANGED_METHOD,
        })}\n\n`
      );
      const stop = () => {
        if (timer) clearInterval(timer);
        timer = undefined;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      timer = setInterval(() => {
        try {
          send(": ping\n\n");
        } catch {
          stop();
        }
      }, 15_000);
      if (signal.aborted) stop();
      else signal.addEventListener("abort", stop, { once: true });
    },
    cancel() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": MCP_CACHE_CONTROL,
      "CDN-Cache-Control": "no-store",
      "Vercel-CDN-Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-MCP-Server-Version": MCP_SERVER_VERSION,
      Vary: "Authorization",
    },
  });
}
