import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Pipeline stages and select options are part of the data schema. Deleting a
// stage orphans every deal in it, renaming one breaks code that matches stages
// by title. The settings UI is admin-only; the API must be too.
const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  deleteStatus: vi.fn(),
  deleteSelectOption: vi.fn(),
  createStatus: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/attributes", () => ({
  getAttributeById: vi.fn(async () => ({ id: "attr", type: "status" })),
  listSelectOptions: vi.fn(),
  createSelectOption: vi.fn(),
  updateSelectOption: vi.fn(),
  deleteSelectOption: mocks.deleteSelectOption,
  listStatuses: vi.fn(),
  createStatus: mocks.createStatus,
  updateStatus: vi.fn(),
  deleteStatus: mocks.deleteStatus,
}));

import { DELETE, POST } from "./route";

const ctx = (role: "admin" | "member") => ({ userId: "u", workspaceId: "ws", workspaceRole: role, permissions: {} });
const del = () =>
  new NextRequest("http://localhost/api/v1/objects/deals/attributes/options?optionId=stage1&attributeType=status", {
    method: "DELETE",
  });

describe("/api/v1/objects/[slug]/attributes/options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteStatus.mockResolvedValue({ id: "stage1" });
  });

  it("a member cannot delete a pipeline stage", async () => {
    mocks.getAuthContext.mockResolvedValue(ctx("member"));
    const res = await DELETE(del());
    expect(res.status).toBe(403);
    expect(mocks.deleteStatus).not.toHaveBeenCalled();
  });

  it("a member cannot add a pipeline stage", async () => {
    mocks.getAuthContext.mockResolvedValue(ctx("member"));
    const res = await POST(
      new NextRequest("http://localhost/api/v1/objects/deals/attributes/options", {
        method: "POST",
        body: JSON.stringify({ attributeId: "attr", title: "Neu" }),
      })
    );
    expect(res.status).toBe(403);
    expect(mocks.createStatus).not.toHaveBeenCalled();
  });

  it("an admin can still delete a pipeline stage", async () => {
    mocks.getAuthContext.mockResolvedValue(ctx("admin"));
    const res = await DELETE(del());
    expect(res.status).toBe(200);
    expect(mocks.deleteStatus).toHaveBeenCalledWith("stage1");
  });
});
