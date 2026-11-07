import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ getAuthContext: vi.fn(), altAufrufMerken: vi.fn() }));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/services/alt-aufruf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/alt-aufruf")>();
  return { ...actual, altAufrufMerken: mocks.altAufrufMerken };
});

import { POST } from "./route";

const SITZUNG = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "member" as const, permissions: {}, authMethod: "cookie" as const };
const post = (body: unknown, cookie?: string) =>
  new NextRequest("http://localhost/api/v1/alt-aufruf", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(SITZUNG);
  mocks.altAufrufMerken.mockResolvedValue("gemerkt");
});

describe("POST /api/v1/alt-aufruf", () => {
  it("merkt den Aufruf mit Sitzung und antwortet 204 ohne Inhalt", async () => {
    const res = await POST(post({ pfad: "/home", mitAlt: false }, "crm_ui=neu"));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(mocks.altAufrufMerken).toHaveBeenCalledWith("ws_1", "usr_1", { pfad: "/home", mitAlt: false, ui: "neu" });
  });

  it("antwortet 204 auch beim zweiten Aufruf derselben Minute", async () => {
    mocks.altAufrufMerken.mockResolvedValue("doppelt");
    expect((await POST(post({ pfad: "/home", mitAlt: false }))).status).toBe(204);
  });

  it("antwortet 401 ohne Sitzung", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await POST(post({ pfad: "/home" }))).status).toBe(401);
    expect(mocks.altAufrufMerken).not.toHaveBeenCalled();
  });

  it("antwortet 403 für API-Schlüssel", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...SITZUNG, authMethod: "api_key", apiKeyAccess: "full", apiKeyId: "k1" });
    expect((await POST(post({ pfad: "/home" }))).status).toBe(403);
    expect(mocks.altAufrufMerken).not.toHaveBeenCalled();
  });

  it("kürzt den Pfad um Abfrage und Anker und liest mitAlt und ui", async () => {
    await POST(post({ pfad: "/financial?alt=1&tab=x#oben", mitAlt: true }, "andere=1; crm_ui=alt"));
    expect(mocks.altAufrufMerken).toHaveBeenCalledWith("ws_1", "usr_1", { pfad: "/financial", mitAlt: true, ui: "alt" });
  });

  it("setzt ui null ohne oder mit unbekanntem Cookie und mitAlt nur bei true", async () => {
    await POST(post({ pfad: "/home", mitAlt: "ja" }, "crm_ui=neuer"));
    expect(mocks.altAufrufMerken).toHaveBeenCalledWith("ws_1", "usr_1", { pfad: "/home", mitAlt: false, ui: null });
  });

  it("begrenzt den Pfad auf 200 Zeichen", async () => {
    await POST(post({ pfad: `/${"a".repeat(300)}` }));
    expect(mocks.altAufrufMerken.mock.calls[0][2].pfad).toHaveLength(200);
  });

  it.each([["kaputtes JSON", "{x"], ["ohne Pfad", {}], ["kein Pfad", { pfad: "home" }], ["fremde Herkunft", { pfad: "//evil.example/x" }], ["Zahl", { pfad: 5 }]])(
    "antwortet 400 bei %s",
    async (_name, body) => {
      expect((await POST(post(body))).status).toBe(400);
      expect(mocks.altAufrufMerken).not.toHaveBeenCalled();
    }
  );
});
