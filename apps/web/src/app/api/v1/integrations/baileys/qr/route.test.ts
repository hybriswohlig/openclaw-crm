import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The live pairing QR / pairing code links a WhatsApp account to the CRM's
// channel. Starting and stopping pairing already require channel management;
// reading the QR must too, or any member could scan it with their own phone.
const mocks = vi.hoisted(() => ({ getAuthContext: vi.fn() }));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [{ id: "acc", qrPayload: "2@QRDATA", pairingCode: "ABCD-1234" }] }),
      }),
    }),
  },
}));

import { GET } from "./route";

const req = () => new NextRequest("http://localhost/api/v1/integrations/baileys/qr?accountId=acc");

describe("GET /api/v1/integrations/baileys/qr", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not show the QR to a member without channel management", async () => {
    mocks.getAuthContext.mockResolvedValue({
      userId: "usr_2",
      workspaceId: "ws",
      workspaceRole: "member",
      permissions: {},
      authMethod: "cookie",
    });
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain("QRDATA");
  });

  it("shows the QR to a member allowed to manage channels", async () => {
    mocks.getAuthContext.mockResolvedValue({
      userId: "usr_3",
      workspaceId: "ws",
      workspaceRole: "member",
      permissions: { manageChannels: true },
      authMethod: "cookie",
    });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).qrPayload).toBe("2@QRDATA");
  });
});
