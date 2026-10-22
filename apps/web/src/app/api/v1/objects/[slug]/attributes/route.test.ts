import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Deleting a custom field cascades away every stored value of it. Only admins
// may change the data schema (the settings UI is admin-only already).
const mocks = vi.hoisted(() => ({ getAuthContext: vi.fn(), deleteAttribute: vi.fn() }));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/objects", () => ({ getObjectBySlug: vi.fn(async () => ({ id: "obj" })) }));

vi.mock("@/services/attributes", () => ({
  listAttributes: vi.fn(),
  createAttribute: vi.fn(),
  updateAttribute: vi.fn(),
  deleteAttribute: mocks.deleteAttribute,
  createSelectOption: vi.fn(),
  updateSelectOption: vi.fn(),
  deleteSelectOption: vi.fn(),
  createStatus: vi.fn(),
  updateStatus: vi.fn(),
  deleteStatus: vi.fn(),
}));

import { DELETE } from "./route";

const params = { params: Promise.resolve({ slug: "deals" }) };
const del = () =>
  new NextRequest("http://localhost/api/v1/objects/deals/attributes?attributeId=attr_custom", { method: "DELETE" });
const ctx = (role: "admin" | "member") => ({ userId: "u", workspaceId: "ws", workspaceRole: role, permissions: {} });

describe("DELETE /api/v1/objects/[slug]/attributes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteAttribute.mockResolvedValue({ id: "attr_custom" });
  });

  it("a member cannot delete a field", async () => {
    mocks.getAuthContext.mockResolvedValue(ctx("member"));
    const res = await DELETE(del(), params);
    expect(res.status).toBe(403);
    expect(mocks.deleteAttribute).not.toHaveBeenCalled();
  });

  it("an admin can still delete a field", async () => {
    mocks.getAuthContext.mockResolvedValue(ctx("admin"));
    const res = await DELETE(del(), params);
    expect(res.status).toBe(200);
    expect(mocks.deleteAttribute).toHaveBeenCalledWith("attr_custom");
  });
});
