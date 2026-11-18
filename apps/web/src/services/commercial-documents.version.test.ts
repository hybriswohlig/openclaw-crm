/**
 * CRM-Renderer: der KV wird mit der Kalkulationsversion der Quotation gespeichert,
 * aus der er gerendert wurde, nicht mit der, auf die die Quotation beim Speichern
 * zeigt (Review 4). Datenbank und Chromium sind ersetzt.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getQuotation: vi.fn(),
  createDealDocument: vi.fn(),
  renderPdf: vi.fn(),
  /** Version der Quotation unter der Sperre (KV, Kimi 5). */
  versionJetzt: vi.fn(),
  sperren: vi.fn(),
  pushDazwischen: vi.fn(),
  nachlauf: vi.fn(),
}));

// Jede Abfrage: Objekt-Zeilen gibt es, sonst leer (keine Annahme, keine Zahlungen, kein Auftrag).
vi.mock("@/db", async () => {
  const { objects } = await import("@/db/schema/objects");
  const kette = (): unknown => {
    let tabelle: unknown = null;
    const k: Record<string, unknown> = {};
    for (const f of ["from", "innerJoin", "where", "limit", "orderBy"]) {
      k[f] = (t: unknown) => {
        if (f === "from") tabelle = t;
        return k;
      };
    }
    k.then = (ok: (v: unknown) => unknown, fehler: (e: unknown) => unknown) =>
      Promise.resolve(tabelle === objects ? [{ id: "obj_1" }] : []).then(ok, fehler);
    return k;
  };
  return { db: { select: () => kette(), transaction: async (fn: (tx: unknown) => unknown) => fn({ tx: true }) } };
});
vi.mock("@/services/document-job-context", () => ({ assertDealInWorkspace: async () => true }));
vi.mock("@/services/quotations", () => ({ getQuotation: mocks.getQuotation, angebotSperren: mocks.sperren }));
vi.mock("@/services/kv-push-regel", () => ({ pushDazwischen: mocks.pushDazwischen }));
vi.mock("@/services/doc-customer-name", () => ({
  resolveDocCustomerName: async () => ({ vorname: "Kyra", nachname: "Heiker", fullName: "Kyra Heiker", source: "person" }),
}));
vi.mock("@/services/customer-portal-emails", () => ({ loadCustomerEmail: async () => null }));
vi.mock("@/services/records", () => ({
  getRecord: async (_objekt: string, id: string) =>
    id === "deal_1"
      ? { values: { name: "Umzug Heiker", operating_company: { id: "oc_ceylan", displayName: "Ceylan Umzüge" } } }
      : { values: {} },
}));
vi.mock("@/services/agent/agent-suppress", () => ({
  ladeGespeicherteAnrede: async () => ({}),
  anredeFuerOptOut: () => "sie",
}));
vi.mock("@/services/deal-documents", () => ({
  createDealDocument: mocks.createDealDocument,
  angebotsVersionId: mocks.versionJetzt,
  dealDokumentNachlauf: mocks.nachlauf,
}));
vi.mock("@/services/rechnung-faellig", () => ({ applyInvoiceDueDate: vi.fn() }));
vi.mock("@openclaw-crm/document-templates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openclaw-crm/document-templates")>()),
  renderPdf: mocks.renderPdf,
}));

import { previewCommercialDocument, storeCommercialDocument } from "./commercial-documents";

const angebot = (calculationVersionId: string | null, fixedPrice: string) => ({
  id: "q1",
  dealRecordId: "deal_1",
  fixedPrice,
  isVariable: false,
  notes: null,
  summary: null,
  validUntil: null,
  depositRequiredCents: null,
  paymentMethodPreference: null,
  showStandardInclusions: true,
  selectedPackageOptionId: null,
  serviceType: "move",
  documentDetails: null,
  calculationAssumptions: null,
  calculationVersionId,
  lineItems: [{ id: "l1", quotationId: "q1", type: "other", description: "Umzug", quantity: 1, unitRate: fixedPrice, sortOrder: 0 }],
});

const DOKUMENT = { id: "doc_1", documentType: "quotation", fileName: "KV.pdf", fileSize: 4, mimeType: "application/pdf", uploadedAt: new Date() };

/** Haken des KV-Editors im Test (bis Aufgabe 3 ein Stub). */
const haken = {
  kvEditorBeimNeuenKv: vi.fn(),
  kvEditorStandZumNeuenKv: vi.fn(),
};
const eingabe = { workspaceId: "ws_1", dealRecordId: "deal_1", kind: "KV" as const, kvEditor: haken };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createDealDocument.mockResolvedValue(DOKUMENT);
  mocks.getQuotation.mockResolvedValue(angebot("ver_1", "1000.00"));
  mocks.versionJetzt.mockResolvedValue("ver_1");
  mocks.pushDazwischen.mockResolvedValue(null);
  mocks.renderPdf.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  haken.kvEditorBeimNeuenKv.mockResolvedValue({ quelle: null });
  haken.kvEditorStandZumNeuenKv.mockResolvedValue({ id: "stand_1" });
});

/** Während des Renderns sperrt jemand v2 (1.500 €): die Quotation zeigt danach auf v2. */
function v2WaehrendDesRenderns() {
  mocks.renderPdf.mockImplementation(async () => {
    mocks.getQuotation.mockResolvedValue(angebot("ver_2", "1500.00"));
    mocks.versionJetzt.mockResolvedValue("ver_2");
    return new Uint8Array([0x25, 0x50, 0x44, 0x46]);
  });
}

const aenderung = (schluessel: string, wert: string, vorher: string) => ({
  schluessel,
  wert,
  vorher,
  quelle: "hand" as const,
  von: "usr_1",
  am: "2026-11-18T10:00:00.000Z",
});

describe("CRM-Renderer und Kalkulationsversion (Review 4)", () => {
  it("Vorschau nennt die Version der gerenderten Quotation", async () => {
    v2WaehrendDesRenderns();
    const r = await previewCommercialDocument(eingabe);
    expect(r.calculationVersionId).toBe("ver_1");
    expect(r.html).toContain("1.000,00");
    // Kopf und Posten aus einem Stand gelesen (Codex-Re-Review F4).
    expect(mocks.getQuotation).toHaveBeenCalledWith(expect.any(String), { konsistent: true });
  });

  it("KV mit der gerenderten Version, unter der Sperre geprüft, Dokument und Stand in einer Transaktion", async () => {
    await storeCommercialDocument(eingabe);
    expect(mocks.sperren).toHaveBeenCalledWith({ tx: true }, "deal_1");
    expect(mocks.versionJetzt).toHaveBeenCalledWith("deal_1", { tx: true });
    expect(mocks.createDealDocument).toHaveBeenCalledTimes(1);
    expect(mocks.createDealDocument).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: "quotation", calculationVersionId: "ver_1" }),
      { tx: true }
    );
    expect(haken.kvEditorStandZumNeuenKv).toHaveBeenCalledWith(
      { tx: true },
      "ws_1",
      "deal_1",
      expect.objectContaining({
        renderer: "crm",
        grundlage: { copy: {} },
        aenderungen: [],
        offen: [],
        quelleId: null,
        calculationVersionId: "ver_1",
        renderJobId: null,
        dealDocumentId: "doc_1",
        pruefung: null,
        datei: expect.objectContaining({ fileSize: 4, fileContent: Buffer.from([0x25, 0x50, 0x44, 0x46]).toString("base64") }),
      })
    );
    // Nachläufe erst nach dem Commit.
    expect(mocks.nachlauf).toHaveBeenCalledWith({ workspaceId: "ws_1", dealRecordId: "deal_1", notifyCustomer: false }, "quotation");
  });

  it("v2 zwischen Rendern und Ablegen gesperrt: abgelehnt, nichts gespeichert (Kimi 5)", async () => {
    v2WaehrendDesRenderns();
    await expect(storeCommercialDocument(eingabe)).rejects.toMatchObject({ status: 409, code: "KALKULATION_NEU" });
    expect(mocks.createDealDocument).not.toHaveBeenCalled();
    expect(haken.kvEditorStandZumNeuenKv).not.toHaveBeenCalled();
    expect(mocks.nachlauf).not.toHaveBeenCalled();
  });

  it("Quotation ohne Version → null", async () => {
    mocks.getQuotation.mockResolvedValue(angebot(null, "1000.00"));
    mocks.versionJetzt.mockResolvedValue(null);
    await storeCommercialDocument(eingabe);
    expect(mocks.createDealDocument).toHaveBeenCalledWith(expect.objectContaining({ calculationVersionId: null }), { tx: true });
  });

  it("pruefeVersion bekommt die gerenderte Version; wirft sie, wird nichts gespeichert", async () => {
    v2WaehrendDesRenderns();
    const pruefeVersion = vi.fn(async (id: string | null) => {
      if (id !== "ver_2") throw new Error("nicht v2");
    });
    await expect(storeCommercialDocument({ ...eingabe, pruefeVersion })).rejects.toThrow("nicht v2");
    expect(pruefeVersion).toHaveBeenCalledWith("ver_1");
    expect(mocks.createDealDocument).not.toHaveBeenCalled();
  });

  it("pruefeVersion lehnt auch ab, wenn die Version erst unter der Sperre anders ist", async () => {
    const pruefeVersion = vi.fn(async (id: string | null) => {
      if (id !== "ver_1") throw new Error("nicht mehr v1");
    });
    mocks.versionJetzt.mockResolvedValue("ver_2");
    await expect(storeCommercialDocument({ ...eingabe, pruefeVersion })).rejects.toThrow("nicht mehr v1");
    expect(pruefeVersion).toHaveBeenLastCalledWith("ver_2");
    expect(mocks.createDealDocument).not.toHaveBeenCalled();
  });
});

describe("CRM-KV mit dem KV-Editor (Spec 7.6)", () => {
  it("Änderungen der Quelle wandern mit: Bemerkung gedruckt, Konflikt offen, Stand mit Quelle", async () => {
    const bemerkung = aenderung("bemerkungen:text:text", "Treppenhaus ist eng.", "");
    const alt = aenderung("anschreiben:schluss:text", "Bis bald", "Nicht mehr der Standard");
    haken.kvEditorBeimNeuenKv.mockResolvedValue({ quelle: { id: "stand_4", aenderungen: [bemerkung, alt], offen: [] } });
    const r = await storeCommercialDocument({ ...eingabe, copy: { intro: "Alter Text." } });
    expect(r.document.id).toBe("doc_1");
    const stand = haken.kvEditorStandZumNeuenKv.mock.calls[0][3];
    expect(stand.quelleId).toBe("stand_4");
    expect(stand.aenderungen).toEqual([bemerkung]);
    expect(stand.offen).toEqual([expect.objectContaining({ art: "basis_geaendert", status: "offen", aenderung: alt })]);
    expect(stand.grundlage).toEqual({ copy: { intro: "Alter Text." } });
    // Gedruckt wurde das Modell mit der Bemerkung.
    const model = mocks.renderPdf.mock.calls[0][0] as { remarks?: string };
    expect(model.remarks).toBe("Treppenhaus ist eng.");
  });

  it("inzwischen gepushter Stand: verworfen mit Text, nichts gespeichert (Kimi 1)", async () => {
    mocks.pushDazwischen.mockResolvedValue({ standId: "stand_6", nummer: 6 });
    await expect(storeCommercialDocument(eingabe)).rejects.toMatchObject({
      status: 409,
      message: "Inzwischen wurde Stand 6 gepusht. KV neu erstellen, die Änderungen wandern mit.",
    });
    expect(mocks.pushDazwischen).toHaveBeenCalledWith({ tx: true }, "ws_1", "deal_1", null);
    expect(mocks.createDealDocument).not.toHaveBeenCalled();
  });

  it("Stand scheitert: Transaktion bricht ab, keine Nachläufe", async () => {
    haken.kvEditorStandZumNeuenKv.mockRejectedValue(new Error("kv-editor: Haken noch nicht gebaut"));
    await expect(storeCommercialDocument(eingabe)).rejects.toThrow("Haken noch nicht gebaut");
    expect(mocks.nachlauf).not.toHaveBeenCalled();
  });
});
