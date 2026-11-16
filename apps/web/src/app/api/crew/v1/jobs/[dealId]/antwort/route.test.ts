import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { crewFehler } from "@/lib/crew/antwort";

const m = vi.hoisted(() => ({ anmeldung: null as unknown, setzen: vi.fn() }));
vi.mock("@/services/crew/auth", () => ({ requireCrew: async () => m.anmeldung }));
vi.mock("@/services/crew/antwort", () => ({ antwortSetzen: m.setzen }));

const { POST } = await import("./route");
const k = { workspaceId: "w1", linkId: "l1", employee: { id: "e1" } };
const req = (body: unknown) => new NextRequest("http://x/api/crew/v1/jobs/d1/antwort", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const params = (dealId = "d1") => ({ params: Promise.resolve({ dealId }) });

describe("POST /api/crew/v1/jobs/:dealId/antwort", () => {
  beforeEach(() => {
    m.anmeldung = { ok: true, k };
    m.setzen.mockReset().mockResolvedValue({ ok: true, job: { id: "d1" } });
  });

  it("ohne Anmeldung: Antwort von requireCrew unverändert, kein Dienst", async () => {
    m.anmeldung = { ok: false, antwort: crewFehler("UNAUTHORIZED") };
    const r = await POST(req({ answer: "ja" }), params());
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(m.setzen).not.toHaveBeenCalled();
  });

  it("falscher Körper 400 UNGUELTIG", async () => {
    for (const b of ["kaputt", {}, { answer: "warteliste" }, { answer: "bestaetigt" }, { answer: 1 }]) {
      const r = await POST(req(b), params());
      expect(r.status).toBe(400);
      expect((await r.json()).error).toBe("UNGUELTIG");
    }
    expect(m.setzen).not.toHaveBeenCalled();
  });

  it("komische Deal-ID 404 JOB_NICHT_SICHTBAR", async () => {
    const r = await POST(req({ answer: "ja" }), params("../x"));
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "JOB_NICHT_SICHTBAR" });
  });

  it("reicht ja, vielleicht, nein und null durch; Antwort { job }", async () => {
    for (const a of ["ja", "vielleicht", "nein", null]) {
      const r = await POST(req({ answer: a }), params());
      expect(r.status).toBe(200);
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(await r.json()).toEqual({ job: { id: "d1" } });
      expect(m.setzen).toHaveBeenLastCalledWith(k, "d1", a);
    }
  });

  it("Fehler des Dienstes mit Code und Status aus dem Vertrag", async () => {
    m.setzen.mockResolvedValueOnce({ ok: false, code: "BEREITS_BESTAETIGT" });
    let r = await POST(req({ answer: null }), params());
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "BEREITS_BESTAETIGT" });
    m.setzen.mockResolvedValueOnce({ ok: false, code: "JOB_NICHT_SICHTBAR" });
    r = await POST(req({ answer: "ja" }), params());
    expect(r.status).toBe(404);
  });
});
