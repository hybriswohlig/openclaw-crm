import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  ingest: vi.fn(),
  verarbeite: vi.fn(),
  findeInterne: vi.fn(),
  ladeInterneNummern: vi.fn(),
  limit: vi.fn(),
  after: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (fn: () => unknown) => mocks.after(fn) };
});

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/inbox-whatsapp", () => ({
  ingestInboundWhatsAppMessage: mocks.ingest,
}));

vi.mock("@/services/intern/interne-nummern", () => ({
  findeInterne: mocks.findeInterne,
  ladeInterneNummern: mocks.ladeInterneNummern,
}));

vi.mock("@/services/intern/freigabe", () => ({
  verarbeiteInterneNachricht: mocks.verarbeite,
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
    insert: () => ({
      values: vi.fn(),
    }),
  },
}));

import { POST } from "./route";

const WORKSPACE = "ws-kottke";
const KOTTKE = "82027c02-f0da-49db-923a-12a1d0f9a552";
const CEYLAN = "595a5e23-69c6-4f28-9254-307521ad1e74";

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
    new NextRequest("https://crm.test/api/v1/inbox/whatsapp/baileys-inbound", {
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
  body: "Sind Sie noch da?",
  externalMessageId: "wamid.GAP",
  sentAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  historySync: true,
};

beforeEach(() => {
  vi.clearAllMocks();
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
    dealRecordId: "deal-1",
    messageId: "msg-1",
    isNewConversation: false,
    duplicate: false,
  });
});

describe("POST /baileys-inbound historySync", () => {
  it("stores the row as history and does not run approval commands", async () => {
    const res = await call(history);
    expect(res.status).toBe(200);
    expect(mocks.ingest).toHaveBeenCalledTimes(1);
    expect(mocks.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        historySync: true,
        externalMessageId: "wamid.GAP",
        peerWaId: "491511112233",
        rawHeaders: expect.objectContaining({ source: "history-sync", historySync: true }),
      }),
    );
    const passed = mocks.ingest.mock.calls[0][0] as { account: { id: string } };
    expect(passed.account.id).toBe(KOTTKE);
    expect(mocks.verarbeite).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("drops an internal number without storing it or executing the command", async () => {
    mocks.findeInterne.mockReturnValue({ name: "Dario", phone: "491700000000" });
    const res = await call({ ...history, body: "ok ABCD" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ intern: true, stored: false, executed: false });
    expect(mocks.ingest).not.toHaveBeenCalled();
    expect(mocks.verarbeite).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("skips groups and messages outside the window", async () => {
    const group = await call({
      ...history,
      peerJid: "120363000@g.us",
      peerWaId: "120363000",
    });
    expect(await group.json()).toMatchObject({ skipped: true, reason: "group_or_status" });

    const old = await call({
      ...history,
      externalMessageId: "wamid.OLD",
      sentAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(await old.json()).toMatchObject({ skipped: true, reason: "outside_window" });
    expect(mocks.ingest).not.toHaveBeenCalled();
  });

  it("does not touch an excluded account", async () => {
    const res = await call({ ...history, accountId: CEYLAN });
    expect(await res.json()).toMatchObject({ skipped: true, reason: "excluded" });
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(mocks.ingest).not.toHaveBeenCalled();
  });
});
