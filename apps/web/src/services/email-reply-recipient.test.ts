import { describe, expect, it } from "vitest";
import {
  EMAIL_REPLY_NO_RECIPIENT,
  looksLikeMessageId,
  parseEmailAddress,
  resolveEmailReplyRecipient,
  resolveReplyThreading,
  type ReplyRecipientInput,
} from "./email-reply-recipient";

/** The bounced reply: Baris Kaya, 20.10.2026. To was the Message-ID. */
const BARIS = "xbariskaya@gmail.com";
const BARIS_MESSAGE_ID = "<CABcExampleId123@mail.gmail.com>";
const KOTTKE = "office@kottke.example";
const CEYLAN = "buero@ceylan.example";

function baris(overrides: Partial<ReplyRecipientInput> = {}): ReplyRecipientInput {
  return {
    ownAddress: KOTTKE,
    contactEmail: BARIS,
    externalThreadId: BARIS_MESSAGE_ID,
    lastInbound: {
      fromAddress: BARIS,
      externalMessageId: BARIS_MESSAGE_ID,
      rawHeaders: JSON.stringify({
        from: "Baris Kaya <xbariskaya@gmail.com>",
        "message-id": BARIS_MESSAGE_ID,
        references: `<earlier@mail.gmail.com> ${BARIS_MESSAGE_ID}`,
      }),
    },
    lastOutboundTo: null,
    ...overrides,
  };
}

describe("parseEmailAddress", () => {
  it("reads Name <addr> and a mailparser address object", () => {
    expect(parseEmailAddress("Baris Kaya <xbariskaya@gmail.com>")).toBe(BARIS);
    expect(parseEmailAddress("Kaya, Baris <xbariskaya@gmail.com>")).toBe(BARIS);
    expect(
      parseEmailAddress({
        value: [{ address: "XBarisKaya@gmail.com", name: "Baris Kaya" }],
        text: "Baris Kaya <xbariskaya@gmail.com>",
      })
    ).toBe(BARIS);
  });

  it("rejects a Message-ID, including the Gmail host without brackets", () => {
    expect(parseEmailAddress(BARIS_MESSAGE_ID)).toBeNull();
    expect(parseEmailAddress("CABcExampleId123@mail.gmail.com")).toBeNull();
    expect(parseEmailAddress("<CABcExampleId123@mail.gmail.com>")).toBeNull();
    expect(looksLikeMessageId(BARIS_MESSAGE_ID)).toBe(true);
    expect(looksLikeMessageId("uid-42@office.kottke.example")).toBe(true);
    expect(looksLikeMessageId(BARIS)).toBe(false);
  });

  it("rejects address lists", () => {
    expect(parseEmailAddress("a@example.com, b@example.com")).toBeNull();
    expect(
      parseEmailAddress({
        value: [
          { address: "a@example.com", name: "" },
          { address: "b@example.com", name: "" },
        ],
      })
    ).toBeNull();
  });
});

describe("resolveEmailReplyRecipient", () => {
  it("sends the Baris Kaya reply to the customer, not the Message-ID", () => {
    expect(resolveEmailReplyRecipient(baris())).toEqual({ address: BARIS, source: "from" });
  });

  it("prefers Reply-To over From when the header is the customer", () => {
    const resolved = resolveEmailReplyRecipient(
      baris({
        lastInbound: {
          fromAddress: "list@lists.example",
          externalMessageId: BARIS_MESSAGE_ID,
          rawHeaders: {
            "reply-to": "Baris Kaya <xbariskaya@gmail.com>",
            from: "Umzug Liste <list@lists.example>",
            "message-id": BARIS_MESSAGE_ID,
          },
        },
      })
    );
    expect(resolved).toEqual({ address: BARIS, source: "reply-to" });
  });

  it("ignores a From column that was stored as the Message-ID and uses the real From header", () => {
    const resolved = resolveEmailReplyRecipient(
      baris({
        lastInbound: {
          fromAddress: BARIS_MESSAGE_ID,
          externalMessageId: BARIS_MESSAGE_ID,
          rawHeaders: JSON.stringify({
            from: "Baris Kaya <xbariskaya@gmail.com>",
            "message-id": BARIS_MESSAGE_ID,
          }),
        },
      })
    );
    expect(resolved).toEqual({ address: BARIS, source: "from" });
  });

  it("falls back to the contact when every header value is the Message-ID", () => {
    const resolved = resolveEmailReplyRecipient(
      baris({
        lastInbound: {
          fromAddress: "CABcExampleId123@mail.gmail.com",
          externalMessageId: BARIS_MESSAGE_ID,
          rawHeaders: { "message-id": BARIS_MESSAGE_ID },
        },
      })
    );
    expect(resolved).toEqual({ address: BARIS, source: "contact" });
  });

  it("aborts when the only candidates are Message-IDs", () => {
    expect(
      resolveEmailReplyRecipient(
        baris({
          contactEmail: null,
          lastOutboundTo: BARIS_MESSAGE_ID,
          lastInbound: {
            fromAddress: BARIS_MESSAGE_ID,
            externalMessageId: BARIS_MESSAGE_ID,
            rawHeaders: { "message-id": BARIS_MESSAGE_ID, from: BARIS_MESSAGE_ID },
          },
        })
      )
    ).toBeNull();
    expect(EMAIL_REPLY_NO_RECIPIENT).toMatch(/Message-ID/);
    expect(EMAIL_REPLY_NO_RECIPIENT).toMatch(/abgebrochen/i);
  });

  it("never addresses our own mailbox, on Kottke or Ceylan", () => {
    expect(
      resolveEmailReplyRecipient(
        baris({
          ownAddress: KOTTKE,
          lastInbound: { fromAddress: KOTTKE, externalMessageId: BARIS_MESSAGE_ID },
        })
      )
    ).toEqual({ address: BARIS, source: "contact" });

    expect(
      resolveEmailReplyRecipient(
        baris({
          ownAddress: CEYLAN,
          contactEmail: "kunde@example.com",
          lastInbound: { fromAddress: CEYLAN, externalMessageId: "<id@ceylan.example>" },
        })
      )
    ).toEqual({ address: "kunde@example.com", source: "contact" });
  });

  it("keeps a Gmail-API thread (thread id has no @) on the customer address", () => {
    expect(
      resolveEmailReplyRecipient(baris({ externalThreadId: "18f3ab90c1d2e4f6" }))
    ).toEqual({ address: BARIS, source: "from" });
  });

  it("replies to a Kleinanzeigen relay, which is a real mailbox stored as the thread key", () => {
    const relay = "abc123-ek-ek@mail.kleinanzeigen.de";
    expect(
      resolveEmailReplyRecipient({
        ownAddress: KOTTKE,
        contactEmail: relay,
        externalThreadId: relay,
        lastInbound: {
          fromAddress: relay,
          externalMessageId: "<ka-msg@mail.kleinanzeigen.de>",
        },
      })
    ).toEqual({ address: relay, source: "from" });

    expect(
      resolveEmailReplyRecipient({
        ownAddress: KOTTKE,
        contactEmail: null,
        externalThreadId: relay,
        lastInbound: null,
      })
    ).toEqual({ address: relay, source: "thread-address" });
  });

  it("replies on a CRM-composed thread to the customer, not our own Message-ID", () => {
    const ownId = "<11111111-1111-1111-1111-111111111111@kottke.example>";
    expect(
      resolveEmailReplyRecipient({
        ownAddress: KOTTKE,
        contactEmail: BARIS,
        externalThreadId: ownId,
        lastInbound: null,
        lastOutboundTo: BARIS,
      })
    ).toEqual({ address: BARIS, source: "contact" });
  });

  it("does not mail an IS24 noreply sender when the contact is the customer", () => {
    expect(
      resolveEmailReplyRecipient({
        ownAddress: KOTTKE,
        contactEmail: BARIS,
        externalThreadId: "is24:123",
        lastInbound: {
          fromAddress: "noreply@immobilienscout24.de",
          externalMessageId: "<is24@immobilienscout24.de>",
        },
      })
    ).toEqual({ address: BARIS, source: "contact" });
  });

  it("aborts an IS24 lead whose only address is the synthetic contact key", () => {
    expect(
      resolveEmailReplyRecipient({
        ownAddress: KOTTKE,
        contactEmail: "is24-123@is24.lead",
        externalThreadId: "is24:123",
        lastInbound: { fromAddress: "noreply@immobilienscout24.de" },
      })
    ).toBeNull();
  });

  it("uses the last outbound recipient when we started the thread", () => {
    expect(
      resolveEmailReplyRecipient({
        ownAddress: CEYLAN,
        contactEmail: null,
        externalThreadId: "<own@ceylan.example>",
        lastInbound: null,
        lastOutboundTo: "Baris Kaya <xbariskaya@gmail.com>",
      })
    ).toEqual({ address: BARIS, source: "last-outbound" });
  });
});

describe("resolveReplyThreading", () => {
  it("puts the Message-ID in In-Reply-To and References, not in a recipient field", () => {
    expect(
      resolveReplyThreading({
        externalMessageId: BARIS_MESSAGE_ID,
        rawHeaders: JSON.stringify({
          references: `<earlier@mail.gmail.com> ${BARIS_MESSAGE_ID}`,
        }),
      })
    ).toEqual({
      inReplyTo: BARIS_MESSAGE_ID,
      references: ["<earlier@mail.gmail.com>", BARIS_MESSAGE_ID],
    });
  });

  it("does not treat a Gmail thread id as a Message-ID", () => {
    expect(resolveReplyThreading({ externalMessageId: "18f3ab90c1d2e4f6" })).toEqual({
      references: [],
    });
  });

  it("wraps a bare Message-ID so the header stays in angle brackets", () => {
    expect(
      resolveReplyThreading({ externalMessageId: "CABcExampleId123@mail.gmail.com" }).inReplyTo
    ).toBe(BARIS_MESSAGE_ID);
  });
});
