import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  send: vi.fn(),
  close: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/agent/draft-senden", () => ({
  entwurfFreigebenUndSenden: (...args: unknown[]) => mocks.send(...args),
}));

vi.mock("@/services/agent/draft-schliessen", () => ({
  closeDraftWithoutSending: (...args: unknown[]) => mocks.close(...args),
}));

import { PATCH } from "./route";

const DRAFT = "6e9256ac-a253-4b4e-b49d-0a7845e9f940";

function patch(body: unknown) {
  return PATCH(
    new NextRequest(`https://crm.test/api/v1/agent-drafts/${DRAFT}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: DRAFT }) }
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
});

describe("PATCH agent draft", () => {
  it("forwards humanApproved and overrideConsent on approve_and_send", async () => {
    mocks.send.mockResolvedValue({ ok: true, text: "Hallo" });
    const res = await patch({
      action: "approve_and_send",
      humanApproved: true,
      approvedBy: "Dario",
      note: "freigegeben",
      overrideConsent: true,
      finalText: "Hallo zusammen",
    });
    expect(res.status).toBe(200);
    expect(mocks.send).toHaveBeenCalledWith({
      workspaceId: "ws_kottke",
      userId: "usr_dario",
      draftId: DRAFT,
      finalText: "Hallo zusammen",
      humanApproved: true,
      approvedBy: "Dario",
      note: "freigegeben",
      overrideConsent: true,
    });
  });

  it("returns 409 gate_blocked with the remaining reasons", async () => {
    mocks.send.mockResolvedValue({
      ok: false,
      fehler: "gate_blocked",
      reasons: ["no_proactive_consent"],
    });
    const res = await patch({ action: "approve_and_send", humanApproved: true });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "gate_blocked",
      reasons: ["no_proactive_consent"],
    });
  });

  it("closes a draft with dismiss or mark_taken and reports an idempotent close", async () => {
    mocks.close.mockResolvedValue({ updated: true, status: "superseded", idempotent: true });
    const res = await patch({ action: "mark_taken" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { updated: true, status: "superseded", idempotent: true },
    });
    expect(mocks.close).toHaveBeenCalledWith({
      workspaceId: "ws_kottke",
      draftId: DRAFT,
      userId: "usr_dario",
      action: "mark_taken",
    });

    mocks.close.mockResolvedValue({ updated: true, status: "dismissed" });
    const dismissed = await patch({ action: "dismiss" });
    expect(dismissed.status).toBe(200);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("rejects an unknown action", async () => {
    const res = await patch({ action: "send_now" });
    expect(res.status).toBe(400);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("rejects a bad attachment before claiming the draft", async () => {
    const res = await patch({
      action: "approve_and_send",
      attachments: [{ filename: "angebot.pdf" }],
    });
    expect(res.status).toBe(400);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("forwards document attachments on approve_and_send", async () => {
    mocks.send.mockResolvedValue({ ok: true, text: "Hallo" });
    const res = await patch({
      action: "approve_and_send",
      humanApproved: true,
      attachments: [{ dealDocumentId: "doc-1" }],
      idempotencyKey: "send-1",
    });
    expect(res.status).toBe(200);
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [{ kind: "dealDocument", dealDocumentId: "doc-1" }],
        idempotencyKey: "send-1",
      })
    );
  });
});
