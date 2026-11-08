import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  confirmKvaForToken: vi.fn(),
  portalEinwilligungSpeichern: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: vi.fn() };
});
vi.mock("@/services/customer-portal-data", () => ({ confirmKvaForToken: mocks.confirmKvaForToken }));
vi.mock("@/services/bewertung-einwilligung-portal", () => ({
  portalEinwilligungSpeichern: mocks.portalEinwilligungSpeichern,
}));

import { POST } from "./route";

const TOKEN = "t".repeat(32);
const BASIS = {
  acceptedOffer: true,
  acceptedAgb: true,
  haftungshinweisBestaetigt: true,
  versicherungGewuenscht: false,
  vorzeitigerBeginnVerlangt: false,
  expectedTotalCents: 120000,
  fullName: "Anna Berger",
};
const post = (body: unknown) =>
  POST(
    new NextRequest(`http://localhost/api/public/${TOKEN}/confirm-kva`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "user-agent": "UA" },
    }),
    { params: Promise.resolve({ token: TOKEN }) }
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.confirmKvaForToken.mockResolvedValue({ ok: true, nachlauf: null });
  mocks.portalEinwilligungSpeichern.mockResolvedValue("gespeichert");
});

describe("POST confirm-kva mit Bewertungs-Haken (Plan 11)", () => {
  it("Annahme bekommt mit und ohne Haken denselben Payload, Antwort identisch", async () => {
    const ohne = await post(BASIS);
    const mit = await post({ ...BASIS, bewertungEinwilligung: true });
    expect(mocks.confirmKvaForToken.mock.calls[0]![1]).toEqual(mocks.confirmKvaForToken.mock.calls[1]![1]);
    expect(mocks.confirmKvaForToken.mock.calls[1]![1]).not.toHaveProperty("bewertungEinwilligung");
    expect(ohne.status).toBe(200);
    expect(mit.status).toBe(200);
    expect(await ohne.json()).toEqual(await mit.json());
  });

  it("speichert nur bei ausdrücklichem true und erst nach erfolgreicher Annahme", async () => {
    await post(BASIS);
    await post({ ...BASIS, bewertungEinwilligung: "true" });
    expect(mocks.portalEinwilligungSpeichern).not.toHaveBeenCalled();
    await post({ ...BASIS, bewertungEinwilligung: true });
    expect(mocks.portalEinwilligungSpeichern).toHaveBeenCalledWith(TOKEN);
    expect(mocks.confirmKvaForToken.mock.invocationCallOrder.at(-1)!).toBeLessThan(
      mocks.portalEinwilligungSpeichern.mock.invocationCallOrder[0]!
    );
  });

  it("gescheiterte Annahme speichert nichts", async () => {
    mocks.confirmKvaForToken.mockResolvedValue({ ok: false, reason: "price_changed" });
    const res = await post({ ...BASIS, bewertungEinwilligung: true });
    expect(res.status).toBe(409);
    expect(mocks.portalEinwilligungSpeichern).not.toHaveBeenCalled();
  });

  it("Fehler beim Speichern ändert die Antwort nicht", async () => {
    mocks.portalEinwilligungSpeichern.mockRejectedValue(new Error("DB weg"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post({ ...BASIS, bewertungEinwilligung: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { ok: true } });
    err.mockRestore();
  });
});
