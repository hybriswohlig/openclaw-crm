import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { NextRequest } from "next/server";
import { getAuthContext } from "@/lib/api-utils";
import { registerCrmTools } from "@/lib/mcp/register-tools";
import { resolveBaseUrl } from "@/lib/mcp/client";
import {
  applyMcpCacheHeaders,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  toolsChangedStream,
} from "@/lib/mcp/server-info";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
/** Vercel fluid / serverless max duration for long tool chains */
export const maxDuration = 60;

/**
 * Verify Bearer API key (oc_sk_…) or better-auth session cookie.
 * Auth context is attached to AuthInfo.extra for tool handlers.
 */
async function verifyToken(
  req: Request,
  bearerToken?: string
): Promise<AuthInfo | undefined> {
  const nextReq = new NextRequest(req.url, {
    headers: req.headers,
    method: req.method,
  });

  const ctx = await getAuthContext(nextReq);
  if (!ctx) return undefined;

  const authorizationHeader = req.headers.get("authorization");
  const cookie = req.headers.get("cookie") ?? undefined;

  return {
    token: bearerToken || "session",
    clientId: ctx.userId,
    scopes: ["crm"],
    extra: {
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      workspaceRole: ctx.workspaceRole,
      bearerToken: bearerToken?.startsWith("oc_sk_") ? bearerToken : undefined,
      authorizationHeader,
      cookie,
      baseUrl: resolveBaseUrl(req),
      authMethod: ctx.authMethod,
      apiKeyAccess: ctx.apiKeyAccess,
      readOnly: ctx.apiKeyAccess === "read",
    },
  };
}

function buildHandler(req: Request) {
  // New handler per request. mcp-handler keeps one stateless McpServer for the
  // lifetime of a createMcpHandler() call and never re-registers tools, so a
  // module-level handler would serve the tool list from the first request
  // that hit this warm instance.
  const mcp = createMcpHandler(
    (server) => {
      registerCrmTools(server, req);
    },
    {
      serverInfo: {
        name: MCP_SERVER_NAME,
        version: MCP_SERVER_VERSION,
      },
    },
    {
      // Pathname for this route is /api/mcp → matches streamable HTTP endpoint
      basePath: "/api",
      disableSse: true,
      maxDuration: 60,
      verboseLogs: process.env.MCP_VERBOSE === "1",
    }
  );

  return withMcpAuth(mcp, verifyToken, {
    required: true,
    requiredScopes: ["crm"],
    resourceMetadataPath: "/.well-known/oauth-protected-resource",
  });
}

function bearerToken(req: Request): string | undefined {
  const [type, token] = req.headers.get("authorization")?.split(" ") ?? [];
  return type?.toLowerCase() === "bearer" ? token : undefined;
}

async function handle(req: Request): Promise<Response> {
  const accept = req.headers.get("accept") ?? "";
  if (req.method === "GET" && accept.includes("text/event-stream")) {
    const auth = await verifyToken(req, bearerToken(req));
    if (auth) return toolsChangedStream(req.signal);
  }
  return applyMcpCacheHeaders(await buildHandler(req)(req));
}

export { handle as GET, handle as POST, handle as DELETE };
