import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect";

// ?redirect= on the login pages is attacker-controllable (anyone can send a
// login link). After sign-in we navigate there, so it may only ever be a path
// on our own site — never javascript:, never another host.
describe("safeRedirectPath", () => {
  it("keeps a same-site path with query and hash", () => {
    expect(safeRedirectPath("/auftrag/123?x=1#y", "/")).toBe("/auftrag/123?x=1#y");
  });

  it.each([
    ["javascript:alert(1)"],
    ["JavaScript:alert(1)"],
    ["https://evil.example/login"],
    ["//evil.example"],
    ["/\\evil.example"],
    ["\\/evil.example"],
    ["\t/home"],
    ["/home\\..\\x"],
    [""],
  ])("falls back for %j", (value) => {
    expect(safeRedirectPath(value, "/home")).toBe("/home");
  });

  it("falls back for null and undefined", () => {
    expect(safeRedirectPath(null, "/")).toBe("/");
    expect(safeRedirectPath(undefined, "/")).toBe("/");
  });

  it("keeps encoded characters as a same-site path", () => {
    const out = safeRedirectPath("/%0d%0aevil", "/");
    expect(out.startsWith("/")).toBe(true);
    expect(out.startsWith("//")).toBe(false);
  });
});
