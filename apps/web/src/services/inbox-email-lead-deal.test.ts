import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  limit: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: mock.limit }) }) }),
  },
}));
vi.mock("./inbox", () => ({ createDealForNewConversation: mock.create }));

import { ensureEmailLeadDeal } from "./inbox-email-lead-deal";

const conv = {
  id: "conv-direct",
  workspaceId: "workspace",
  channelAccountId: "mailbox",
  contactId: "contact",
  dealRecordId: null as string | null,
  lane: "lead",
  kontaktart: "lead_kunde",
  subject: "Umzug im Frühjahr",
  lastMessageAt: new Date("2026-11-01T09:00:00Z"),
};
const account = { id: "mailbox", channelType: "email", workspaceId: "workspace" };
const contact = { id: "contact", email: "maike.seiz@example.invalid", displayName: "Maike Seiz" };

beforeEach(() => {
  vi.resetAllMocks();
  mock.create.mockResolvedValue("deal-new");
});

describe("ensureEmailLeadDeal", () => {
  it("creates one deal and returns the existing one on the next call", async () => {
    mock.limit
      .mockResolvedValueOnce([conv])
      .mockResolvedValueOnce([account])
      .mockResolvedValueOnce([{ dealRecordId: null }])
      .mockResolvedValueOnce([contact])
      .mockResolvedValueOnce([]);

    const first = await ensureEmailLeadDeal("conv-direct", {
      text: "Hallo, wir möchten umziehen.",
      fromEmail: contact.email,
      sourceReceivedAt: conv.lastMessageAt,
    });
    expect(first).toBe("deal-new");
    expect(mock.create).toHaveBeenCalledTimes(1);
    expect(mock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-direct",
        dealName: "Maike Seiz",
        contactId: "contact",
        moveDate: null,
        sourceChannel: null,
      })
    );

    mock.limit.mockResolvedValueOnce([{ ...conv, dealRecordId: "deal-new" }]);
    const second = await ensureEmailLeadDeal("conv-direct");
    expect(second).toBe("deal-new");
    expect(mock.create).toHaveBeenCalledTimes(1);
  });

  it("passes a labeled move date and a website source, and skips a second create when the deal is already linked", async () => {
    mock.limit
      .mockResolvedValueOnce([{ ...conv, subject: "Neue Anfrage über die Website" }])
      .mockResolvedValueOnce([account])
      .mockResolvedValueOnce([{ dealRecordId: null }])
      .mockResolvedValueOnce([contact])
      .mockResolvedValueOnce([{ subject: "Neue Anfrage über die Website", body: "Umzugsdatum: 15.03.2026", fromAddress: contact.email, sentAt: conv.lastMessageAt }]);

    const dealId = await ensureEmailLeadDeal("conv-direct", {
      text: "Neue Anfrage über die Website\nUmzugsdatum: 15.03.2026",
      fromEmail: contact.email,
    });
    expect(dealId).toBe("deal-new");
    expect(mock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        dealName: "Maike Seiz — 15.03.2026",
        moveDate: "2026-03-15",
        sourceChannel: "Website-Formular",
      })
    );

    mock.limit.mockResolvedValueOnce([{ ...conv, dealRecordId: "deal-already" }]);
    expect(await ensureEmailLeadDeal("conv-direct")).toBe("deal-already");
    expect(mock.create).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a non-lead lane, a WhatsApp channel, or a missing conversation", async () => {
    mock.limit.mockResolvedValueOnce([{ ...conv, lane: "info" }]);
    expect(await ensureEmailLeadDeal("conv-direct")).toBeNull();

    mock.limit.mockResolvedValueOnce([conv]).mockResolvedValueOnce([{ ...account, channelType: "whatsapp" }]);
    expect(await ensureEmailLeadDeal("conv-direct")).toBeNull();

    mock.limit.mockResolvedValueOnce([]);
    expect(await ensureEmailLeadDeal("missing")).toBeNull();
    expect(mock.create).not.toHaveBeenCalled();
  });
});
