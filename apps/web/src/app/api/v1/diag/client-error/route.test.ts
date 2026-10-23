import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The client-error sink wrote every POST into the auth `verifications` table,
// without login and without limit. Only signed-in users may report errors.
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  values: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/db", () => ({ db: { insert: () => ({ values: mocks.values }) } }));

import { POST } from "./route";

function report() {
  return POST(
    new NextRequest("https://crm.test/api/v1/diag/client-error", {
      method: "POST",
      body: JSON.stringify({ message: "boom", stack: "at x", url: "https://crm.test/inbox" }),
    })
  );
}

describe("POST /api/v1/diag/client-error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.values.mockResolvedValue(undefined);
  });

  it("stores nothing without a session", async () => {
    mocks.getSession.mockResolvedValue(null);
    const res = await report();
    expect(res.status).toBe(204);
    expect(mocks.values).not.toHaveBeenCalled();
  });

  it("stores the report for a signed-in user", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "usr_1" }, session: { id: "s1" } });
    const res = await report();
    expect(res.status).toBe(204);
    expect(mocks.values).toHaveBeenCalledTimes(1);
    expect(mocks.values.mock.calls[0][0].value).toContain("boom");
  });
});
