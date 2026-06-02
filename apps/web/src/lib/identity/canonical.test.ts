import { describe, expect, it } from "vitest";
import {
  canonicalizePhone,
  canonicalizeEmail,
  isRelayEmail,
  classifyJid,
  extractPhonesFromText,
} from "./canonical";

// KOT-IDENTITY unit coverage for the canonicalization layer. The core promise:
// the same human reaching us via Kleinanzeigen (national "0151..."), WhatsApp
// (bare international wa_id "49151...") and SMS ("+49 151 ...") must produce ONE
// identical canonical phone key, so the deterministic D1 merge can fire.

describe("canonicalizePhone — German formats collapse to one E.164", () => {
  const E164 = "+4915159058963";

  it("national with trunk 0", () => {
    expect(canonicalizePhone("0151 5905 8963")).toBe(E164);
  });
  it("explicit international with +", () => {
    expect(canonicalizePhone("+49 151 5905 8963")).toBe(E164);
  });
  it("international with 00 prefix", () => {
    expect(canonicalizePhone("0049 151 59058963")).toBe(E164);
  });
  it("WhatsApp wa_id (bare international digits, no +)", () => {
    expect(canonicalizePhone("4915159058963")).toBe(E164);
  });
  it("messy punctuation", () => {
    expect(canonicalizePhone("(0151) 5905-8963")).toBe(E164);
  });

  it("THE dedup invariant: KA national == WhatsApp digits == SMS plus-form", () => {
    const ka = canonicalizePhone("0151 5905 8963"); // Kleinanzeigen Tel.-Zeile
    const wa = canonicalizePhone("4915159058963"); // WhatsApp wa_id
    const sms = canonicalizePhone("+4915159058963"); // SMS originator
    expect(ka).toBe(wa);
    expect(wa).toBe(sms);
    expect(ka).toBe(E164);
  });
});

describe("canonicalizePhone — rejects non-phones", () => {
  it("empty / null / junk", () => {
    expect(canonicalizePhone("")).toBeNull();
    expect(canonicalizePhone(null)).toBeNull();
    expect(canonicalizePhone("hallo")).toBeNull();
    expect(canonicalizePhone("123")).toBeNull(); // too short to be valid
  });
  it("WhatsApp @lid is NOT a phone", () => {
    expect(canonicalizePhone("123456789012345@lid")).toBeNull();
  });
  it("WhatsApp @g.us group is NOT a phone", () => {
    expect(canonicalizePhone("120363012345678901-1602000000@g.us")).toBeNull();
  });
  it("strips the s.whatsapp.net suffix and keeps the number", () => {
    expect(canonicalizePhone("4915159058963@s.whatsapp.net")).toBe("+4915159058963");
  });
});

describe("canonicalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(canonicalizeEmail("  Max@Example.COM ")).toBe("max@example.com");
  });
  it("rejects malformed", () => {
    expect(canonicalizeEmail("not-an-email")).toBeNull();
    expect(canonicalizeEmail("")).toBeNull();
    expect(canonicalizeEmail(null)).toBeNull();
  });
  it("rejects a Kleinanzeigen relay address (rotating, not a real mailbox)", () => {
    const relay =
      "abc123-0123456789abcdef0123456789abcdef01234567-ek-ek@mail.kleinanzeigen.de";
    expect(isRelayEmail(relay)).toBe(true);
    expect(canonicalizeEmail(relay)).toBeNull();
  });
  it("a normal address is not a relay", () => {
    expect(isRelayEmail("kunde@gmx.de")).toBe(false);
    expect(canonicalizeEmail("kunde@gmx.de")).toBe("kunde@gmx.de");
  });
});

describe("classifyJid", () => {
  it("s.whatsapp.net is a phone", () => {
    const r = classifyJid("4915159058963@s.whatsapp.net");
    expect(r.kind).toBe("phone");
    expect(r.phoneE164).toBe("+4915159058963");
  });
  it("@lid is wa_lid, never a phone", () => {
    const r = classifyJid("123456789012345@lid");
    expect(r.kind).toBe("wa_lid");
    expect(r.phoneE164).toBeNull();
  });
  it("@g.us is a group, never a person", () => {
    const r = classifyJid("120363012345678901-1602000000@g.us");
    expect(r.kind).toBe("group");
    expect(r.phoneE164).toBeNull();
  });
  it("strips a device suffix", () => {
    const r = classifyJid("4915159058963:12@s.whatsapp.net");
    expect(r.local).toBe("4915159058963");
    expect(r.phoneE164).toBe("+4915159058963");
  });
});

describe("extractPhonesFromText — rescue the discarded KA Tel. line", () => {
  it("pulls the number out of a Kleinanzeigen inquiry header", () => {
    const body = "Nachricht von RamonaOstd (Tel.: 0151 5905 8963)\nHallo, passt der Termin?";
    expect(extractPhonesFromText(body)).toEqual(["+4915159058963"]);
  });
  it("pulls an operator-pasted +49 number", () => {
    expect(extractPhonesFromText("Bitte melden unter +49 170 1234567")).toEqual([
      "+491701234567",
    ]);
  });
  it("dedupes and returns empty when there is no number", () => {
    expect(extractPhonesFromText("Guten Tag, ich habe eine Frage zum Umzug.")).toEqual([]);
    expect(
      extractPhonesFromText("Tel 0151 5905 8963 oder 0049 151 59058963")
    ).toEqual(["+4915159058963"]);
  });
});
