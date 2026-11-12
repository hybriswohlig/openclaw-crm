import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getObjectBySlug: vi.fn(),
  updateRecord: vi.fn(),
  getRecord: vi.fn(),
}));

vi.mock("@/services/objects", () => ({
  getObjectBySlug: mocks.getObjectBySlug,
}));

vi.mock("@/services/records", () => ({
  updateRecord: mocks.updateRecord,
  getRecord: mocks.getRecord,
}));

import { applyInvoiceDueDate } from "./rechnung-faellig";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getObjectBySlug.mockResolvedValue({ id: "obj_deals" });
  mocks.updateRecord.mockResolvedValue({ id: "deal_1", values: {} });
  mocks.getRecord.mockResolvedValue({ values: {} });
});

describe("applyInvoiceDueDate", () => {
  it("writes the Berlin upload day onto the existing attribute", async () => {
    const result = await applyInvoiceDueDate({
      documentType: "invoice",
      workspaceId: "ws",
      dealRecordId: "deal_1",
      updatedBy: "usr_1",
      now: new Date("2026-11-02T23:30:00.000Z"),
    });

    expect(result).toEqual({ rechnungFaelligAm: "2026-11-03" });
    expect(mocks.getObjectBySlug).toHaveBeenCalledWith("ws", "deals");
    expect(mocks.updateRecord).toHaveBeenCalledWith(
      "obj_deals",
      "deal_1",
      { rechnung_faellig_am: "2026-11-03" },
      "usr_1"
    );
  });

  it("uses the move day when the invoice is issued before the move", async () => {
    mocks.getRecord.mockResolvedValue({ values: { move_date: "2026-11-21" } });
    const result = await applyInvoiceDueDate({
      documentType: "invoice",
      workspaceId: "ws",
      dealRecordId: "deal_1",
      updatedBy: "usr_1",
      now: new Date("2026-11-02T12:00:00.000Z"),
    });
    expect(result.rechnungFaelligAm).toBe("2026-11-21");
    expect(mocks.updateRecord).toHaveBeenCalledWith(
      "obj_deals",
      "deal_1",
      { rechnung_faellig_am: "2026-11-21" },
      "usr_1"
    );
  });

  it("uses the invoice day when the invoice is issued on or after the move, and drops a later explicit day", async () => {
    mocks.getRecord.mockResolvedValue({ values: { move_date: "2026-11-21" } });
    const onMove = await applyInvoiceDueDate({
      documentType: "invoice",
      workspaceId: "ws",
      dealRecordId: "deal_1",
      explicitDueDate: "2026-12-01",
      updatedBy: null,
      now: new Date("2026-11-21T12:00:00.000Z"),
    });
    expect(onMove.rechnungFaelligAm).toBe("2026-11-21");

    const after = await applyInvoiceDueDate({
      documentType: "invoice",
      workspaceId: "ws",
      dealRecordId: "deal_1",
      updatedBy: null,
      now: new Date("2026-11-25T12:00:00.000Z"),
    });
    expect(after.rechnungFaelligAm).toBe("2026-11-25");
  });

  it("does not touch the field for a quotation", async () => {
    const result = await applyInvoiceDueDate({
      documentType: "quotation",
      workspaceId: "ws",
      dealRecordId: "deal_1",
      updatedBy: "usr_1",
    });

    expect(result).toEqual({ rechnungFaelligAm: null });
    expect(mocks.updateRecord).not.toHaveBeenCalled();
  });

  it("reports a failed write without throwing", async () => {
    mocks.updateRecord.mockResolvedValue(null);
    const result = await applyInvoiceDueDate({
      documentType: "invoice",
      workspaceId: "ws",
      dealRecordId: "missing",
      updatedBy: "usr_1",
      now: new Date("2026-11-02T12:00:00.000Z"),
    });
    expect(result.rechnungFaelligAm).toBeNull();
    expect(result.dueDateWarning).toBe("failed to set rechnung_faellig_am: deal not found");
  });
});
