import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { beispielAntwort } from "@/lib/lagekarte/beispiel-daten";
import type { ChatVorschauAntwort } from "@/lib/lagekarte/typen";

// Vertragstest der beiden Lagekarte-Routen, Technik wie ../contract.test.ts:
// nur die DB-Schicht (@/services/lagekarte) und getAuthContext werden
// gemockt; success/unauthorized/notFound bleiben echt, damit Statuscodes und
// Hüllen die sind, die in Produktion ausgeliefert werden.
const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  ladeLagekarte: vi.fn(),
  ladeChatVorschau: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/lagekarte", () => ({
  ladeLagekarte: mocks.ladeLagekarte,
  ladeChatVorschau: mocks.ladeChatVorschau,
}));

import * as lagekarteRoute from "./route";
import * as chatRoute from "./chat/[conversationId]/route";

const WORKSPACE_ID = "ws_kottke_test";
const AUTH_CTX = {
  userId: "usr_1",
  workspaceId: WORKSPACE_ID,
  workspaceRole: "member" as const,
  permissions: {},
  authMethod: "cookie" as const,
};

const VORSCHAU: ChatVorschauAntwort = {
  chat: {
    id: "conv-1",
    kanal: "whatsapp",
    kontoName: "Kottke WhatsApp",
    firmaId: "firma-kottke",
    status: "open",
    letzteNachrichtAm: "2026-10-08T05:12:00.000Z",
    vorschau: "Hallo, passt der Termin?",
    ungelesen: 1,
    kundeZuletzt: true,
  },
  nachrichten: [
    { id: "m1", richtung: "outbound", text: "Guten Tag!", zeit: "2026-10-07T16:00:00.000Z", status: "read", anhaenge: 0, anhangArt: null },
    { id: "m2", richtung: "inbound", text: "Hallo, passt der Termin?", zeit: "2026-10-08T05:12:00.000Z", status: "received", anhaenge: 0, anhangArt: null },
    { id: "m3", richtung: "inbound", text: "2 Fotos", zeit: "2026-10-08T05:13:00.000Z", status: "received", anhaenge: 2, anhangArt: "foto" },
  ],
  mehr: false,
};

const lagekarteGET = () => lagekarteRoute.GET(new NextRequest("https://crm.test/api/v1/lagekarte"));
const chatGET = (conversationId: string) =>
  chatRoute.GET(new NextRequest(`https://crm.test/api/v1/lagekarte/chat/${conversationId}`), {
    params: Promise.resolve({ conversationId }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(AUTH_CTX);
  mocks.ladeLagekarte.mockResolvedValue(beispielAntwort());
  mocks.ladeChatVorschau.mockResolvedValue(VORSCHAU);
});

describe("GET /api/v1/lagekarte", () => {
  it("ohne Anmeldung: 401 UNAUTHORIZED, lädt nichts", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    const res = await lagekarteGET();

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
    expect(mocks.ladeLagekarte).not.toHaveBeenCalled();
  });

  it("mit Anmeldung: 200 mit { data: LagekarteAntwort } für den Workspace des Aufrufers", async () => {
    const res = await lagekarteGET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: beispielAntwort() });
    expect(mocks.ladeLagekarte).toHaveBeenCalledTimes(1);
    expect(mocks.ladeLagekarte).toHaveBeenCalledWith(WORKSPACE_ID);
  });

  it("wird nie statisch gecacht", () => {
    expect(lagekarteRoute.dynamic).toBe("force-dynamic");
  });
});

describe("GET /api/v1/lagekarte/chat/{conversationId}", () => {
  it("ohne Anmeldung: 401 UNAUTHORIZED, lädt nichts", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    const res = await chatGET("conv-1");

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
    expect(mocks.ladeChatVorschau).not.toHaveBeenCalled();
  });

  it("ohne Treffer (fremder Workspace oder unbekannte ID): 404 NOT_FOUND", async () => {
    mocks.ladeChatVorschau.mockResolvedValue(null);
    const res = await chatGET("conv-fremd");

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(mocks.ladeChatVorschau).toHaveBeenCalledWith(WORKSPACE_ID, "conv-fremd");
  });

  it("mit Treffer: 200 mit { data: ChatVorschauAntwort }, gescoped auf Workspace und Conversation", async () => {
    const res = await chatGET("conv-1");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: VORSCHAU });
    expect(mocks.ladeChatVorschau).toHaveBeenCalledTimes(1);
    expect(mocks.ladeChatVorschau).toHaveBeenCalledWith(WORKSPACE_ID, "conv-1");
  });

  it("wird nie statisch gecacht", () => {
    expect(chatRoute.dynamic).toBe("force-dynamic");
  });
});
