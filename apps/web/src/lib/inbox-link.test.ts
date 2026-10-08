import { describe, expect, it } from "vitest";
import { inboxKonversationUrl } from "./inbox-link";

// Die Inbox liest ?conv= (inbox/page.tsx). Push-Links mit ?conversationId=
// öffneten nur die Inbox-Liste, nicht den Chat.
function parameter(url: string): URLSearchParams {
  return new URL(url, "https://crm.test").searchParams;
}

describe("inboxKonversationUrl", () => {
  it("verlinkt mit ?conv=, den die Inbox beim Laden liest", () => {
    const id = "3f2c9a1e-5b7d-4c11-9a0e-2d6f8b4c1a90";
    const url = inboxKonversationUrl(id);
    expect(url).toBe(`/inbox?conv=${id}`);
    expect(new URL(url, "https://crm.test").pathname).toBe("/inbox");
    expect(parameter(url).get("conv")).toBe(id);
    expect(parameter(url).has("conversationId")).toBe(false);
  });

  it("kodiert Sonderzeichen, damit die ID unverändert ankommt", () => {
    const url = inboxKonversationUrl("a&b=c d");
    expect(url).toBe("/inbox?conv=a%26b%3Dc%20d");
    expect(parameter(url).get("conv")).toBe("a&b=c d");
    expect([...parameter(url).keys()]).toEqual(["conv"]);
  });

  it("geht ohne Konversation auf die Inbox", () => {
    expect(inboxKonversationUrl(null)).toBe("/inbox");
    expect(inboxKonversationUrl(undefined)).toBe("/inbox");
    expect(inboxKonversationUrl("")).toBe("/inbox");
  });
});
