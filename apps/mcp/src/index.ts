#!/usr/bin/env node
/**
 * OpenClaw / Kottke CRM MCP Server
 *
 * Exposes the CRM REST API (/api/v1) as MCP tools for Claude Code & Claude Desktop.
 *
 * Auth (any one):
 *   - CRM_API_KEY=oc_sk_...          (recommended for permanent config)
 *   - CRM_EMAIL + CRM_PASSWORD       (auto login via better-auth)
 *   - crm_login tool at runtime      (interactive session)
 *
 * Required:
 *   - CRM_BASE_URL=https://your-crm.example.com
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { loadConfig } from "./lib/config.js";
import { AuthStore } from "./lib/auth-store.js";
import { CrmClient } from "./lib/client.js";
import { TOOLS } from "./tools/definitions.js";
import { handleTool } from "./tools/handlers.js";

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    // MCP hosts read stderr for diagnostics; stdout is reserved for protocol.
    console.error(`[openclaw-crm-mcp] ${(err as Error).message}`);
    process.exit(1);
  }

  const auth = new AuthStore(config.sessionFile);
  const client = new CrmClient(config, auth);

  const server = new Server(
    {
      name: "openclaw-crm",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    return handleTool(client, name, args);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(
    `[openclaw-crm-mcp] ready · ${config.baseUrl} · auth=${client.authMode()} · ${TOOLS.length} tools`
  );
}

main().catch((err) => {
  console.error("[openclaw-crm-mcp] fatal:", err);
  process.exit(1);
});
