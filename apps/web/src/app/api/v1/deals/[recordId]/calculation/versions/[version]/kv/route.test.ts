import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  dealImWorkspace: vi.fn(),
  lesen: vi.fn(),
  liste: vi.fn(),
  angebotsVersionId: vi.fn(),
  dealBlocksInRepoCrmRenderer: vi.fn(),
  storeCommercialDocument: vi.fn(),
}));

// Kein Zugriff auf die Datenbank: jeder Zugriff auf `db` lässt den Test scheitern.
vi.mock("@/db", () => ({
  db: new Proxy({}, { get(_t, p) { if (p === "then" || typeof p === "symbol") return undefined; throw new Error(`@/db im Test (${String(p)})`); } }),
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/lib/kalkulation-versionen-antwort", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/kalkulation-versionen-antwort")>();
  return { ...actual, dealImWorkspace: mocks.dealImWorkspace };
});
// Der echte Dienst `kvAusVersion` läuft; nur seine DB-Lader und der Renderer sind ersetzt.
vi.mock("@/services/kalkulation-versionen-speicher", () => ({
  dbVersionsSpeicher: { lesen: mocks.lesen, liste: mocks.liste },
}));
vi.mock("@/services/deal-documents", () => ({ angebotsVersionId: mocks.angebotsVersionId }));
vi.mock("@/lib/kottke-crm-renderer-deal", () => ({
  dealBlocksInRepoCrmRenderer: mocks.dealBlocksInRepoCrmRenderer,
}));
vi.mock("@/services/commercial-documents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/commercial-documents")>();
  return { ...actual, storeCommercialDocument: mocks.storeCommercialDocument };
});

import { POST } from "./route";
import { CommercialDocumentError } from "@/services/commercial-documents";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "api_key" as const, apiKeyAccess: "full" as const };
const req = (body?: unknown) =>
  new NextRequest("http://localhost/api/v1/deals/deal_1/calculation/versions/2/kv", {
    method: "POST",
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const p = (version = "2") => ({ params: Promise.resolve({ recordId: "deal_1", version }) });
const DOKUMENT = {
  id: "doc_1",
  documentType: "quotation",
  fileName: "KV-CE-20261106-WEB-ab12cd34.pdf",
  fileSize: 4,
  mimeType: "application/pdf",
  uploadedAt: "2026-11-06T10:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.dealImWorkspace.mockResolvedValue(true);
  mocks.lesen.mockResolvedValue({ id: "ver_2", version: 2, status: "gesperrt" });
  mocks.liste.mockResolvedValue([{ id: "ver_2", version: 2, status: "gesperrt" }]);
  mocks.angebotsVersionId.mockResolvedValue("ver_2");
  mocks.dealBlocksInRepoCrmRenderer.mockResolvedValue(false);
  mocks.storeCommercialDocument.mockResolvedValue({
    document: DOKUMENT,
    fileName: DOKUMENT.fileName,
    templateVersion: "t",
    rechnungFaelligAm: null,
  });
});

describe("POST /calculation/versions/[version]/kv", () => {
  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await POST(req(), p())).status).toBe(401);
  });

  it("Deal aus fremdem Workspace → 404, nichts gerendert", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    const res = await POST(req(), p());
    expect(res.status).toBe(404);
    expect(mocks.dealImWorkspace).toHaveBeenCalledWith("ws_1", "deal_1");
    expect(mocks.lesen).not.toHaveBeenCalled();
    expect(mocks.storeCommercialDocument).not.toHaveBeenCalled();
  });

  it("Version nicht numerisch → 400", async () => {
    expect((await POST(req(), p("v2"))).status).toBe(400);
    expect(mocks.lesen).not.toHaveBeenCalled();
  });

  it("Kottke → 200 mit renderer vps und Hinweis, kein CRM-PDF (Review Focus 5)", async () => {
    mocks.dealBlocksInRepoCrmRenderer.mockResolvedValue(true);
    const res = await POST(req(), p());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      renderer: "vps",
      hinweis: "Kottke-KV über „Dokument erzeugen“ erstellen; die Preise kommen aus Version v2.",
    });
    expect(mocks.storeCommercialDocument).not.toHaveBeenCalled();
    expect(mocks.lesen).toHaveBeenCalledWith("ws_1", "deal_1", 2);
  });

  it("Nicht-Kottke → 200 mit Dokument; Texte ohne Preisangaben, notifyCustomer false", async () => {
    const res = await POST(
      req({ copy: { intro: "Gern bieten wir an. Der Preis beträgt 1.250 €. Wir freuen uns.", remarks: "3 Helfer" } }),
      p()
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ renderer: "crm", document: DOKUMENT, fileName: DOKUMENT.fileName });
    expect(mocks.storeCommercialDocument).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      dealRecordId: "deal_1",
      kind: "KV",
      copy: { intro: "Gern bieten wir an. Wir freuen uns.", remarks: "3 Helfer" },
      notifyCustomer: false,
      updatedBy: "usr_1",
      pruefeVersion: expect.any(Function),
    });
  });

  it("leerer Body und notifyCustomer im Body → trotzdem notifyCustomer false", async () => {
    expect((await POST(req(), p())).status).toBe(200);
    await POST(req({ notifyCustomer: true }), p());
    for (const [arg] of mocks.storeCommercialDocument.mock.calls) {
      expect(arg).toMatchObject({ notifyCustomer: false, copy: {} });
    }
  });

  it("copy kein Objekt → 400", async () => {
    const res = await POST(req({ copy: "Hallo" }), p());
    expect(res.status).toBe(400);
    expect(mocks.storeCommercialDocument).not.toHaveBeenCalled();
  });

  it("Entwurf → 400 UNGUELTIG mit Text", async () => {
    mocks.lesen.mockResolvedValue({ id: "ver_2", version: 2, status: "entwurf" });
    const res = await POST(req(), p());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual({ code: "UNGUELTIG", message: "Version v2 ist nicht gesperrt." });
  });

  it("Angebot von Hand geändert → 400 UNGUELTIG mit Text", async () => {
    mocks.angebotsVersionId.mockResolvedValue(null);
    const res = await POST(req(), p());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual({
      code: "UNGUELTIG",
      message: "Das Angebot wurde nach v2 von Hand geändert. Neue Version sperren.",
    });
  });

  it("neuere gesperrte Version → 400 UNGUELTIG „nicht mehr aktuell“", async () => {
    mocks.angebotsVersionId.mockResolvedValue("ver_3");
    mocks.liste.mockResolvedValue([
      { id: "ver_2", version: 2, status: "gesperrt" },
      { id: "ver_3", version: 3, status: "gesperrt" },
    ]);
    const res = await POST(req(), p());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual({
      code: "UNGUELTIG",
      message: "Version v2 ist nicht mehr aktuell, aktuell ist v3.",
    });
    expect(mocks.liste).toHaveBeenCalledWith("ws_1", "deal_1");
  });

  it("Version fehlt → 404 NICHT_GEFUNDEN", async () => {
    mocks.lesen.mockResolvedValue(null);
    const res = await POST(req(), p());
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NICHT_GEFUNDEN");
  });

  it("CommercialDocumentError → dessen Status und Code", async () => {
    mocks.storeCommercialDocument.mockRejectedValue(new CommercialDocumentError("Kundenname fehlt auf dem Auftrag.", 400));
    const res = await POST(req(), p());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual({ code: "BAD_REQUEST", message: "Kundenname fehlt auf dem Auftrag." });
  });

  it("unbekannter Renderfehler → 500 RENDER_FAILED", async () => {
    const fehler = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.storeCommercialDocument.mockRejectedValue(new Error("Chromium weg"));
    const res = await POST(req(), p());
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("RENDER_FAILED");
    fehler.mockRestore();
  });
});
