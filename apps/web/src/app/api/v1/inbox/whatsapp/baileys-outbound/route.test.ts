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
    insert: () => ({ values: vi.fn() }),
  },
}));

import { POST } from "./route";

const WORKSPACE = "ws-kottke";
const KOTTKE = "82027c02-f0da-49db-923a-12a1d0f9a552";
const CEYLAN = "61cd807b-72c6-4fb7-af83-ef7145e93386";

const account = {
  id: KOTTKE,
  workspaceId: WORKSPACE,
  channelType: "whatsapp",
  isActive: true,
  waPhoneNumberId: null,
  address: "4915159058963",
};

function call(body: unknown) {
  return POST(
    new NextRequest("https://crm.test/api/v1/inbox/whatsapp/baileys-outbound", {
      method: "POST",
      headers: { authorization: "Bearer oc_sk_test" },
      body: JSON.stringify(body),
    }),
  );
}

const history = {
  accountId: KOTTKE,
  peerWaId: "491511112233",
  peerJid: "491511112233@s.whatsapp.net",
  body: "Komme um 10",
  externalMessageId: "wamid.OUT",
  sentAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  historySync: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  delete process.env.BAILEYS_HISTORY_SYNC_DAYS;
  mocks.getAuthContext.mockResolvedValue({
    userId: "usr_1",
    workspaceId: WORKSPACE,
    workspaceRole: "admin",
    permissions: {},
    authMethod: "api_key",
    apiKeyAccess: "full",
  });
  mocks.ladeInterneNummern.mockResolvedValue([]);
  mocks.findeInterne.mockReturnValue(null);
  mocks.limit.mockResolvedValue([account]);
  mocks.ingest.mockResolvedValue({
    conversationId: "conv-1",
    dealRecordId: null,
    messageId: "msg-1",
    isNewConversation: false,
    duplicate: false,
  });
});

describe("POST /baileys-outbound historySync", () => {
  it("records history with the history-sync origin and never sends", async () => {
    const res = await call(history);
    expect(res.status).toBe(200);
    expect(mocks.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: "history-sync",
        externalMessageId: "wamid.OUT",
        rawHeaders: expect.objectContaining({ source: "history-sync", historySync: true }),
      }),
    );
    const passed = mocks.ingest.mock.calls[0][0] as { account: { id: string } };
    expect(passed.account.id).toBe(KOTTKE);
    expect(passed.account.id).not.toBe(CEYLAN);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not store an internal number", async () => {
    mocks.findeInterne.mockReturnValue({ name: "Dario" });
    const res = await call(history);
    expect(await res.json()).toMatchObject({ intern: true, stored: false, sent: false });
    expect(mocks.ingest).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("does not read an excluded account", async () => {
    const res = await call({ ...history, accountId: CEYLAN });
    expect(await res.json()).toMatchObject({ skipped: true, reason: "excluded", sent: false });
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(mocks.ingest).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still rejects a bare backfill origin", async () => {
    const res = await call({ ...history, historySync: false, origin: "backfill" });
    expect(res.status).toBe(400);
    expect(mocks.ingest).not.toHaveBeenCalled();
  });
});
