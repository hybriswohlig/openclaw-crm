import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ lead: vi.fn(), quotation: vi.fn(), imWorkspace: vi.fn() }));
vi.mock("@/services/lead-context", () => ({ loadLeadContext: m.lead }));
vi.mock("@/services/quotations", () => ({ getQuotation: m.quotation }));
vi.mock("@/services/document-job-context", () => ({ assertDealInWorkspace: m.imWorkspace }));

import { kvEingabeAusDeal } from "./kv-eingabe-aus-deal";

const LEAD = {
  name: "Mira Beispiel",
  person_name: "Mira Beispiel",
  person_vorname: "Mira",
  person_nachname: "Beispiel",
  move_date: "2026-12-15",
  move_from_address: { line1: "Beispielweg 12", postcode: "70173", city: "Stuttgart" },
  move_to_address: { line1: "Probenweg 4", postcode: "71032", city: "Böblingen" },
  floors_from: 2,
  floors_to: 3,
  elevator_from: "Aufzug",
  elevator_to: null,
  inventory_notes: "etwa 20 Kubikmeter",
  operating_company: { id: "oc_1", displayName: "Kottke Dienstleistungen" },
};

beforeEach(() => {
  vi.clearAllMocks();
  m.imWorkspace.mockResolvedValue(true);
  m.lead.mockResolvedValue(LEAD);
  m.quotation.mockResolvedValue({ serviceType: "move", documentDetails: { mitEntruempelung: false } });
});

describe("kvEingabeAusDeal", () => {
  it("baut das Paket wie der Dialog, frisch aus dem Lead, ohne Preise und Kalkulationsfelder", async () => {
    const p = await kvEingabeAusDeal("ws_1", "deal_1", { anweisung: " Klavier zuerst ", bildIds: ["att_1", "att_2"] });
    expect(p).toEqual({
      firma: "kottke",
      document_type: "KV",
      kunde: { vorname: "Mira", nachname: "Beispiel", adresse: "Beispielweg 12, 70173, Stuttgart" },
      auftrag: {
        strecke_von: "Beispielweg 12, 70173, Stuttgart",
        strecke_nach: "Probenweg 4, 71032, Böblingen",
        datum: "2026-12-15",
        volumen: "etwa 20 Kubikmeter",
        besonderheiten: "Auszug 2. Stock (Aufzug), Einzug 3. Stock",
      },
      anweisung: "Klavier zuerst",
      service_type: "move",
      document_details: { serviceType: "move", mitEntruempelung: false },
      _deal_record_id: "deal_1",
      _image_attachment_ids: ["att_1", "att_2"],
    });
    for (const k of ["preise", "_document_context", "_calculation_version_id"]) expect(p).not.toHaveProperty(k);
    const d = p!.document_details as Record<string, unknown>;
    for (const k of ["cardAgreed", "validUntil", "inventory", "services"]) expect(d).not.toHaveProperty(k);
  });

  it("Leistungsart aus der Quotation: Entrümpelung ohne Einzug, Umzug mit Entrümpelung, Küche mit Block", async () => {
    m.quotation.mockResolvedValueOnce({ serviceType: "clearance", documentDetails: null });
    const r = await kvEingabeAusDeal("ws_1", "deal_1", { bildIds: [] });
    expect(r?.service_type).toBe("clearance");
    expect((r?.auftrag as Record<string, unknown>).strecke_nach).toBeUndefined();

    m.quotation.mockResolvedValueOnce({ serviceType: "move", documentDetails: { mitEntruempelung: true } });
    const k = await kvEingabeAusDeal("ws_1", "deal_1", { bildIds: [] });
    expect(k?.document_details).toEqual({ serviceType: "move", mitEntruempelung: true });

    m.quotation.mockResolvedValueOnce({ serviceType: "kitchen_installation", documentDetails: null });
    const kitchen = { notes: "Altbau", services: { installation: { owner: "company" as const } } };
    const kue = await kvEingabeAusDeal("ws_1", "deal_1", { kitchen, bildIds: [] });
    expect(kue?.document_details).toEqual({ serviceType: "kitchen_installation", mitEntruempelung: false, kitchen });
    // Eine Kopie: das Paket ändert die Grundlage nie.
    expect((kue?.document_details as { kitchen: unknown }).kitchen).not.toBe(kitchen);
  });

  it("fremder Deal oder fehlende Firma: null", async () => {
    m.imWorkspace.mockResolvedValueOnce(false);
    expect(await kvEingabeAusDeal("ws_x", "deal_1", { bildIds: [] })).toBeNull();
    m.lead.mockResolvedValueOnce({ ...LEAD, operating_company: null });
    expect(await kvEingabeAusDeal("ws_1", "deal_1", { bildIds: [] })).toBeNull();
  });
});
