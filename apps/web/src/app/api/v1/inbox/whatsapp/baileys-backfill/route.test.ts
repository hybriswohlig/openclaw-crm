import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  ingest: vi.fn(),
  send: vi.fn(),
  findeInterne: vi.fn(),
  ladeInterneNummern: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/inbox-whatsapp", () => ({
  ingestOutboundWhatsAppMessage: mocks.ingest,
  sendBaileysReply: mocks.send,
  sendBaileysDirektText: mocks.send,
  sendBaileysFirstMessage: mocks.send,
  sendBaileysMediaReply: mocks.send,
}));

vi.mock("@/services/intern/interne-nummern", () => ({
  findeInterne: mocks.findeInterne,
  ladeInterneNummern: mocks.ladeInterneNummern,
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mocks.limit,
        }),
      }),
    }),
  },
}));

import { POST } from "./route";

const WORKSPACE = "ws-kottke";
const KOTTKE = "acc-kottke";
const CEYLAN = "acc-ceylan";

const kottkeAccount = {
  id: KOTTKE,
  workspaceId: WORKSPACE,
  channelType: "whatsapp",
  isActive: true,
  waPhoneNumberId: null,
  address: "491510000000",
};

function call(body: unknown) {
  return POST(
    new NextRequest("https://crm.test/api/v1/inbox/whatsapp/baileys-backfill", {
      method: "POST",
      headers: { authorization: "Bearer oc_sk_test" },
      body: JSON.stringify(body),
    }),
  );
}

const payload = {
  accountId: KOTTKE,
  peerJid: "491511112233@s.whatsapp.net",
  externalMessageId: "wamid.BRIDGE1",
  text: "Schon unterwegs",
  sentAt: "2026-10-01T09:30:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  mocks.getAuthContext.mockResolvedValue({
    userId: "usr_1",
    workspaceId: WORKSPACE,
    workspaceRole: "admin",
    permissions: {},
    authMethod: "api_key",
  });
  mocks.ladeInterneNummern.mockResolvedValue([]);
  mocks.findeInterne.mockReturnValue(null);
  mocks.limit.mockResolvedValue([kottkeAccount]);
  mocks.ingest.mockResolvedValue({
    conversationId: "conv-1",
    dealRecordId: "deal-1",
    messageId: "msg-1",
    isNewConversation: false,
    duplicate: false,
  });
});

describe("POST /baileys-backfill", () => {
  it("stores the row once as outbound history and never sends", async () => {
    const res = await call(payload);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      sent: false,
      conversationId: "conv-1",
      dealRecordId: "deal-1",
      messageId: "msg-1",
      duplicate: false,
    });

    expect(mocks.ingest).toHaveBeenCalledTimes(1);
    expect(mocks.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        account: kottkeAccount,
        peerWaId: "491511112233",
        peerJid: "491511112233@s.whatsapp.net",
        body: "Schon unterwegs",
        externalMessageId: "wamid.BRIDGE1",
        origin: "backfill",
      }),
    );
    const passed = mocks.ingest.mock.calls[0][0] as { account: { id: string }; sentAt: Date };
    expect(passed.account.id).toBe(KOTTKE);
    expect(passed.account.id).not.toBe(CEYLAN);
    expect(passed.sentAt.toISOString()).toBe("2026-10-01T09:30:00.000Z");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("is idempotent: the same external id is reported as a duplicate and still does not send", async () => {
    mocks.ingest
      .mockResolvedValueOnce({
        conversationId: "conv-1",
        dealRecordId: "deal-1",
        messageId: "msg-1",
        isNewConversation: false,
        duplicate: false,
      })
      .mockResolvedValueOnce({
        conversationId: "conv-1",
        dealRecordId: "deal-1",
        messageId: null,
        isNewConversation: false,
        duplicate: true,
      });

    const first = await call(payload);
    const second = await call(payload);

    expect((await first.json()).duplicate).toBe(false);
    expect(await second.json()).toMatchObject({
      success: true,
      sent: false,
      duplicate: true,
      messageId: null,
      conversationId: "conv-1",
    });
    expect(mocks.ingest).toHaveBeenCalledTimes(2);
    const ids = mocks.ingest.mock.calls.map(
      (callArgs) => (callArgs[0] as { externalMessageId: string; account: { id: string } }).externalMessageId,
    );
    expect(ids).toEqual(["wamid.BRIDGE1", "wamid.BRIDGE1"]);
    expect(mocks.ingest.mock.calls.every((c) => (c[0] as { account: { id: string } }).account.id === KOTTKE)).toBe(true);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not ingest when the row is a different channel account", async () => {
    mocks.limit.mockResolvedValue([{ ...kottkeAccount, id: CEYLAN }]);

    const res = await call(payload);
    expect(res.status).toBe(404);
    expect(mocks.ingest).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not ingest when that account is missing from this workspace", async () => {
    mocks.limit.mockResolvedValue([]);
    const res = await call({ ...payload, accountId: CEYLAN });
    expect(res.status).toBe(404);
    expect(mocks.ingest).not.toHaveBeenCalled();
  });

  it("has no send call in the handler source", () => {
    const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/callBridgeSend|sendBaileys|BAILEYS_BRIDGE|sendMessage|\/accounts\/|\bfetch\s*\(/);
    expect(code).toMatch(/origin:\s*"backfill"/);
    expect(code).toMatch(/sent:\s*false/);
  });
});
