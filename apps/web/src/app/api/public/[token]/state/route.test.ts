import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// A revoked or expired status link (or a firma that switched the portal off)
// must not keep serving the customer's name, addresses, inventory and prices
// through the JSON endpoint the page polls. loadContextByToken itself still
// returns the full context because internal mail/withdrawal code needs it.
const mocks = vi.hoisted(() => ({
  loadContextByToken: vi.fn(),
  bumpView: vi.fn(),
}));

vi.mock("@/services/customer-portal-data", () => ({
  loadContextByToken: mocks.loadContextByToken,
  bumpView: mocks.bumpView,
}));

import { GET } from "./route";

const TOKEN = "tok_abc";

function ctxWith(meta: { revoked: boolean; featureDisabled: boolean }) {
  return { customerDisplayName: "Max Mustermann", meta: { ...meta, serverTime: "", canonicalHost: null } };
}

async function call() {
  const res = await GET(new NextRequest(`http://localhost/api/public/${TOKEN}/state`), {
    params: Promise.resolve({ token: TOKEN }),
  });
  return { status: res.status, body: await res.json() };
}

describe("GET /api/public/[token]/state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bumpView.mockResolvedValue(undefined);
  });

  it("returns 410 without data for a revoked link", async () => {
    mocks.loadContextByToken.mockResolvedValue(ctxWith({ revoked: true, featureDisabled: false }));
    const { status, body } = await call();
    expect(status).toBe(410);
    expect(body).toEqual({ error: { code: "REVOKED" } });
    expect(mocks.bumpView).not.toHaveBeenCalled();
  });

  it("returns 410 without data when the portal is switched off", async () => {
    mocks.loadContextByToken.mockResolvedValue(ctxWith({ revoked: false, featureDisabled: true }));
    const { status, body } = await call();
    expect(status).toBe(410);
    expect(body).toEqual({ error: { code: "DISABLED" } });
  });

  it("returns the context for a usable link", async () => {
    const ctx = ctxWith({ revoked: false, featureDisabled: false });
    mocks.loadContextByToken.mockResolvedValue(ctx);
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.data).toEqual(ctx);
    expect(mocks.bumpView).toHaveBeenCalledWith(TOKEN);
  });

  it("returns 404 for an unknown token", async () => {
    mocks.loadContextByToken.mockResolvedValue(null);
    const { status } = await call();
    expect(status).toBe(404);
  });
});
