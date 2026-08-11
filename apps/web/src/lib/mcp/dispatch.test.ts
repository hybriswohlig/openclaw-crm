import { describe, it, expect, vi } from "vitest";
import { handleTool } from "./dispatch";
import type { CrmClient } from "./client";

/** Minimal CrmClient stand-in that records what dispatch forwarded. */
function fakeClient() {
  const calls: Array<{ path: string; options: Record<string, unknown> }> = [];
  const client = {
    request: vi.fn(async (path: string, options: Record<string, unknown> = {}) => {
      calls.push({ path, options });
      return { ok: true };
    }),
    context: {
      baseUrl: "https://crm.example.test",
      userId: "u1",
      workspaceId: "w1",
      workspaceRole: "admin" as const,
    },
  };
  return { client: client as unknown as CrmClient, calls };
}

describe("crm_api body coercion", () => {
  it("parses a body that arrived as a JSON string", async () => {
    // z.unknown() serializes to an empty JSON Schema, so MCP clients have
    // nothing to validate against and send the body as a JSON string. Passing
    // it through verbatim made req.json() yield a string, so every field read
    // off it was undefined ("skill is required" on a well-formed call).
    const { client, calls } = fakeClient();

    await handleTool(client, "crm_api", {
      path: "/api/tools/run",
      method: "POST",
      body: '{"skill":"echo-test","params":{"a":1}}',
    });

    expect(calls[0].options.body).toEqual({
      skill: "echo-test",
      params: { a: 1 },
    });
  });

  it("passes an object body through untouched", async () => {
    const { client, calls } = fakeClient();

    await handleTool(client, "crm_api", {
      path: "/api/tools/run",
      method: "POST",
      body: { skill: "echo-test" },
    });

    expect(calls[0].options.body).toEqual({ skill: "echo-test" });
  });

  it("leaves a genuine string body alone", async () => {
    const { client, calls } = fakeClient();

    await handleTool(client, "crm_api", {
      path: "/api/v1/thing",
      method: "POST",
      body: "plain text, not JSON",
    });

    expect(calls[0].options.body).toBe("plain text, not JSON");
  });

  it("leaves malformed JSON alone rather than throwing", async () => {
    const { client, calls } = fakeClient();

    await handleTool(client, "crm_api", {
      path: "/api/v1/thing",
      method: "POST",
      body: '{"unterminated": ',
    });

    expect(calls[0].options.body).toBe('{"unterminated": ');
  });

  it("rejects paths outside /api/", async () => {
    const { client } = fakeClient();

    const res = await handleTool(client, "crm_api", { path: "/etc/passwd" });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("path must start with /api/");
  });
});

describe("crm_generate_document", () => {
  it("accepts stringified params and injects the deal id", async () => {
    const { client, calls } = fakeClient();

    await handleTool(client, "crm_generate_document", {
      recordId: "deal-1",
      params: '{"firma":"kottke","document_type":"AB"}',
    });

    expect(calls[0].path).toBe("/api/tools/run");
    expect(calls[0].options.body).toEqual({
      skill: "rechnungen-und-auftragsbestaetigungen",
      params: {
        firma: "kottke",
        document_type: "AB",
        _deal_record_id: "deal-1",
      },
    });
  });
});
