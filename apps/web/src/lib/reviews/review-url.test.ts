import { describe, expect, it } from "vitest";
import { googleReviewUrlFieldError, parseReviewUrl } from "./review-url";

describe("parseReviewUrl", () => {
  it("accepts http and https URLs and trims whitespace", () => {
    expect(parseReviewUrl("  https://g.page/r/kottke/review  ")).toEqual({
      ok: true,
      url: "https://g.page/r/kottke/review",
    });
    expect(parseReviewUrl("http://search.google.com/local/writereview?placeid=abc")).toEqual({
      ok: true,
      url: "http://search.google.com/local/writereview?placeid=abc",
    });
  });

  it("treats null, empty, and whitespace as empty", () => {
    expect(parseReviewUrl(null)).toEqual({ ok: false, reason: "empty" });
    expect(parseReviewUrl(undefined)).toEqual({ ok: false, reason: "empty" });
    expect(parseReviewUrl("")).toEqual({ ok: false, reason: "empty" });
    expect(parseReviewUrl("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects non-http schemes and strings that are not URLs", () => {
    expect(parseReviewUrl("javascript:alert(1)").ok).toBe(false);
    expect(parseReviewUrl("ftp://files.example/review").ok).toBe(false);
    expect(parseReviewUrl("g.page/r/kottke").ok).toBe(false);
    expect(parseReviewUrl("not a url").ok).toBe(false);
  });
});

describe("googleReviewUrlFieldError", () => {
  it("allows empty values so an admin can clear the link", () => {
    expect(googleReviewUrlFieldError(null)).toBeNull();
    expect(googleReviewUrlFieldError("")).toBeNull();
    expect(googleReviewUrlFieldError("  ")).toBeNull();
  });

  it("allows a valid URL and rejects a bad one", () => {
    expect(googleReviewUrlFieldError("https://g.page/r/ceylan")).toBeNull();
    expect(googleReviewUrlFieldError("javascript:alert(1)")).toMatch(/http\(s\)/);
    expect(googleReviewUrlFieldError(12)).toMatch(/Text/);
  });
});
