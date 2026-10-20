import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  API_KEY_FULL_SCOPES,
  API_KEY_READ_SCOPES,
  isReadOnlyApiKeyScopes,
  isSafeHttpMethod,
  isWriteCapableScope,
  parseApiKeyScopes,
  readApiKeyScopes,
} from "./api-key-scopes";

describe("API key scope semantics", () => {
  it("treats missing, empty, and unreadable scopes as full access", () => {
    for (const raw of [undefined, null, "", "   ", "not-json", "null", '"*"', "{}", "42", "[1]", '["read", 1]']) {
      expect(isReadOnlyApiKeyScopes(raw)).toBe(false);
    }
    expect(parseApiKeyScopes("[]")).toEqual([]);
    expect(isReadOnlyApiKeyScopes("[]")).toBe(false);
    expect(isReadOnlyApiKeyScopes([])).toBe(false);
  });

  it("keeps write, full, admin, wildcard, and mixed scopes unrestricted", () => {
    for (const raw of [
      '["*"]',
      ["*"],
      '["write"]',
      '["WRITE"]',
      '["full"]',
      '["admin"]',
      '["all"]',
      '["readwrite"]',
      '["read-write"]',
      '["read_write"]',
      '["crm:write"]',
      '["crm:*"]',
      '["full-access"]',
      '["read", "*"]',
      '["read", "admin"]',
      [...API_KEY_FULL_SCOPES],
    ]) {
      expect(isReadOnlyApiKeyScopes(raw)).toBe(false);
    }
  });

  it("restricts explicit lists that contain no write-capable scope", () => {
    for (const raw of [
      '["read"]',
      ["read"],
      '["READ"]',
      '["read-only"]',
      '["readonly"]',
      '["calendar"]',
      '["read", "calendar:read"]',
      [...API_KEY_READ_SCOPES],
    ]) {
      expect(isReadOnlyApiKeyScopes(raw)).toBe(true);
    }
    expect(isWriteCapableScope("read")).toBe(false);
    expect(isWriteCapableScope("*")).toBe(true);
  });

  it("unwraps the double-encoded production string", () => {
    // jsonb string "[\"*\"]" / "[\"read\"]" arrives as a JavaScript string.
    expect(parseApiKeyScopes('["*"]')).toEqual(["*"]);
    expect(isReadOnlyApiKeyScopes('["*"]')).toBe(false);
    expect(parseApiKeyScopes('["read"]')).toEqual(["read"]);
    expect(isReadOnlyApiKeyScopes('["read"]')).toBe(true);
    // One more encoding layer: the raw text of that jsonb string.
    expect(isReadOnlyApiKeyScopes(JSON.stringify('["*"]'))).toBe(false);
    expect(isReadOnlyApiKeyScopes(JSON.stringify('["read"]'))).toBe(true);
    expect(readApiKeyScopes('["read"]')).toEqual(["read"]);
    expect(readApiKeyScopes(["read"])).toEqual(["read"]);
    expect(readApiKeyScopes("not-json")).toEqual([]);
  });

  it("treats GET, HEAD, and OPTIONS as safe methods", () => {
    expect(isSafeHttpMethod("GET")).toBe(true);
    expect(isSafeHttpMethod("head")).toBe(true);
    expect(isSafeHttpMethod("OPTIONS")).toBe(true);
    expect(isSafeHttpMethod("POST")).toBe(false);
    expect(isSafeHttpMethod("PATCH")).toBe(false);
    expect(isSafeHttpMethod("PUT")).toBe(false);
    expect(isSafeHttpMethod("DELETE")).toBe(false);
  });

  it("looks up API key hashes only in getAuthContext", () => {
    const src = path.resolve(import.meta.dirname, "..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === "node_modules" || entry === ".next") continue;
          walk(full);
          continue;
        }
        if (!full.endsWith(".ts") && !full.endsWith(".tsx")) continue;
        if (full.endsWith(".test.ts")) continue;
        if (readFileSync(full, "utf8").includes("keyHash")) {
          hits.push(path.relative(src, full));
        }
      }
    };
    walk(src);
    expect(hits.sort()).toEqual(
      ["db/schema/api-keys.ts", "lib/api-utils.ts", "services/api-keys.ts"].sort()
    );
  });
});
