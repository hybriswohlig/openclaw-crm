import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// unauthorized(req) turns a read-only API key that tried to write into a 403
// INSUFFICIENT_SCOPE (consumeApiKeyScopeDenial). Called without the request,
// the same key gets a misleading 401.
const API_DIR = join(__dirname, "..", "app", "api");

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name === "route.ts" ? [path] : [];
  });
}

describe("API routes", () => {
  it("pass the request to unauthorized()", () => {
    const offenders = routeFiles(API_DIR)
      .filter((file) => /\bunauthorized\(\)/.test(readFileSync(file, "utf8")))
      .map((file) => relative(API_DIR, file));
    expect(offenders).toEqual([]);
  });
});
