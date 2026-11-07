import { describe, expect, it } from "vitest";
import { inboxKonversationUrl } from "./inbox-link";

function parameter(url: string): URLSearchParams {
  return new URL(url, "https://crm.test").searchParams;
}

describe("inboxKonversationUrl", () => {
  it("verlinkt eine gültige Konversation über die Weiche", () => {
    const id = "3f2c9a1e-5b7d-4c11-9a0e-2d6f8b4c1a90";
    const url = inboxKonversationUrl(id);
    expect(url).toBe(`/weiter?conv=${id}`);
    expect(new URL(url, "https://crm.test").pathname).toBe("/weiter");
    expect(parameter(url).get("conv")).toBe(id);
    expect(parameter(url).has("conversationId")).toBe(false);
  });

  it("lässt eine ungültige Kennung weg und geht auf die Weiche", () => {
    expect(inboxKonversationUrl("a&b=c d")).toBe("/weiter");
    expect(inboxKonversationUrl("../x")).toBe("/weiter");
    expect(inboxKonversationUrl("a".repeat(65))).toBe("/weiter");
  });

  it("geht ohne Konversation auf die Weiche", () => {
    expect(inboxKonversationUrl(null)).toBe("/weiter");
    expect(inboxKonversationUrl(undefined)).toBe("/weiter");
    expect(inboxKonversationUrl("")).toBe("/weiter");
  });
});
