import { describe, expect, it } from "vitest";
import {
  matchEmailThread,
  normalizeEmailSubject,
  parseMovingDate,
  pickInheritedDeal,
  pickSentMailbox,
  type ThreadConversationRef,
  type ThreadMessageRef,
} from "./inbox-email-intake";

const channel = "kottke";
const contact = "maike";
const sentAt = new Date("2026-11-01T09:00:00Z");

function conv(overrides: Partial<ThreadConversationRef> = {}): ThreadConversationRef {
  return {
    id: "cb256c50",
    channelAccountId: channel,
    contactId: contact,
    externalThreadId: "<first@example.invalid>",
    subject: "Anfrage Umzug",
    status: "open",
    lastMessageAt: new Date("2026-10-20T09:00:00Z"),
    createdAt: new Date("2026-10-15T09:00:00Z"),
    ...overrides,
  };
}

function message(overrides: Partial<ThreadMessageRef> = {}): ThreadMessageRef {
  return {
    externalMessageId: "<VPNUJPB8PUU4.48X8FG1AFS5C1@f1c2-rest001>",
    conversationId: "cb256c50",
    channelAccountId: channel,
    ...overrides,
  };
}

describe("matchEmailThread", () => {
  it("matches a References id against a stored Message-ID", () => {
    const hit = matchEmailThread({
      channelAccountId: channel,
      contactId: contact,
      sentAt,
      subject: "Re: etwas anderes",
      inReplyTo: "<CANWZ5unrelated@mail.gmail.com>",
      references: "<VPNUJPB8PUU4.48X8FG1AFS5C1@f1c2-rest001> <CANWZ5unrelated@mail.gmail.com>",
      messages: [message()],
      conversations: [conv()],
    });
    expect(hit).toEqual({ conversationId: "cb256c50", via: "references" });
  });

  it("matches In-Reply-To against a stored thread id, brackets and case aside", () => {
    const hit = matchEmailThread({
      channelAccountId: channel,
      contactId: contact,
      sentAt,
      subject: "AW: Anfrage Umzug",
      inReplyTo: "FIRST@example.invalid",
      references: "<other@example.invalid>",
      messages: [],
      conversations: [conv({ externalThreadId: "<first@example.invalid>" })],
    });
    expect(hit).toEqual({ conversationId: "cb256c50", via: "in-reply-to" });
  });

  it("prefers In-Reply-To over a References hit on another conversation", () => {
    const hit = matchEmailThread({
      channelAccountId: channel,
      contactId: contact,
      sentAt,
      subject: "Re: Anfrage Umzug",
      inReplyTo: "<reply-target@example.invalid>",
      references: "<VPNUJPB8PUU4.48X8FG1AFS5C1@f1c2-rest001>",
      messages: [
        message({ conversationId: "older", externalMessageId: "<VPNUJPB8PUU4.48X8FG1AFS5C1@f1c2-rest001>" }),
        message({ conversationId: "newer", externalMessageId: "<reply-target@example.invalid>" }),
      ],
      conversations: [
        conv({ id: "older", createdAt: new Date("2026-10-01T00:00:00Z") }),
        conv({ id: "newer", createdAt: new Date("2026-10-20T00:00:00Z"), externalThreadId: "<other@example.invalid>" }),
      ],
    });
    expect(hit).toEqual({ conversationId: "newer", via: "in-reply-to" });
  });

  it("falls back to the same contact and normalized subject inside 30 days", () => {
    const hit = matchEmailThread({
      channelAccountId: channel,
      contactId: contact,
      sentAt,
      subject: "WG: Re: Anfrage Umzug",
      messages: [],
      conversations: [conv({ subject: "AW: Anfrage Umzug" })],
    });
    expect(hit).toEqual({ conversationId: "cb256c50", via: "subject" });
    expect(normalizeEmailSubject("Re[2]: AW: Fwd: Anfrage Umzug")).toBe("anfrage umzug");
  });

  it("does not merge a matching subject across different contacts", () => {
    const hit = matchEmailThread({
      channelAccountId: channel,
      contactId: "stefanie",
      sentAt,
      subject: "Anfrage Umzug",
      messages: [],
      conversations: [conv({ contactId: contact })],
    });
    expect(hit).toBeNull();
  });

  it("does not use a closed thread or a thread outside the window for the subject fallback", () => {
    const closed = matchEmailThread({
      channelAccountId: channel,
      contactId: contact,
      sentAt,
      subject: "Anfrage Umzug",
      messages: [],
      conversations: [conv({ status: "resolved" })],
    });
    const stale = matchEmailThread({
      channelAccountId: channel,
      contactId: contact,
      sentAt,
      subject: "Anfrage Umzug",
      messages: [],
      conversations: [conv({ lastMessageAt: new Date("2026-08-01T00:00:00Z") })],
    });
    expect(closed).toBeNull();
    expect(stale).toBeNull();
  });

  it("ignores a header id that belongs to another channel", () => {
    const hit = matchEmailThread({
      channelAccountId: channel,
      contactId: contact,
      sentAt,
      subject: "Anfrage Umzug",
      inReplyTo: "<VPNUJPB8PUU4.48X8FG1AFS5C1@f1c2-rest001>",
      messages: [message({ channelAccountId: "other" })],
      conversations: [conv({ channelAccountId: "other" })],
    });
    expect(hit).toBeNull();
  });
});

describe("pickInheritedDeal", () => {
  it("takes the deal on the most recently active open conversation", () => {
    expect(
      pickInheritedDeal([
        { dealRecordId: "old", status: "open", lastMessageAt: new Date("2026-10-01T00:00:00Z") },
        { dealRecordId: "new", status: "open", lastMessageAt: new Date("2026-10-20T00:00:00Z") },
        { dealRecordId: "closed", status: "resolved", lastMessageAt: new Date("2026-11-01T00:00:00Z") },
      ])
    ).toBe("new");
  });
});

describe("pickSentMailbox", () => {
  it("prefers the IMAP \\Sent special-use flag", () => {
    expect(
      pickSentMailbox([
        { path: "INBOX", specialUse: null },
        { path: "[Gmail]/Gesendet", specialUse: "\\Sent" },
      ])
    ).toBe("[Gmail]/Gesendet");
  });

  it("falls back to a Sent or Gesendet path", () => {
    expect(pickSentMailbox([{ path: "[Gmail]/Sent Mail" }])).toBe("[Gmail]/Sent Mail");
    expect(pickSentMailbox([{ path: "Gesendet" }])).toBe("Gesendet");
    expect(pickSentMailbox([{ path: "INBOX" }])).toBeNull();
  });
});

describe("parseMovingDate", () => {
  it("reads a labeled move date and ignores a bare date", () => {
    expect(parseMovingDate("Hallo, Umzugsdatum: 15.03.2026, danke")).toBe("2026-03-15");
    expect(parseMovingDate("Wunschtermin 15. März 2026")).toBe("2026-03-15");
    expect(parseMovingDate("Ich schreibe am 15.03.2026 nochmal")).toBeNull();
    expect(parseMovingDate("Umzugstermin: 31.02.2026")).toBeNull();
  });
});
