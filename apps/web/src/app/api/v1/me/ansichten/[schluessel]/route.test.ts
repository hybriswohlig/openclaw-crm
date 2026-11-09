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

  it.each(["constructor", "__proto__", "toString"])("antwortet 404 für geerbte Eigenschaft %s und schreibt nichts", async (k) => {
    const res = await put(k, { beliebig: true });

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

  it("speichert plan, lässt fremde Felder weg und merget nur diesen Schlüssel", async () => {
    const res = await put("plan", { modus: "woche", fremd: "weg" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({ modus: "woche" });
    expect(mocks.setAnsicht).toHaveBeenCalledWith("usr_jonas", "plan", { modus: "woche" });

    const gelesen = await leseEinstellungen(new NextRequest("https://crm.test/api/v1/me/settings"));
    const einstellungen = await gelesen.json();

    expect(gelesen.status).toBe(200);
    expect(einstellungen.data).toEqual({
      uiVersion: "neu",
      ansichten: {
        inbox: { filter: "offen" },
        plan: { modus: "woche" },
      },
    });
  });

  it("antwortet 400 bei ungültiger Plan-Ansicht und schreibt nichts", async () => {
    const res = await put("plan", { modus: "jahr" });

    expect(res.status).toBe(400);
    expect(mocks.setAnsicht).not.toHaveBeenCalled();
  });

  it("antwortet 403 für einen Nur-Lesen-Schlüssel auf plan und schreibt nichts", async () => {
    mocks.getAuthContext.mockResolvedValue({
      ...NUTZER,
      authMethod: "api_key",
      apiKeyAccess: "read",
    });

    const res = await put("plan", { modus: "tag" });

    expect(res.status).toBe(403);
    expect(mocks.setAnsicht).not.toHaveBeenCalled();
  });

  it("lässt die Leads-Ansicht unverändert, wenn plan daneben liegt", async () => {
    const plan = await put("plan", { modus: "tag" });
    expect(plan.status).toBe(200);

    const leads = await put("leads", { ...GEPRUEFT, fremd: "weg" });
    const body = await leads.json();

    expect(leads.status).toBe(200);
    expect(body.data).toEqual(GEPRUEFT);

    const gelesen = await leseEinstellungen(new NextRequest("https://crm.test/api/v1/me/settings"));
    const einstellungen = await gelesen.json();

    expect(einstellungen.data.ansichten).toEqual({
      inbox: { filter: "offen" },
      plan: { modus: "tag" },
      leads: GEPRUEFT,
    });
  });
});

describe("PUT /api/v1/me/ansichten/darstellung (Plan 13)", () => {
  it.each(["hell", "dunkel", "system"])("speichert %s", async (wert) => {
    const res = await put("darstellung", wert);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toBe(wert);
    expect(mocks.setAnsicht).toHaveBeenCalledWith("usr_jonas", "darstellung", wert);
  });

  it.each([["Hell"], ["nacht"], [1], [{ modus: "hell" }], [null]])("antwortet 400 bei %j und schreibt nichts", async (wert) => {
    const res = await put("darstellung", wert);

    expect(res.status).toBe(400);
    expect(mocks.setAnsicht).not.toHaveBeenCalled();
  });

  it("antwortet 403 für einen Nur-Lesen-Schlüssel und schreibt nichts", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...NUTZER, authMethod: "api_key", apiKeyAccess: "read" });

    const res = await put("darstellung", "dunkel");

    expect(res.status).toBe(403);
    expect(mocks.setAnsicht).not.toHaveBeenCalled();
  });

  it("lässt andere Ansichten unverändert", async () => {
    await put("plan", { modus: "tag" });
    await put("darstellung", "dunkel");

    const gelesen = await leseEinstellungen(new NextRequest("https://crm.test/api/v1/me/settings"));
    const einstellungen = await gelesen.json();

    expect(einstellungen.data.ansichten).toEqual({
      inbox: { filter: "offen" },
      plan: { modus: "tag" },
      darstellung: "dunkel",
    });
  });
});

describe("Spiegel-Cookie neu_darstellung (Plan 14b)", () => {
  it("setzt den Cookie bei darstellung, nicht httpOnly, mit Secure unter https", async () => {
    mocks.getAuthContext.mockResolvedValue(NUTZER);
    const res = await put("darstellung", "dunkel");
    expect(res.status).toBe(200);
    const zeile = res.headers.get("set-cookie") ?? "";
    expect(zeile).toContain("neu_darstellung=dunkel");
    expect(zeile).toContain("Path=/");
    expect(zeile).toContain("SameSite=Lax");
    expect(zeile).toContain("Secure");
    expect(zeile.toLowerCase()).not.toContain("httponly");
  });

  it("setzt keinen Cookie bei anderen Ansichten", async () => {
    mocks.getAuthContext.mockResolvedValue(NUTZER);
    const res = await put("leads", GEPRUEFT);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("setzt keinen Cookie, wenn die Darstellung ungültig ist oder nicht gespeichert wird", async () => {
    mocks.getAuthContext.mockResolvedValue(NUTZER);
    expect((await put("darstellung", "grau")).headers.get("set-cookie")).toBeNull();
    mocks.getAuthContext.mockResolvedValue({ ...NUTZER, authMethod: "api_key", apiKeyAccess: "read" });
    const nurLesen = await put("darstellung", "dunkel");
    expect(nurLesen.status).toBe(403);
    expect(nurLesen.headers.get("set-cookie")).toBeNull();
  });
});
