import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CrmApiError, CrmClient, resolveBaseUrl } from "./client";
import type { BinaryResponseEnvelope } from "./client";

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

function crmClient(): CrmClient {
  return new CrmClient({
    userId: "u1",
    workspaceId: "w1",
    workspaceRole: "admin",
    baseUrl: "https://crm.example.test",
  });
}

/**
 * Answer the next fetch with a fixed Response.
 *
 * The client uses `redirect: "manual"`, so a plain 200 short-circuits the
 * self-redirect loop and the body handling under test runs on the first hop.
 */
function stubFetch(res: Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => res)
  );
}

/**
 * Capture how a promise settled without collapsing the two outcomes.
 *
 * `.catch(e => e)` alone cannot tell "threw" from "resolved with the error
 * value", and several of these cases turn on the client refusing to *return*
 * something it used to hand back as data.
 */
type Settled = { resolved?: unknown; error?: unknown };

async function settle(p: Promise<unknown>): Promise<Settled> {
  return p.then(
    (resolved): Settled => ({ resolved }),
    (error): Settled => ({ error })
  );
}

describe("CrmClient response body handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("wraps a binary body as base64 that decodes back to the exact bytes", async () => {
    // The regression: res.text() was called on every response, so a JPEG came
    // back as UTF-8-decoded mush. Bytes above 0x7f are the ones that die, so
    // the fixture carries several and the test asserts byte equality.
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x7f, 0x80, 0xfe, 0x42]);
    stubFetch(
      new Response(bytes, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      })
    );

    const envelope = await crmClient().request<BinaryResponseEnvelope>(
      "/api/v1/inbox/attachments/att-1/content"
    );

    expect(envelope._binary).toBe(true);
    expect(envelope.mimeType).toBe("image/jpeg");
    expect(envelope.byteLength).toBe(bytes.length);
    expect([...Buffer.from(envelope.contentBase64, "base64")]).toEqual([...bytes]);
  });

  it("surfaces the filename from content-disposition", async () => {
    stubFetch(
      new Response(Buffer.from([0xff, 0xd8, 0xff]), {
        status: 200,
        headers: {
          "content-type": "image/jpeg",
          "content-disposition": 'inline; filename="image.jpeg"',
        },
      })
    );

    const envelope = await crmClient().request<BinaryResponseEnvelope>(
      "/api/v1/inbox/attachments/att-1/content"
    );

    expect(envelope.fileName).toBe("image.jpeg");
  });

  it("wraps an untyped body that is not valid UTF-8 as binary", async () => {
    // The same pixel-destroying bug, still live on a second path: the
    // crm-tools job proxy forwards the upstream content-type only when it is
    // present, so a rendered PDF can arrive with no content-type at all and
    // used to go through res.text().
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x80, 0xfe, 0xff, 0x0a]);
    stubFetch(new Response(bytes, { status: 200 }));

    const envelope = await crmClient().request<BinaryResponseEnvelope>(
      "/api/tools/jobs/j1/content"
    );

    expect(envelope._binary).toBe(true);
    expect(envelope.mimeType).toBe("application/octet-stream");
    expect(envelope.byteLength).toBe(bytes.length);
    expect([...Buffer.from(envelope.contentBase64, "base64")]).toEqual([...bytes]);
  });

  it("still parses an untyped body that is valid UTF-8 JSON", async () => {
    // Deciding by strict decode rather than by assuming binary: a Buffer body
    // carries no content-type, which is exactly how most job-proxy JSON lands.
    stubFetch(
      new Response(Buffer.from(JSON.stringify({ data: { jobId: "j1" } })), {
        status: 200,
      })
    );

    const data = await crmClient().request("/api/tools/jobs/j1");

    expect(data).toEqual({ jobId: "j1" });
  });

  it("returns no content for an untyped empty body instead of throwing", async () => {
    // A 204-shaped 200 from a proxy: no content-type, no bytes. The strict
    // decode must not turn that into a binary envelope or an error. An empty
    // body normalises to null here, the same as on the typed path.
    stubFetch(new Response(Buffer.alloc(0), { status: 200 }));

    const outcome = await settle(crmClient().request("/api/tools/jobs/j1/content"));

    expect(outcome).not.toHaveProperty("error");
    expect(outcome.resolved).toBeNull();
  });

  it("explains a Next.js app-shell 404 instead of dumping HTML", async () => {
    // Hitting a path with no route handler returns the HTML shell under a 404.
    // Reporting that as INVALID_JSON with the markup as the message told the
    // agent nothing, so it kept retrying the same non-existent path.
    const shell =
      '<!DOCTYPE html><html><head><title>404</title></head>' +
      "<body>This page could not be found.</body></html>";
    stubFetch(
      new Response(shell, {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    );

    const err = await crmClient()
      .request("/api/v1/deals/deal-1/attachments/att-1/content")
      .then(() => null)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CrmApiError);
    const apiErr = err as CrmApiError;
    expect(apiErr.status).toBe(404);
    expect(apiErr.code).toBe("NOT_JSON_HTML");
    expect(apiErr.message).toContain("Got HTML, not JSON");
    // Only a 404 licenses the "no route handler" diagnosis; a 500 or a
    // platform error also answers with HTML and must not be reported as
    // "this endpoint does not exist".
    expect(apiErr.message).toContain("no route handler");
    expect(apiErr.message).toContain("crm_get_attachment");
    expect(apiErr.message).not.toContain("<!DOCTYPE");
    expect(apiErr.message).not.toContain("<html");
  });

  it("refuses to return an HTML login page as the tool result", async () => {
    // Middleware 307s an unauthenticated /api/ call to /login and the client
    // follows same-origin redirects, so the login page arrives under a 200.
    // Handing that back as data was a silent lie: the tool "succeeded" and the
    // agent got a page of markup where it expected a record.
    const loginPage =
      "<!DOCTYPE html><html><head><title>Sign in</title></head>" +
      "<body><form action=\"/login\"></form></body></html>";
    stubFetch(
      new Response(loginPage, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    );

    const outcome = await settle(crmClient().request("/api/v1/tasks"));

    expect(outcome).not.toHaveProperty("resolved");
    expect(outcome.error).toBeInstanceOf(CrmApiError);
    const apiErr = outcome.error as CrmApiError;
    expect(apiErr.code).toBe("NOT_JSON_HTML");
    expect(apiErr.message).toContain("Got HTML, not JSON");
    expect(apiErr.message).not.toContain("<!DOCTYPE");
  });

  it("does not blame a missing route handler for a 500 HTML body", async () => {
    // A 500, a 504 and a platform 413 all answer with HTML too. Repeating the
    // 404 diagnosis there tells an agent the endpoint does not exist, so it
    // stops retrying a route that is real and merely failing right now.
    const path = "/api/v1/inbox/attachments/att-1/content";
    const shell = "<!DOCTYPE html><html><body>Application error</body></html>";

    stubFetch(
      new Response(shell, { status: 500, headers: { "content-type": "text/html" } })
    );
    const five = (await settle(crmClient().request(path))).error as CrmApiError;

    expect(five).toBeInstanceOf(CrmApiError);
    expect(five.status).toBe(500);
    expect(five.code).toBe("NOT_JSON_HTML");
    expect(five.message).toContain("Got HTML, not JSON");
    expect(five.message).not.toContain("no route handler");
    expect(five.message).toContain("may well exist");

    // Same path, same body, only the status differs — so the diagnosis is the
    // one thing that may vary between them.
    stubFetch(
      new Response(shell, { status: 404, headers: { "content-type": "text/html" } })
    );
    const four = (await settle(crmClient().request(path))).error as CrmApiError;

    expect(four.status).toBe(404);
    expect(four.message).toContain("no route handler");
    expect(four.message).not.toBe(five.message);
  });

  it("still unwraps a JSON data envelope", async () => {
    stubFetch(
      new Response(JSON.stringify({ data: { id: "rec-1", name: "Kottke" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const data = await crmClient().request("/api/v1/records/rec-1");

    expect(data).toEqual({ id: "rec-1", name: "Kottke" });
  });

  it("still returns a text/plain body as a raw string", async () => {
    stubFetch(
      new Response("plain text, not JSON", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      })
    );

    const data = await crmClient().request("/api/v1/health");

    expect(data).toBe("plain text, not JSON");
  });

  it("still throws with the server's error code on a JSON error", async () => {
    stubFetch(
      new Response(
        JSON.stringify({ error: { code: "NOT_FOUND", message: "Attachment not found" } }),
        { status: 404, headers: { "content-type": "application/json" } }
      )
    );

    const err = await crmClient()
      .request("/api/v1/inbox/attachments/nope")
      .then(() => null)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CrmApiError);
    expect((err as CrmApiError).status).toBe(404);
    expect((err as CrmApiError).code).toBe("NOT_FOUND");
    expect((err as CrmApiError).message).toBe("Attachment not found");
  });

  it("parses a string-shaped JSON 404 instead of reporting INVALID_JSON", async () => {
    // Invented deal-attachment paths now answer `{ error: "Not found" }` so
    // crm_api must treat that as a real 404, not as a broken JSON body.
    stubFetch(
      new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      })
    );

    const err = await crmClient()
      .request("/api/v1/deals/deal-1/attachments/att-1/content")
      .then(() => null)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CrmApiError);
    const apiErr = err as CrmApiError;
    expect(apiErr.status).toBe(404);
    expect(apiErr.code).not.toBe("INVALID_JSON");
    expect(apiErr.code).not.toBe("NOT_JSON_HTML");
    expect(apiErr.body).toEqual({ error: "Not found" });
  });
});
