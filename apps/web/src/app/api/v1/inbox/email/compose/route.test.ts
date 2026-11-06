import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  sendNewEmail: vi.fn(),
  vermerk: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/inbox-email", () => {
  class EmailUserError extends Error {}
  return {
    sendNewEmail: (...args: unknown[]) => mocks.sendNewEmail(...args),
    EmailUserError,
  };
});

vi.mock("@/services/inbox-senden", () => ({
  vermerkeEigeneNachricht: (...args: unknown[]) => mocks.vermerk(...args),
}));

import { POST } from "./route";

const EINGABE = { channelAccountId: "ch-mail", to: "anna@example.de", subject: "Umzug", body: "Hallo Anna" };

function send(body: Record<string, unknown>) {
  return POST(
    new NextRequest("https://crm.test/api/v1/inbox/email/compose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue({
    userId: "usr_dario",
    workspaceId: "ws_kottke",
    workspaceRole: "admin",
    permissions: {},
    authMethod: "session",
  });
  mocks.vermerk.mockResolvedValue(undefined);
});

describe("POST email compose", () => {
  it("vermerkt die eigene Nachricht am neuen Gespräch", async () => {
    mocks.sendNewEmail.mockResolvedValue({ conversationId: "conv-mail" });
    const res = await send(EINGABE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { conversationId: "conv-mail" } });
    expect(mocks.vermerk).toHaveBeenCalledWith({
      workspaceId: "ws_kottke",
      conversationId: "conv-mail",
      sentAt: expect.any(Date),
    });
  });

  it("kein Vermerk, wenn das Senden scheitert", async () => {
    mocks.sendNewEmail.mockRejectedValue(new Error("smtp down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await send(EINGABE);
    log.mockRestore();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: { code: "SEND_FAILED", message: "Senden fehlgeschlagen" } });
    expect(mocks.vermerk).not.toHaveBeenCalled();
  });

  it("Pflichtfelder fehlen: 400, nichts gesendet", async () => {
    const res = await send({ channelAccountId: "ch-mail", to: "anna@example.de", body: " " });
    expect(res.status).toBe(400);
    expect(mocks.sendNewEmail).not.toHaveBeenCalled();
    expect(mocks.vermerk).not.toHaveBeenCalled();
  });
});
