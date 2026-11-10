import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ getAuthContext: vi.fn(), dealImWorkspace: vi.fn(), kundeVorschlag: vi.fn() }));

vi.mock("@/lib/api-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-utils")>()),
  getAuthContext: m.getAuthContext,
}));
vi.mock("@/lib/kalkulation-versionen-antwort", () => ({ dealImWorkspace: m.dealImWorkspace }));
vi.mock("@/services/kunde-vorschlag", () => ({ kundeVorschlag: m.kundeVorschlag }));

import { POST } from "./route";

const params = { params: Promise.resolve({ recordId: "deal_1" }) };
const post = () => POST(new NextRequest("https://crm.test/api/v1/deals/deal_1/kunde/vorschlag", { method: "POST" }), params);

beforeEach(() => {
  vi.clearAllMocks();
  m.dealImWorkspace.mockResolvedValue(true);
  m.kundeVorschlag.mockResolvedValue({ quelle: null });
});

describe("POST /api/v1/deals/:id/kunde/vorschlag", () => {
  it("in der Sitzung: Vorschlag für den eigenen Deal", async () => {
    m.getAuthContext.mockResolvedValue({ userId: "u", workspaceId: "ws_1", authMethod: "cookie" });
    expect((await post()).status).toBe(200);
    expect(m.kundeVorschlag).toHaveBeenCalledWith("ws_1", "deal_1");
  });

  it("API-Schlüssel: 403, keine KI-Auswertung", async () => {
    m.getAuthContext.mockResolvedValue({ userId: null, workspaceId: "ws_1", authMethod: "api_key", apiKeyAccess: "full" });
    expect((await post()).status).toBe(403);
    expect(m.kundeVorschlag).not.toHaveBeenCalled();
  });

  it("fremder Deal: 404", async () => {
    m.getAuthContext.mockResolvedValue({ userId: "u", workspaceId: "ws_1", authMethod: "cookie" });
    m.dealImWorkspace.mockResolvedValue(false);
    expect((await post()).status).toBe(404);
  });
});
