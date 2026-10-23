import { describe, expect, it, vi } from "vitest";
import type { CrmClient } from "./client";
import { handleTool } from "./dispatch";
import {
  MCP_MUTATING_TOOL_NAMES,
  MCP_READ_TOOL_NAMES,
  readOnlyMcpToolError,
} from "./read-only-tools";
import { CRM_TOOL_NAMES } from "./tool-names";

function client(readOnly: boolean) {
  const request = vi.fn(async () => ({ ok: true }));
  const crm = {
    request,
    context: {
      baseUrl: "https://crm.example.test",
      userId: "u1",
      workspaceId: "w1",
      workspaceRole: "admin" as const,
      readOnly,
    },
  };
  return { crm: crm as unknown as CrmClient, request };
}

describe("read-only MCP tools", () => {
  it("classifies every CRM tool exactly once", () => {
    const overlap = [...MCP_READ_TOOL_NAMES].filter((name) =>
      MCP_MUTATING_TOOL_NAMES.has(name)
    );
    expect(overlap).toEqual([]);
    const classified = new Set<string>([
      ...MCP_READ_TOOL_NAMES,
      ...MCP_MUTATING_TOOL_NAMES,
      "crm_api",
    ]);
    expect(CRM_TOOL_NAMES.filter((name) => !classified.has(name))).toEqual([]);
    expect(classified.size).toBe(CRM_TOOL_NAMES.length);
  });

  it("blocks mutating tools and non-safe crm_api methods for a read-only key", async () => {
    const { crm, request } = client(true);

    const created = await handleTool(crm, "crm_create_record", { slug: "deals" });
    expect(created.isError).toBe(true);
    expect(created.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("crm_create_record"),
    });

    const favorite = await handleTool(crm, "crm_set_project_favorite", { projectId: "p1" });
    expect(favorite.isError).toBe(true);

    const posted = await handleTool(crm, "crm_api", {
      path: "/api/v1/tasks",
      method: "POST",
    });
    expect(posted.isError).toBe(true);
    expect(posted.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("POST"),
    });
    expect(request).not.toHaveBeenCalled();

    const listed = await handleTool(crm, "crm_list_calendar_events", {});
    expect(listed.isError).toBeUndefined();

    const signature = await handleTool(crm, "crm_get_deal_signature", { recordId: "deal-1" });
    expect(signature.isError).toBeUndefined();
    const signedPdf = await handleTool(crm, "crm_get_deal_signed_document", { recordId: "deal-1" });
    expect(signedPdf.isError).toBeUndefined();
    const changes = await handleTool(crm, "crm_list_deal_change_requests", { recordId: "deal-1" });
    expect(changes.isError).toBeUndefined();

    const resolved = await handleTool(crm, "crm_resolve_deal_change_request", {
      recordId: "deal-1",
      requestId: "evt-1",
    });
    expect(resolved.isError).toBe(true);
    const createdOffer = await handleTool(crm, "crm_create_deal_date_offer", {
      recordId: "deal-1",
      date: "2026-11-01",
      slots: [{ label: "Vormittag" }],
    });
    expect(createdOffer.isError).toBe(true);
    expect(request).not.toHaveBeenCalledWith(
      "/api/v1/deals/deal-1/change-requests/evt-1",
      expect.anything()
    );
    const passthrough = await handleTool(crm, "crm_api", {
      path: "/api/v1/statistics/overview",
      method: "GET",
    });
    expect(passthrough.isError).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(5);
    expect(request).toHaveBeenCalledWith("/api/v1/deals/deal-1/signature");
    expect(request).toHaveBeenCalledWith(
      "/api/v1/deals/deal-1/signature/document",
      expect.anything()
    );
    expect(request).toHaveBeenCalledWith(
      "/api/v1/deals/deal-1/change-requests",
      expect.objectContaining({ query: { status: "all" } })
    );
  });

  it("does not block a full key", async () => {
    const { crm, request } = client(false);
    const created = await handleTool(crm, "crm_delete_record", {
      slug: "deals",
      recordId: "r1",
    });
    expect(created.isError).toBeUndefined();
    expect(request).toHaveBeenCalledWith(
      "/api/v1/objects/deals/records/r1",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(readOnlyMcpToolError("crm_query_records", {})).toEqual(
      expect.stringContaining("crm_query_records")
    );

    await handleTool(crm, "crm_create_deal_date_offer", {
      recordId: "deal-1",
      date: "2026-11-02",
      slots: [{ label: "Nachmittag" }],
    });
    expect(request).toHaveBeenCalledWith(
      "/api/v1/deals/deal-1/date-offers",
      expect.objectContaining({ method: "POST" })
    );
    await handleTool(crm, "crm_get_deal_signature", { status: "pending" });
    expect(request).toHaveBeenCalledWith("/api/v1/signature-requests", {
      query: { status: "pending" },
    });
  });
});
