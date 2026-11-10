import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Plan 5a, Entscheidung 6: nach erfolgreichem Upstream legt tools/run für den
// Skill `rechnungen-und-auftragsbestaetigungen` mit Deal einen Register-Eintrag an.
// Version und Preis kommen aus derselben Lesung wie die Preise an den VPS.

const m = vi.hoisted(() => {
  process.env.CRM_TOOLS_API_URL = "https://crm-tools.test";
  process.env.CRM_TOOLS_AUTH_TOKEN = "tools-token";
  return {
    getAuthContext: vi.fn(),
    attachDocumentJobContext: vi.fn(),
    assertDealInWorkspace: vi.fn(),
    jobAnlegen: vi.fn(),
    reservieren: vi.fn(),
    verwerfen: vi.fn(),
    vorschlag: vi.fn(),
    sperren: vi.fn(),
    lesen: vi.fn(),
    dbUpdate: vi.fn(),
    leadAuszug: vi.fn((_deal: unknown): unknown => null),
  };
});

vi.mock("@/lib/api-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-utils")>()),
  getAuthContext: m.getAuthContext,
}));
vi.mock("@/db", () => ({
  db: {
    transaction: async (fn: (tx: unknown) => unknown) => fn({ tx: true }),
    update: () => ({ set: (v: unknown) => ({ where: () => m.dbUpdate(v) }) }),
  },
}));
vi.mock("@/services/quotations", () => ({ angebotSperren: m.sperren, quotationLesen: m.lesen }));
vi.mock("@/services/rechnungen", () => ({
  angebotsStandAus: () => "stand-1",
  rechnungPruefenUndReservieren: m.reservieren,
  rechnungVerwerfen: m.verwerfen,
  rechnungsVorschlag: m.vorschlag,
}));
vi.mock("@/services/deal-photos", () => ({ findDealInternalPhotosByIds: vi.fn(async () => []) }));
vi.mock("@/services/doc-customer-name", () => ({
  rewriteKundeParamsFromDeal: async (_ws: string, p: Record<string, unknown>) => p,
}));
vi.mock("@/services/doc-kunde-adresse", async (importOriginal) => {
  const echt = await importOriginal<typeof import("@/services/doc-kunde-adresse")>();
  // Lead-Auszug je Deal, wie ihn der Server lesen würde.
  return { ...echt, kundeAdresseErgaenzen: async (_ws: string, p: Record<string, unknown>) => echt.adresseErgaenzt(p, m.leadAuszug(p._deal_record_id)) };
});
vi.mock("@/services/document-job-context", () => ({
  attachDocumentJobContext: m.attachDocumentJobContext,
  assertDealInWorkspace: m.assertDealInWorkspace,
}));
vi.mock("@/services/render-jobs", () => ({ jobAnlegen: m.jobAnlegen }));

import { POST } from "./route";

const WS = "ws_kottke";
const fetchMock = vi.fn();

/** Vollständige Kundendaten; ohne sie startet tools/run keinen Dokumentjob (KV-Anschrift). */
const KUNDE = { vorname: "Viktoria", nachname: "Muster", adresse: "Hauptstr. 1, 72218 Wildberg" };

function run(skill: string, params: Record<string, unknown>) {
  const p = skill === "rechnungen-und-auftragsbestaetigungen" && !("kunde" in params) ? { kunde: KUNDE, ...params } : params;
  return POST(
    new NextRequest("https://crm.test/api/tools/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skill, params: p }),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ job_id: "job_42" }), { status: 200 }));
  m.getAuthContext.mockResolvedValue({ userId: "usr_1", workspaceId: WS });
  m.jobAnlegen.mockResolvedValue(undefined);
  m.assertDealInWorkspace.mockResolvedValue(true);
  m.attachDocumentJobContext.mockImplementation(async (_ws: string, p: Record<string, unknown>) => ({
    params: { ...p, preise: { modell: "pauschale" } },
    kv: p.document_type === "KV" ? { calculationVersionId: "ver_3", priceCents: 172000 } : null,
    re:
      p.document_type === "RE"
        ? { istStunden: p._stunden === true, pdfBetragCent: p._stunden === true ? null : 90000, angebotsStand: "stand-1", firma: "kottke" }
        : null,
  }));
  m.lesen.mockResolvedValue({ lineItems: [] });
  m.reservieren.mockImplementation(async (_tx: unknown, e: { eingabe: { bruttoCent: number | null } }) => ({
    id: "inv_1",
    nummer: "RE-2026-0007",
    bruttoCent: e.eingabe.bruttoCent ?? 90000,
    faelligAm: "2026-11-21",
  }));
  m.verwerfen.mockResolvedValue(undefined);
  m.vorschlag.mockResolvedValue(null);
  m.leadAuszug.mockImplementation(() => null);
});

describe("POST /api/tools/run: Job-Register", () => {
  it("KV mit Deal: Eintrag mit Version und Preis aus dem Dokumentkontext", async () => {
    const res = await run("rechnungen-und-auftragsbestaetigungen", {
      firma: "kottke",
      document_type: "KV",
      _deal_record_id: "deal_1",
      _calculation_version_id: "ver_browser",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ job_id: "job_42" });
    expect(m.jobAnlegen).toHaveBeenCalledWith({
      vpsJobId: "job_42",
      workspaceId: WS,
      dealRecordId: "deal_1",
      documentType: "quotation",
      calculationVersionId: "ver_3",
      priceCents: 172000,
      createdBy: "usr_1",
      invoiceId: null,
    });
    // An den VPS gehen die Parameter aus dem Kontext, nicht die Version aus dem Browser.
    const gesendet = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(gesendet.params.preise).toEqual({ modell: "pauschale" });
  });

  it("AB ohne Version und Preis; Rechnung mit Datensatz und Betrag (Plan 9)", async () => {
    await run("rechnungen-und-auftragsbestaetigungen", { document_type: "AB", _deal_record_id: "deal_1" });
    await run("rechnungen-und-auftragsbestaetigungen", { document_type: "RE", _deal_record_id: "deal_1" });
    expect(
      m.jobAnlegen.mock.calls.map((c) => [c[0].documentType, c[0].calculationVersionId, c[0].priceCents, c[0].invoiceId])
    ).toEqual([
      ["order_confirmation", null, null, null],
      ["invoice", null, 90000, "inv_1"],
    ]);
    expect(m.dbUpdate).toHaveBeenCalledWith({ renderJobId: "job_42" });
  });

  it("ohne Deal: kein Eintrag", async () => {
    const res = await run("rechnungen-und-auftragsbestaetigungen", { document_type: "KV" });
    expect(res.status).toBe(200);
    expect(m.jobAnlegen).not.toHaveBeenCalled();
  });

  it("Auftragsanweisung mit Deal: Eintrag als worker_instructions (Fund 4)", async () => {
    const res = await run("auftragsanweisung", { _deal_record_id: "deal_1" });
    expect(res.status).toBe(200);
    expect(m.assertDealInWorkspace).toHaveBeenCalledWith(WS, "deal_1");
    expect(m.jobAnlegen).toHaveBeenCalledWith({
      vpsJobId: "job_42",
      workspaceId: WS,
      dealRecordId: "deal_1",
      documentType: "worker_instructions",
      calculationVersionId: null,
      priceCents: null,
      createdBy: "usr_1",
      invoiceId: null,
    });
  });

  it("Auftragsanweisung mit fremdem Deal: 400, kein Job, kein Eintrag", async () => {
    m.assertDealInWorkspace.mockResolvedValue(false);
    const res = await run("auftragsanweisung", { _deal_record_id: "deal_x" });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(m.jobAnlegen).not.toHaveBeenCalled();
  });

  it("Auftragsanweisung ohne Deal und echo-test: kein Eintrag", async () => {
    await run("auftragsanweisung", {});
    await run("echo-test", { _deal_record_id: "deal_1", document_type: "KV" });
    expect(m.jobAnlegen).not.toHaveBeenCalled();
  });

  it("Upstream-Fehler: kein Eintrag", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ detail: "kaputt" }), { status: 500 }));
    const res = await run("rechnungen-und-auftragsbestaetigungen", { document_type: "KV", _deal_record_id: "deal_1" });
    expect(res.status).toBe(500);
    expect(m.jobAnlegen).not.toHaveBeenCalled();
  });

  it("fremder Deal: 400 aus dem Dokumentkontext, kein Job, kein Eintrag", async () => {
    m.attachDocumentJobContext.mockRejectedValue(new Error("Auftrag gehört nicht zu diesem Workspace."));
    const res = await run("rechnungen-und-auftragsbestaetigungen", { document_type: "KV", _deal_record_id: "deal_x" });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(m.jobAnlegen).not.toHaveBeenCalled();
  });

  it("Register schlägt fehl: sichtbarer Fehler statt stiller Job ohne Ablage", async () => {
    m.jobAnlegen.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await run("rechnungen-und-auftragsbestaetigungen", { document_type: "KV", _deal_record_id: "deal_1" });
    expect(res.status).toBe(500);
  });
});

describe("POST /api/tools/run: Rechnung (Plan 9)", () => {
  function upstreamParams(): Record<string, unknown> {
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    return body.params;
  }

  it("prüft unter der Sperre, reserviert vor dem VPS und schickt die Nummer mit", async () => {
    const res = await run("rechnungen-und-auftragsbestaetigungen", {
      document_type: "RE",
      _deal_record_id: "deal_1",
      _rechnung: { bruttoCent: 90000, abweichungGrund: null },
    });
    expect(res.status).toBe(200);
    expect(m.sperren).toHaveBeenCalledWith({ tx: true }, "deal_1");
    expect(m.reservieren).toHaveBeenCalledWith(
      { tx: true },
      expect.objectContaining({ herkunft: "vps", pdfBetragCent: 90000, durchAgent: false, deal: "deal_1" })
    );
    const p = upstreamParams();
    expect(p.rechnungsnummer).toBe("RE-2026-0007");
    expect(p.faellig_am).toBe("2026-11-21");
    expect(p._rechnung).toBeUndefined();
  });

  it("Prüfung scheitert: 409 mit Code, kein VPS-Aufruf, kein Register", async () => {
    const { GeldFehler } = await import("@/lib/geld");
    m.reservieren.mockRejectedValue(new GeldFehler("RECHNUNG_WEICHT_AB"));
    const res = await run("rechnungen-und-auftragsbestaetigungen", { document_type: "RE", _deal_record_id: "deal_1" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("RECHNUNG_WEICHT_AB");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(m.jobAnlegen).not.toHaveBeenCalled();
  });

  it("Angebot hat sich seit dem Lesen geändert: 409, nichts reserviert", async () => {
    m.lesen.mockResolvedValue(null);
    const res = await run("rechnungen-und-auftragsbestaetigungen", { document_type: "RE", _deal_record_id: "deal_1" });
    expect(res.status).toBe(409);
    expect(m.reservieren).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Agent (API-Schlüssel) wird als Agent geprüft", async () => {
    m.getAuthContext.mockResolvedValue({ userId: "usr_1", workspaceId: WS, authMethod: "api_key" });
    await run("rechnungen-und-auftragsbestaetigungen", { document_type: "RE", _deal_record_id: "deal_1" });
    expect(m.reservieren).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ durchAgent: true }));
  });

  it("VPS-Fehler beim Start: Rechnung sofort verworfen", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ detail: "kaputt" }), { status: 502 }));
    const res = await run("rechnungen-und-auftragsbestaetigungen", { document_type: "RE", _deal_record_id: "deal_1" });
    expect(res.status).toBe(502);
    expect(m.verwerfen).toHaveBeenCalledWith(WS, "inv_1", "VPS-Fehler 502");
    expect(m.jobAnlegen).not.toHaveBeenCalled();
  });

  it("Stunden-KV: Pauschale mit dem bestätigten Betrag an den VPS", async () => {
    await run("rechnungen-und-auftragsbestaetigungen", {
      document_type: "RE",
      _deal_record_id: "deal_1",
      _stunden: true,
      _rechnung: { bruttoCent: 123450 },
    });
    expect(m.reservieren).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ pdfBetragCent: null }));
    const p = upstreamParams();
    expect(p.preise).toEqual({
      modell: "pauschale",
      pauschale_positionen: [{ titel: "Umzug nach Aufwand (laut Stundennachweis)", betrag: 1234.5 }],
    });
  });

  it("ungültiges _rechnung: 400 vor allem anderen", async () => {
    const res = await run("rechnungen-und-auftragsbestaetigungen", {
      document_type: "RE",
      _deal_record_id: "deal_1",
      _rechnung: { bruttoCent: "viel" },
    });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/tools/run: keine Jobs, die absehbar scheitern (KV-Anschrift)", () => {
  it("ohne Kundenanschrift: 400 ANGABEN_FEHLEN, kein VPS-Aufruf, kein Register, keine Rechnungsnummer", async () => {
    for (const art of ["KV", "AB", "RE"]) {
      const res = await run("rechnungen-und-auftragsbestaetigungen", {
        document_type: art,
        kunde: { vorname: "Viktoria", nachname: "Muster" },
        _deal_record_id: "deal_v",
      });
      expect(res.status).toBe(400);
      const j = await res.json();
      expect(j.code).toBe("ANGABEN_FEHLEN");
      expect(j.fehlend).toEqual(["auszug"]);
      expect(j.error).toBe(`${art === "RE" ? "Rechnung" : art} nicht erstellt: Kundenanschrift fehlt. Angaben ergänzen.`);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(m.jobAnlegen).not.toHaveBeenCalled();
    expect(m.reservieren).not.toHaveBeenCalled();
  });

  it("leere Anschrift oder „—“ zählt als fehlend", async () => {
    for (const adresse of ["", "  ", "—"]) {
      const res = await run("rechnungen-und-auftragsbestaetigungen", {
        document_type: "KV",
        kunde: { nachname: "Muster", adresse },
      });
      expect(res.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("die Auftragsanweisung braucht keine Kundenanschrift", async () => {
    const res = await run("auftragsanweisung", { kunde: { nachname: "Muster" }, _deal_record_id: "deal_1" });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/tools/run: Kundenanschrift serverseitig ergänzen (Review M2)", () => {
  it("fehlt kunde.adresse, hat das Lead aber einen Auszug: Job läuft mit dieser Anschrift", async () => {
    m.leadAuszug.mockImplementation((d) => (d === "deal_v" ? { line1: "Hauptstr. 1", postcode: "72218", city: "Wildberg" } : null));
    const res = await run("rechnungen-und-auftragsbestaetigungen", { document_type: "KV", kunde: { nachname: "Muster" }, _deal_record_id: "deal_v" });
    expect(res.status).toBe(200);
    const gesendet = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(gesendet.params.kunde.adresse).toBe("Hauptstr. 1, 72218, Wildberg");
  });

  it("MCP mit nur auftrag.strecke_von: läuft weiter", async () => {
    const res = await run("rechnungen-und-auftragsbestaetigungen", {
      document_type: "KV",
      kunde: { nachname: "Muster" },
      auftrag: { strecke_von: "Königstr. 1, 70173 Stuttgart" },
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).params.kunde.adresse).toBe("Königstr. 1, 70173 Stuttgart");
  });

  it("eine mitgeschickte Anschrift bleibt", async () => {
    m.leadAuszug.mockImplementation(() => ({ line1: "Anders 9", postcode: "70372", city: "Stuttgart" }));
    await run("rechnungen-und-auftragsbestaetigungen", { document_type: "KV", _deal_record_id: "deal_1" });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).params.kunde.adresse).toBe("Hauptstr. 1, 72218 Wildberg");
  });
});
