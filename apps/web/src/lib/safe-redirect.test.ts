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
    // Dot segments collapse during URL parsing into a protocol-relative
    // `//host` (found in review by GPT-6 Astra and the Opus reviewer).
    ["/.//evil.example"],
    ["/a/..//evil.example"],
    ["/%2e%2e//evil.example"],
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

const FALLBACK = "/home";

describe("safeRedirectPath (Fälle aus dem Sofort-Paket)", () => {
  it("lässt normale Pfade samt Query und Hash durch", () => {
    expect(safeRedirectPath("/deals", FALLBACK)).toBe("/deals");
    expect(safeRedirectPath("/objects/deals/abc-123", FALLBACK)).toBe("/objects/deals/abc-123");
    expect(safeRedirectPath("/inbox?conv=42&tab=offen", FALLBACK)).toBe("/inbox?conv=42&tab=offen");
    expect(safeRedirectPath("/kalender?monat=2026-10#woche-3", FALLBACK)).toBe(
      "/kalender?monat=2026-10#woche-3",
    );
    expect(safeRedirectPath("/", FALLBACK)).toBe("/");
  });

  it("nimmt den Fallback, wenn nichts übergeben wurde", () => {
    expect(safeRedirectPath(null, FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath(undefined, FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath(null, "/")).toBe("/");
  });

  it("lehnt absolute URLs ab", () => {
    expect(safeRedirectPath("https://evil.example/login", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("http://evil.example", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("HTTPS://evil.example", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("https:/evil.example", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("evil.example/home", FALLBACK)).toBe(FALLBACK);
  });

  it("lehnt protokoll-relative URLs ab", () => {
    expect(safeRedirectPath("//evil.example", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("//evil.example/home?x=1", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("///evil.example", FALLBACK)).toBe(FALLBACK);
  });

  it("lehnt Backslash-Tricks ab", () => {
    expect(safeRedirectPath("/\\evil.example", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("\\\\evil.example", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("\\/evil.example", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("/foo\\..\\..\\/evil.example", FALLBACK)).toBe(FALLBACK);
  });

  it("lehnt Punkt-Segmente ab, die erst normalisiert zu // werden", () => {
    expect(safeRedirectPath("/.//evil.example", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("/..//evil.example", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("/./\\evil.example", FALLBACK)).toBe(FALLBACK);
  });

  it("lehnt javascript:, data: und andere Schemata ab", () => {
    expect(safeRedirectPath("javascript:alert(1)", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("JavaScript:alert(document.cookie)", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath(" javascript:alert(1)", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("data:text/html,<script>alert(1)</script>", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("mailto:chef@example.invalid", FALLBACK)).toBe(FALLBACK);
  });

  it("lehnt Steuerzeichen ab, die der URL-Parser sonst still entfernt", () => {
    expect(safeRedirectPath("/\t/evil.example", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("/\n/evil.example", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("/\r\n/evil.example", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("/deals\u0000", FALLBACK)).toBe(FALLBACK);
  });

  it("gibt den normalisierten Pfad zurück", () => {
    expect(safeRedirectPath("/a/../deals", FALLBACK)).toBe("/deals");
    expect(safeRedirectPath("/deals/./neu", FALLBACK)).toBe("/deals/neu");
    // Kodierte Schrägstriche bleiben Teil des Pfads auf derselben Origin.
    expect(safeRedirectPath("/%2F%2Fevil.example", FALLBACK)).toBe("/%2F%2Fevil.example");
  });
});
