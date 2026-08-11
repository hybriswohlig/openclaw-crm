import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { NextRequest } from "next/server";
import { getAuthContext } from "@/lib/api-utils";
import { registerCrmTools } from "@/lib/mcp/register-tools";
import { resolveBaseUrl } from "@/lib/mcp/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
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
    },
  };
}

function buildHandler(req: Request) {
  const mcp = createMcpHandler(
    (server) => {
      registerCrmTools(server, req);
    },
    {
      serverInfo: {
        name: "openclaw-crm",
        version: "0.1.0",
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

async function handle(req: Request): Promise<Response> {
  return buildHandler(req)(req);
}

export { handle as GET, handle as POST, handle as DELETE };
