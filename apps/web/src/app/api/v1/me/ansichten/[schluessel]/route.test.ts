import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const zustand = vi.hoisted(() => ({
  uiVersion: "neu" as const,
  ansichten: { inbox: { filter: "offen" } } as Record<string, unknown>,
}));

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  setAnsicht: vi.fn(async (_userId: string, schluessel: string, wert: unknown) => {
    zustand.ansichten = { ...zustand.ansichten, [schluessel]: wert };
  }),
  getUserSettings: vi.fn(async () => ({
    uiVersion: zustand.uiVersion,
    ansichten: zustand.ansichten,
  })),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/user-settings", () => ({
  getUserSettings: mocks.getUserSettings,
  setAnsicht: mocks.setAnsicht,
  setUiVersion: vi.fn(),
}));

import { PUT } from "./route";
import { GET as leseEinstellungen } from "../../settings/route";

const NUTZER = {
  userId: "usr_jonas",
  workspaceId: "ws_kottke",
  workspaceRole: "member" as const,
  permissions: {},
  authMethod: "cookie" as const,
};

const GEPRUEFT = {
  modus: "liste",
  listenSpalten: ["name", "stufe"],
  sortierung: { schluessel: "betrag", richtung: "auf" },
};

function put(schluessel: string, body: unknown, raw = false) {
  return PUT(
    new NextRequest(`https://crm.test/api/v1/me/ansichten/${schluessel}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
    { params: Promise.resolve({ schluessel }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  zustand.uiVersion = "neu";
  zustand.ansichten = { inbox: { filter: "offen" } };
  mocks.getAuthContext.mockResolvedValue(NUTZER);
  mocks.setAnsicht.mockImplementation(async (_userId: string, schluessel: string, wert: unknown) => {
    zustand.ansichten = { ...zustand.ansichten, [schluessel]: wert };
  });
  mocks.getUserSettings.mockImplementation(async () => ({
    uiVersion: zustand.uiVersion,
    ansichten: zustand.ansichten,
  }));
});

describe("PUT /api/v1/me/ansichten/[schluessel]", () => {
  it("antwortet 401 ohne Anmeldung und schreibt nichts", async () => {
    mocks.getAuthContext.mockResolvedValue(null);

    const res = await put("leads", GEPRUEFT);

    expect(res.status).toBe(401);
    expect(mocks.setAnsicht).not.toHaveBeenCalled();
  });

  it("antwortet 403 für einen Nur-Lesen-Schlüssel und schreibt nichts", async () => {
    mocks.getAuthContext.mockResolvedValue({
      ...NUTZER,
      authMethod: "api_key",
      apiKeyAccess: "read",
    });

    const res = await put("leads", GEPRUEFT);

    expect(res.status).toBe(403);
    expect(mocks.setAnsicht).not.toHaveBeenCalled();
  });

  it("antwortet 404 für einen unbekannten Schlüssel und schreibt nichts", async () => {
    const res = await put("inbox", GEPRUEFT);

    expect(res.status).toBe(404);
    expect(mocks.setAnsicht).not.toHaveBeenCalled();
  });

  it("antwortet 400 bei ungültiger Ansicht und schreibt nichts", async () => {
    const res = await put("leads", { modus: "tisch", listenSpalten: ["name"], sortierung: GEPRUEFT.sortierung });

    expect(res.status).toBe(400);
    expect(mocks.setAnsicht).not.toHaveBeenCalled();
  });

  it("antwortet 400 bei ungültigem JSON und schreibt nichts", async () => {
    const res = await put("leads", "{", true);

    expect(res.status).toBe(400);
    expect(mocks.setAnsicht).not.toHaveBeenCalled();
  });

  it("antwortet 400, wenn der Body über 4 KB liegt, und schreibt nichts", async () => {
    const res = await put("leads", { ...GEPRUEFT, ballast: "x".repeat(5000) });

    expect(res.status).toBe(400);
    expect(mocks.setAnsicht).not.toHaveBeenCalled();
  });

  it("speichert die geprüfte Ansicht und lässt fremde Felder weg", async () => {
    const res = await put("leads", { ...GEPRUEFT, fremd: "weg" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual(GEPRUEFT);
    expect(mocks.setAnsicht).toHaveBeenCalledWith("usr_jonas", "leads", GEPRUEFT);
  });

  it("GET /me/settings liefert danach beide Schlüssel, uiVersion bleibt", async () => {
    const geschrieben = await put("leads", GEPRUEFT);
    expect(geschrieben.status).toBe(200);

    const res = await leseEinstellungen(new NextRequest("https://crm.test/api/v1/me/settings"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({
      uiVersion: "neu",
      ansichten: {
        inbox: { filter: "offen" },
        leads: GEPRUEFT,
      },
    });
    expect(mocks.getUserSettings).toHaveBeenCalledWith("usr_jonas");
  });
});
