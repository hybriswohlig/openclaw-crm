import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  zeilen: [] as {
    id: string;
    fileName: string;
    mimeType: string;
    fileContent: string;
    dealRecordId: string | null;
  }[],
  select: vi.fn(),
  interne: vi.fn(async (_ws: string, _ids: string[], _deal?: string) => [] as {
    id: string;
    fileName: string;
    mimeType: string;
    fileContent: string;
    dealRecordId: string | null;
  }[]),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => {
      m.select();
      return { from: () => ({ where: async () => m.zeilen }) };
    },
  },
}));
vi.mock("@/services/deal-photos", () => ({
  findDealInternalPhotosByIds: (ws: string, ids: string[], deal?: string) => m.interne(ws, ids, deal),
}));

import { fotosLaden, vpsJobStarten } from "./vps-dokument-start";

const WS = "ws_kottke";
const MAX_B64 = 12 * 1024 * 1024;

function anhang(teil: Partial<(typeof m.zeilen)[number]> & { id: string }) {
  return {
    fileName: "foto.jpg",
    mimeType: "image/jpeg",
    fileContent: "aGFsbG8=",
    dealRecordId: "deal_1",
    ...teil,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.zeilen = [];
  m.interne.mockResolvedValue([]);
  process.env.CRM_TOOLS_API_URL = "https://crm-tools.test";
  process.env.CRM_TOOLS_AUTH_TOKEN = "tools-token";
});

describe("fotosLaden", () => {
  it("fremder Workspace: 403", async () => {
    const r = await fotosLaden(WS, "deal_1", ["att_fremd"]);
    expect(r).toEqual({
      ok: false,
      status: 403,
      error: "Foto att_fremd gehört nicht zu diesem Workspace.",
    });
    expect(m.interne).toHaveBeenCalledWith(WS, ["att_fremd"], "deal_1");
  });

  it("Foto eines anderen Deals: 403", async () => {
    m.zeilen = [anhang({ id: "att_1", fileName: "wohnung.jpg", dealRecordId: "deal_anders" })];
    const r = await fotosLaden(WS, "deal_1", ["att_1"]);
    expect(r).toEqual({
      ok: false,
      status: 403,
      error: "Foto wohnung.jpg gehört nicht zu diesem Auftrag.",
    });
    expect(m.interne).not.toHaveBeenCalled();
  });

  it("zu groß: 413", async () => {
    m.zeilen = [anhang({ id: "att_1", fileContent: "x".repeat(MAX_B64 + 1) })];
    const r = await fotosLaden(WS, "deal_1", ["att_1"]);
    expect(r).toEqual({
      ok: false,
      status: 413,
      error:
        "Die ausgewählten Fotos sind zu groß für den Dokumentjob. Bitte kleinere Dateien wählen. Es werden keine Dokumente ohne die angeforderten Fotos erzeugt.",
    });
  });

  it("zu viele IDs: 400 ohne Datenbankzugriff", async () => {
    const ids = Array.from({ length: 41 }, (_, i) => `att_${i}`);
    const r = await fotosLaden(WS, "deal_1", ids);
    expect(r).toEqual({
      ok: false,
      status: 400,
      error: "Zu viele Fotos (41). Höchstens 40 Dateien.",
    });
    expect(m.select).not.toHaveBeenCalled();
    expect(m.interne).not.toHaveBeenCalled();
  });

  it("leere Liste: ok ohne Datenbank", async () => {
    const r = await fotosLaden(WS, null, []);
    expect(r).toEqual({ ok: true, images: [] });
    expect(m.select).not.toHaveBeenCalled();
    expect(m.interne).not.toHaveBeenCalled();
  });

  it("Nicht-Bild wird übergangen", async () => {
    m.zeilen = [
      anhang({ id: "att_bild" }),
      anhang({ id: "att_pdf", fileName: "plan.pdf", mimeType: "application/pdf", fileContent: "cGRm" }),
    ];
    const r = await fotosLaden(WS, "deal_1", ["att_bild", "att_pdf"]);
    expect(r).toEqual({
      ok: true,
      images: [{ filename: "foto.jpg", mime: "image/jpeg", base64: "aGFsbG8=" }],
    });
  });

  it("Erfolg liefert filename, mime und base64", async () => {
    m.zeilen = [anhang({ id: "att_1", fileName: "kueche.png", mimeType: "image/png", fileContent: "cG5n" })];
    const r = await fotosLaden(WS, "deal_1", ["att_1"]);
    expect(r).toEqual({
      ok: true,
      images: [{ filename: "kueche.png", mime: "image/png", base64: "cG5n" }],
    });
  });

  it("fehlende Inbox-Anhänge kommen aus den internen Deal-Fotos", async () => {
    m.interne.mockResolvedValue([
      anhang({ id: "ph_1", fileName: "flur.jpg", fileContent: "Zmx1cg==" }),
    ]);
    const r = await fotosLaden(WS, "deal_1", ["ph_1"]);
    expect(m.interne).toHaveBeenCalledWith(WS, ["ph_1"], "deal_1");
    expect(r).toEqual({
      ok: true,
      images: [{ filename: "flur.jpg", mime: "image/jpeg", base64: "Zmx1cg==" }],
    });
  });
});

describe("vpsJobStarten", () => {
  const eingabe = {
    ws: WS,
    userId: "usr_1",
    skill: "kv/test",
    params: { document_type: "KV", _workspace_id: "fremd" },
    timeoutSec: 90,
  };

  it("schickt URL, Header und Body und liefert die Job-ID", async () => {
    const abruf = vi.fn(async () => new Response(JSON.stringify({ job_id: "job_42", extra: 1 }), { status: 200 }));
    const r = await vpsJobStarten(eingabe, abruf);
    expect(r).toEqual({ ok: true, jobId: "job_42", data: { job_id: "job_42", extra: 1 } });
    expect(abruf).toHaveBeenCalledWith("https://crm-tools.test/skills/kv%2Ftest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer tools-token",
      },
      body: JSON.stringify({
        params: { document_type: "KV", _workspace_id: WS, _user_id: "usr_1" },
        timeout_sec: 90,
      }),
    });
  });

  it("2xx ohne job_id: ok false mit Status 200", async () => {
    const abruf = vi.fn(async () => new Response(JSON.stringify({ status: "queued" }), { status: 200 }));
    const r = await vpsJobStarten(eingabe, abruf);
    expect(r).toEqual({ ok: false, status: 200, data: { status: "queued" } });
  });

  it("500: ok false mit den Antwortdaten", async () => {
    const abruf = vi.fn(async () => new Response(JSON.stringify({ detail: "kaputt" }), { status: 500 }));
    const r = await vpsJobStarten(eingabe, abruf);
    expect(r).toEqual({ ok: false, status: 500, data: { detail: "kaputt" } });
  });

  it("Netzfehler wirft", async () => {
    const abruf = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(vpsJobStarten(eingabe, abruf)).rejects.toThrow("ECONNREFUSED");
  });

  it("fehlende Umgebung wirft", async () => {
    delete process.env.CRM_TOOLS_API_URL;
    delete process.env.CRM_TOOLS_AUTH_TOKEN;
    const abruf = vi.fn();
    await expect(vpsJobStarten(eingabe, abruf)).rejects.toThrow("crm-tools env not configured");
    expect(abruf).not.toHaveBeenCalled();
  });
});
