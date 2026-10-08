import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// GET /api/v1/workspace gab das ganze settings-Objekt an jedes Mitglied
// zurück, samt OpenRouter-Schlüssel im Klartext (Seitenleiste, crm_whoami).
// Gleiche Technik wie die anderen Route-Tests: nur die Service-Naht mocken,
// die echten Antwort-Helfer aus @/lib/api-utils behalten.
const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  getWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/workspace", () => ({
  getWorkspace: mocks.getWorkspace,
  updateWorkspace: mocks.updateWorkspace,
}));

import { GET, PATCH } from "./route";

const SCHLUESSEL = "sk-or-v1-geheim-1234567890";

const ZEILE = {
  id: "ws_kottke_prod",
  name: "Kottke Umzüge",
  slug: "kottke",
  settings: {
    logo: "<svg/>",
    openrouterApiKey: SCHLUESSEL,
    openrouterModel: "anthropic/claude-sonnet-4",
  },
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

const MITGLIED = {
  userId: "usr_jonas",
  workspaceId: ZEILE.id,
  workspaceRole: "member" as const,
  permissions: {},
  authMethod: "cookie" as const,
};

function callPatch(body: unknown) {
  return PATCH(
    new NextRequest("https://crm.test/api/v1/workspace", {
      method: "PATCH",
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(MITGLIED);
  mocks.getWorkspace.mockResolvedValue(ZEILE);
});

describe("GET /api/v1/workspace", () => {
  it("liefert einem Mitglied die Einstellungen ohne OpenRouter-Schlüssel", async () => {
    const res = await GET(new NextRequest("https://crm.test/api/v1/workspace"));
    const text = await res.text();
    const body = JSON.parse(text);

    expect(res.status).toBe(200);
    expect(text).not.toContain(SCHLUESSEL);
    expect(body.data.settings).toEqual({
      logo: "<svg/>",
      openrouterModel: "anthropic/claude-sonnet-4",
    });
    expect(body.data.hasOpenrouterKey).toBe(true);
    // Was Seitenleiste, Einstellungen und Integrationen lesen, bleibt da.
    expect(body.data).toMatchObject({
      id: ZEILE.id,
      name: "Kottke Umzüge",
      slug: "kottke",
      role: "member",
      permissions: {},
      capabilities: { manageChannels: false },
    });
  });

  it("meldet hasOpenrouterKey false, wenn kein Schlüssel hinterlegt ist", async () => {
    mocks.getWorkspace.mockResolvedValue({ ...ZEILE, settings: { logo: "<svg/>" } });

    const res = await GET(new NextRequest("https://crm.test/api/v1/workspace"));
    const body = await res.json();

    expect(body.data.hasOpenrouterKey).toBe(false);
    expect(body.data.settings).toEqual({ logo: "<svg/>" });
  });

  it("antwortet 401 ohne Anmeldung", async () => {
    mocks.getAuthContext.mockResolvedValue(null);

    const res = await GET(new NextRequest("https://crm.test/api/v1/workspace"));

    expect(res.status).toBe(401);
    expect(mocks.getWorkspace).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/workspace", () => {
  beforeEach(() => {
    mocks.getAuthContext.mockResolvedValue({ ...MITGLIED, workspaceRole: "admin" });
  });

  it("gibt auch in der Antwort keinen Schlüssel heraus", async () => {
    mocks.updateWorkspace.mockResolvedValue({ ...ZEILE, name: "Kottke Umzüge GmbH" });

    const res = await callPatch({ name: "Kottke Umzüge GmbH", settings: { logo: "<svg/>" } });
    const text = await res.text();
    const body = JSON.parse(text);

    expect(res.status).toBe(200);
    expect(text).not.toContain(SCHLUESSEL);
    expect(body.data).toMatchObject({
      name: "Kottke Umzüge GmbH",
      hasOpenrouterKey: true,
      settings: { logo: "<svg/>", openrouterModel: "anthropic/claude-sonnet-4" },
    });
    expect(mocks.updateWorkspace).toHaveBeenCalledWith(ZEILE.id, {
      name: "Kottke Umzüge GmbH",
      settings: { logo: "<svg/>" },
    });
  });

  it("lehnt settings ab, die kein Objekt sind", async () => {
    for (const settings of [null, [], "logo", 42]) {
      const res = await callPatch({ settings });
      expect(res.status, JSON.stringify(settings)).toBe(400);
    }
    expect(mocks.updateWorkspace).not.toHaveBeenCalled();
  });

  it("lässt nur Admins ändern", async () => {
    mocks.getAuthContext.mockResolvedValue(MITGLIED);

    const res = await callPatch({ name: "Neu" });

    expect(res.status).toBe(400);
    expect(mocks.updateWorkspace).not.toHaveBeenCalled();
  });
});
