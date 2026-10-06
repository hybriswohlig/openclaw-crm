import { describe, expect, it } from "vitest";
import { annahmeAusZeile, sha256Hex } from "./kva-annahme";

const basis = {
  signedAt: new Date("2026-10-01T08:00:00Z"),
  acceptedFullName: "Max Muster",
  agbVersionAccepted: "kottke-2026-06",
  confirmedTotalCents: 120000,
  widerrufVerzichtAccepted: false,
};

describe("annahmeAusZeile", () => {
  it("Altzeile ohne neue Spalten bleibt gültige Annahme", () => {
    const r = annahmeAusZeile({ ...basis, selectedOptionName: null, widerrufModus: null, vorzeitigerBeginnVerlangt: false, quotationDocumentId: null });
    expect(r.signedAt).toBe("2026-10-01T08:00:00.000Z");
    expect(r.confirmedTotalCents).toBe(120000);
    expect(r.widerrufModus).toBeNull();
  });
  it("neue Zeile trägt Option und Modus", () => {
    const r = annahmeAusZeile({ ...basis, selectedOptionName: "Komfort", widerrufModus: "ausgeschlossen", vorzeitigerBeginnVerlangt: false, quotationDocumentId: "doc1" });
    expect(r.selectedOptionName).toBe("Komfort");
    expect(r.widerrufModus).toBe("ausgeschlossen");
    expect(r.quotationDocumentId).toBe("doc1");
  });
});

describe("sha256Hex", () => {
  it("bekannter Hash", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
