import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ anmeldung: null as unknown, adresse: vi.fn(), bild: vi.fn() }));
vi.mock("@/services/crew/auth", () => ({ requireCrew: async () => m.anmeldung }));
vi.mock("@/services/crew/briefing", () => ({ briefingStoppAdresse: m.adresse }));
vi.mock("@/services/street-view", () => ({
  fetchStreetView: m.bild,
  StreetViewConfigError: class extends Error {},
}));

const { GET } = await import("./route");
const k = (id = "e1") => ({ workspaceId: "w1", linkId: "l1", employee: { id } });
const req = () => new NextRequest("http://x/api/crew/v1/jobs/d1/briefing/streetview/from");
const params = (dealId: string, stop = "from") => ({ params: Promise.resolve({ dealId, stop }) });
const zustand = () => (globalThis as unknown as { __crewStreetView: { speicher: Map<string, unknown>; zaehler: Map<string, unknown> } }).__crewStreetView;

describe("GET /api/crew/v1/jobs/:dealId/briefing/streetview/:stop", () => {
  beforeEach(() => {
    m.anmeldung = { ok: true, k: k() };
    m.adresse.mockReset().mockResolvedValue("Hauptstraße 5, Stuttgart");
    m.bild.mockReset().mockResolvedValue({ bytes: Buffer.from([1, 2, 3]), mime: "image/jpeg", panoId: "p" });
    zustand()?.speicher.clear();
    zustand()?.zaehler.clear();
  });

  it("liefert das Bild nur mit Zugang; falscher Stopp oder kein Zugang 404 ohne Google", async () => {
    const r = await GET(req(), params("d1"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/jpeg");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect((await GET(req(), params("d1", "x"))).status).toBe(404);
    m.adresse.mockResolvedValue(null);
    expect((await GET(req(), params("d2"))).status).toBe(404);
    expect(m.bild).toHaveBeenCalledTimes(1);
  });

  it("Zugang während des Abrufs entzogen: kein Bild", async () => {
    m.adresse.mockResolvedValueOnce("Hauptstraße 5, Stuttgart").mockResolvedValueOnce(null);
    expect((await GET(req(), params("d1"))).status).toBe(404);
  });

  it("gleichzeitige Abrufe gehen einmal zu Google, danach aus dem Speicher", async () => {
    const rs = await Promise.all([GET(req(), params("d1")), GET(req(), params("d1")), GET(req(), params("d1"))]);
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
    expect((await GET(req(), params("d1"))).status).toBe(200);
    expect(m.bild).toHaveBeenCalledTimes(1);
  });

  it("kein Bild bei Google wird gemerkt; Obergrenze je Person", async () => {
    m.bild.mockResolvedValue(null);
    expect((await GET(req(), params("d1"))).status).toBe(404);
    expect((await GET(req(), params("d1"))).status).toBe(404);
    expect(m.bild).toHaveBeenCalledTimes(1);
    m.bild.mockResolvedValue({ bytes: Buffer.from([1]), mime: "image/jpeg", panoId: null });
    for (let i = 0; i < 45; i++) {
      m.adresse.mockResolvedValue(`Weg ${i}`);
      await GET(req(), params("d1"));
    }
    expect(m.bild.mock.calls.length).toBeLessThanOrEqual(40);
  });
});
