import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveBaseUrl } from "./client";

const ENV_KEYS = [
  "NEXT_PUBLIC_APP_URL",
  "CRM_BASE_URL",
  "VERCEL_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_BRANCH_URL",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function reqWith(headers: Record<string, string>): Request {
  return new Request("https://example.test/api/mcp", { headers });
}

describe("resolveBaseUrl", () => {
  it("prefers the host the client actually reached over a redirecting env origin", () => {
    // The regression: NEXT_PUBLIC_APP_URL pointed at the project's
    // *.vercel.app origin, which Vercel 307-redirects to the production
    // domain, so every MCP self-call failed with HTTP_ERROR 307.
    process.env.NEXT_PUBLIC_APP_URL = "https://openclaw-crm-web.vercel.app";

    const base = resolveBaseUrl(
      reqWith({ "x-forwarded-host": "darioushkottke.online" })
    );

    expect(base).toBe("https://darioushkottke.online");
  });

  it("prefers the request host over VERCEL_URL", () => {
    process.env.VERCEL_URL = "openclaw-crm-web.vercel.app";

    const base = resolveBaseUrl(
      reqWith({ "x-forwarded-host": "darioushkottke.online" })
    );

    expect(base).toBe("https://darioushkottke.online");
  });

  it("honours x-forwarded-proto for local http", () => {
    const base = resolveBaseUrl(
      reqWith({ "x-forwarded-host": "localhost:3001", "x-forwarded-proto": "http" })
    );

    expect(base).toBe("http://localhost:3001");
  });

  it("falls back to env when there is no request context", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://darioushkottke.online/";

    expect(resolveBaseUrl()).toBe("https://darioushkottke.online");
  });

  it("falls back to VERCEL_URL when no request and no explicit app url", () => {
    process.env.VERCEL_URL = "openclaw-crm-web.vercel.app";

    expect(resolveBaseUrl()).toBe("https://openclaw-crm-web.vercel.app");
  });

  it("falls back to localhost when nothing is configured", () => {
    expect(resolveBaseUrl()).toBe("http://localhost:3001");
  });
});
