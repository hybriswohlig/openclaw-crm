import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  returning: vi.fn(),
  sets: [] as Record<string, unknown>[],
  kick: vi.fn(),
  event: vi.fn(),
  vorher: [{ id: "item-1", name: "Gartensessel", quantity: 1, sizeClass: "mittel", volumeCbmEstimate: null, source: "foto", photoAttachmentId: "att_1" }] as unknown[],
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => mocks.vorher }) }) }),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        mocks.sets.push(value);
        return { where: () => ({ returning: mocks.returning }) };
      },
    }),
  },
}));

vi.mock("@/services/rechner/ausloeser", () => ({
  kalkulationAnstossen: (...args: unknown[]) => mocks.kick(...args),
}));

vi.mock("@/services/activity-events", () => ({ emitEvent: (...args: unknown[]) => mocks.event(...args) }));

import { PATCH } from "./route";

function patch(body: unknown) {
  return PATCH(
    new NextRequest("https://crm.test/api/v1/deals/deal-1/inventory/item-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ recordId: "deal-1", itemId: "item-1" }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sets = [];
  mocks.getAuthContext.mockResolvedValue({
    userId: "usr_dario",
    workspaceId: "ws_kottke",
    workspaceRole: "admin",
    permissions: {},
    authMethod: "session",
  });
  mocks.returning.mockResolvedValue([{ id: "item-1", dismantlingOwner: "company" }]);
});

describe("PATCH inventory item", () => {
  it("rejects an owner outside company, customer, none and writes nothing", async () => {
    const res = await patch({ abbau: "team" });
    expect(res.status).toBe(400);
    expect(mocks.sets).toEqual([]);
    expect(mocks.kick).not.toHaveBeenCalled();
  });

  it("stores Abbau and Aufbau and marks disassembly when we do the work", async () => {
    const res = await patch({ abbau: "company", assemblyOwner: "customer" });
    expect(res.status).toBe(200);
    expect(mocks.sets[0]).toMatchObject({
      source: "operator",
      dismantlingOwner: "company",
      assemblyOwner: "customer",
      disassemblyRequired: true,
    });
    expect(mocks.kick).toHaveBeenCalledWith("ws_kottke", "deal-1");
  });

  it("can set an owner back to none without clearing disassemblyRequired", async () => {
    const res = await patch({ aufbau: "none" });
    expect(res.status).toBe(200);
    expect(mocks.sets[0]).toMatchObject({ assemblyOwner: "none", source: "operator" });
    expect(mocks.sets[0]).not.toHaveProperty("disassemblyRequired");
  });
});

describe("PATCH inventory item, Plan 15 (Bauteil 14)", () => {
  it("Name korrigiert: Ereignis mit Lernsignal aus dem Foto, Größe und m³ je Stück", async () => {
    mocks.returning.mockResolvedValue([{ id: "item-1", name: "Gartengrill", quantity: 1, sizeClass: "gross", volumeCbmEstimate: "0.5", source: "operator", photoAttachmentId: "att_1" }]);
    const res = await patch({ name: "Gartengrill", sizeClass: "gross", volumeCbmPerPiece: 0.5 });
    expect(res.status).toBe(200);
    expect(mocks.sets[0]).toMatchObject({ name: "Gartengrill", sizeClass: "gross", volumeCbmEstimate: "0.5", source: "operator" });
    expect(mocks.event.mock.calls[0][0]).toMatchObject({
      eventType: "inventar.korrigiert",
      actorId: "usr_dario",
      payload: { ausFoto: true, text: expect.stringContaining("Foto erkannt: Gartensessel, korrigiert: Gartengrill") },
    });
  });
  it("Nur-Lese-Schlüssel 403", async () => {
    mocks.getAuthContext.mockResolvedValue({ userId: "u", workspaceId: "ws", authMethod: "api_key", apiKeyAccess: "read" });
    expect((await patch({ name: "x" })).status).toBe(403);
  });
  it("ungültige Größe 400", async () => {
    expect((await patch({ sizeClass: "riesig" })).status).toBe(400);
  });
});
