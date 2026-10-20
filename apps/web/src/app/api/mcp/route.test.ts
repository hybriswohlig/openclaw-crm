import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));
const registration = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@/lib/api-utils", () => ({
  getAuthContext: auth.getAuthContext,
}));

vi.mock("@/lib/mcp/register-tools", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mcp/register-tools")>(
    "@/lib/mcp/register-tools"
  );
  return {
    registerCrmTools: (
      ...args: Parameters<typeof actual.registerCrmTools>
    ) => {
      registration.calls += 1;
      return actual.registerCrmTools(...args);
    },
  };
});

import { GET, POST } from "./route";
import { MCP_SERVER_VERSION } from "@/lib/mcp/server-info";

const AUTH_CTX = {
  userId: "user-1",
  workspaceId: "ws-1",
  workspaceRole: "admin" as const,
  permissions: {},
  authMethod: "api_key" as const,
  apiKeyAccess: "full" as const,
};

function rpc(method: string, id: number, params?: Record<string, unknown>): Request {
  return new Request("https://darioushkottke.online/api/mcp", {
    method: "POST",
    headers: {
      authorization: "Bearer oc_sk_test",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}

async function readRpc(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  const dataLine = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("data:"));
  const raw = dataLine ? dataLine.slice(dataLine.indexOf(":") + 1).trim() : text;
  return JSON.parse(raw) as Record<string, unknown>;
}

beforeEach(() => {
  registration.calls = 0;
  auth.getAuthContext.mockResolvedValue(AUTH_CTX);
});

describe("MCP tools/list freshness", () => {
  it("advertises the same server version on HTTP and stdio", () => {
    const web = readFileSync(new URL("../../../lib/mcp/server-info.ts", import.meta.url), "utf8");
    const stdio = readFileSync(
      new URL("../../../../../mcp/src/server-info.ts", import.meta.url),
      "utf8"
    );
    expect(web).toContain(`export const MCP_SERVER_VERSION = "${MCP_SERVER_VERSION}"`);
    expect(stdio).toContain(`export const MCP_SERVER_VERSION = "${MCP_SERVER_VERSION}"`);
    expect(MCP_SERVER_VERSION).not.toBe("0.1.0");
  });

  it("registers tools on every POST and returns Kontaktart schemas", async () => {
    const init = await POST(
      rpc("initialize", 1, {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      })
    );
    expect(init.headers.get("cache-control")).toContain("no-store");
    expect(init.headers.get("x-mcp-server-version")).toBe(MCP_SERVER_VERSION);
    const initBody = await readRpc(init);
    expect(initBody).toMatchObject({
      result: { serverInfo: { name: "openclaw-crm", version: MCP_SERVER_VERSION } },
    });

    const listed = await POST(rpc("tools/list", 2));
    expect(listed.headers.get("cache-control")).toContain("no-store");
    const body = await readRpc(listed);
    const tools = (body.result as { tools: Array<{ name: string; inputSchema: { properties?: Record<string, { enum?: string[] }>; required?: string[] } }> }).tools;
    const update = tools.find((tool) => tool.name === "crm_update_conversation_status");
    const list = tools.find((tool) => tool.name === "crm_list_conversations");

    expect(update?.inputSchema.properties).toMatchObject({
      kontaktart: { enum: expect.arrayContaining(["bewerber", "lead_kunde"]) },
      lane: { enum: expect.arrayContaining(["kein_lead"]) },
    });
    expect(update?.inputSchema.required).toEqual(["conversationId"]);
    expect(list?.inputSchema.properties?.lane?.enum).toEqual(
      expect.arrayContaining(["kein_lead"])
    );
    expect(list?.inputSchema.properties?.kontaktart?.enum).toEqual(
      expect.arrayContaining(["bewerber"])
    );
    // A module-level createMcpHandler() would register once and reuse that server.
    expect(registration.calls).toBe(2);
  });

  it("tells a connected client to refetch tools/list", async () => {
    const req = new Request("https://darioushkottke.online/api/mcp", {
      method: "GET",
      headers: {
        authorization: "Bearer oc_sk_test",
        accept: "text/event-stream",
      },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-mcp-server-version")).toBe(MCP_SERVER_VERSION);
    const reader = res.body?.getReader();
    expect(reader).toBeTruthy();
    const { value } = await reader!.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("notifications/tools/list_changed");
    await reader!.cancel();
  });

  it("does not store an unauthenticated response", async () => {
    auth.getAuthContext.mockResolvedValue(null);
    const res = await POST(rpc("tools/list", 1));
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-mcp-server-version")).toBe(MCP_SERVER_VERSION);
    expect(registration.calls).toBe(0);
  });
});
