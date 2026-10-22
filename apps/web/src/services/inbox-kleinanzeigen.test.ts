import { describe, expect, it } from "vitest";
import { replyAddressForThread } from "./inbox-kleinanzeigen";

// The conversation's externalThreadId is the reply target only for
// Kleinanzeigen (the relay address IS the thread key). Every other thread
// key — Gmail thread ids, IMAP Message-IDs, our own Message-ID on threads
// composed in the CRM — must fall back to the contact's address. Message-IDs
// contain "@", so an "@" check sent replies to our own Message-ID.
const RELAY = `abc123-${"a".repeat(40)}-ek-ek@mail.kleinanzeigen.de`;

describe("replyAddressForThread", () => {
  it("replies to the Kleinanzeigen relay address", () => {
    expect(replyAddressForThread(RELAY, "x@y.de")).toBe(RELAY);
  });

  it("replies to the contact on a CRM-composed thread", () => {
    expect(
      replyAddressForThread("<0b1c2d3e-aaaa-bbbb-cccc-1234567890ab@kottke-umzuege.de>", "kunde@example.de")
    ).toBe("kunde@example.de");
  });

  it("replies to the contact on an IMAP Message-ID thread", () => {
    expect(replyAddressForThread("CAF123xyz@mail.gmail.com", "kunde@example.de")).toBe(
      "kunde@example.de"
    );
  });

  it("replies to the contact on a Gmail thread", () => {
    expect(replyAddressForThread("18c2f4a9b0e1d2c3", "kunde@example.de")).toBe("kunde@example.de");
  });

  it("returns empty when nothing is known", () => {
    expect(replyAddressForThread(null, null)).toBe("");
  });
});
