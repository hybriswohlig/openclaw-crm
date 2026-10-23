import { describe, expect, it } from "vitest";
import type { KvaSnapshot } from "@openclaw-crm/customer-portal-core";
import {
  buildSignatureView,
  classifySignature,
  completedSignature,
  quotationDifferReasons,
  type SignatureConfirmation,
} from "./deal-signature";

function snapshot(over: Partial<KvaSnapshot> = {}): KvaSnapshot {
  return {
    isVariable: false,
    fixedPriceCents: 120000,
    lineItems: [],
    notes: null,
    totalCents: 120000,
    depositRequiredCents: 30000,
    validUntil: "2026-11-30",
    summary: "Umzug 3 Zimmer",
    showStandardInclusions: true,
    calculationAssumptions: null,
    ...over,
  };
}

function confirmation(over: Partial<SignatureConfirmation> = {}): SignatureConfirmation {
  return {
    id: "conf-1",
    superseded: false,
    acceptedAt: "2026-10-22T08:15:00.000Z",
    signedAt: null,
    signedByName: null,
    signatureArt: null,
    quotationDocumentId: "kv-1",
    quotationDocumentSha256: "abc",
    signedDocumentId: null,
    signedDocumentSha256: null,
    confirmedTotalCents: 120000,
    snapshot: snapshot(),
    moveDate: "2026-11-12",
    fromAddress: "Marktstr. 8, 72218 Wildberg",
    toAddress: "Bahnhofstr. 1, 72218 Wildberg",
    ...over,
  };
}

const live = {
  signatureEnabled: true,
  current: snapshot(),
  currentQuotationId: "q-1",
  currentQuotationUpdatedAt: "2026-10-22T08:00:00.000Z",
  currentDocumentId: "kv-1",
  currentDocumentSha256: "abc",
  currentMoveDate: "2026-11-12",
  currentFromAddress: "Marktstr. 8, 72218 Wildberg",
  currentToAddress: "Bahnhofstr. 1, 72218 Wildberg",
};

describe("classifySignature", () => {
  it("is pending only when the KV can still be signed", () => {
    expect(classifySignature({ confirmation: confirmation(), signatureEnabled: true })).toBe("pending");
    expect(classifySignature({ confirmation: confirmation(), signatureEnabled: false })).toBe("signature_disabled");
    expect(
      classifySignature({
        confirmation: confirmation({ quotationDocumentId: null, quotationDocumentSha256: null }),
        signatureEnabled: true,
      })
    ).toBe("accepted_without_pdf");
  });

  it("treats a stored contract as signed and a superseded row as not current", () => {
    const signed = confirmation({
      signedAt: "2026-10-22T09:00:00.000Z",
      signedByName: "Anna Muster",
      signatureArt: "getippt",
      signedDocumentId: "vertrag-1",
      signedDocumentSha256: "def",
    });
    expect(classifySignature({ confirmation: signed, signatureEnabled: true })).toBe("signed");
    expect(classifySignature({ confirmation: { ...signed, superseded: true }, signatureEnabled: true })).toBe(
      "superseded"
    );
    expect(classifySignature({ confirmation: null, signatureEnabled: true })).toBe("none");
  });
});

describe("quotationDifferReasons", () => {
  it("is empty when the live quotation matches the signed snapshot", () => {
    expect(
      quotationDifferReasons({
        signed: snapshot(),
        current: snapshot(),
        signedDocumentSha256: "abc",
        currentDocumentSha256: "abc",
        signedMoveDate: "2026-11-12",
        currentMoveDate: "2026-11-12",
        signedFromAddress: "Marktstr. 8",
        currentFromAddress: " marktstr. 8 ",
        signedToAddress: "Bahnhofstr. 1",
        currentToAddress: "Bahnhofstr. 1",
      })
    ).toEqual([]);
  });

  it("names the commercial fields, the PDF and the move date that changed", () => {
    expect(
      quotationDifferReasons({
        signed: snapshot(),
        current: snapshot({
          totalCents: 150000,
          fixedPriceCents: 150000,
          depositRequiredCents: 40000,
          summary: "Umzug plus Keller",
          lineItems: [
            { type: "other", description: "Keller", quantity: 1, unitRate: 300, lineTotal: 300 },
          ],
        }),
        signedDocumentSha256: "abc",
        currentDocumentSha256: "zzz",
        signedMoveDate: "2026-11-12",
        currentMoveDate: "2026-11-20",
        signedFromAddress: "Alt",
        currentFromAddress: "Neu",
        signedToAddress: "Gleich",
        currentToAddress: "Gleich",
      })
    ).toEqual([
      "fixed_price",
      "total",
      "deposit",
      "summary",
      "line_items",
      "quotation_pdf",
      "move_date",
      "from_address",
    ]);
  });
});

describe("buildSignatureView", () => {
  it("says an active matching signature covers the current terms", () => {
    const view = buildSignatureView({
      ...live,
      confirmation: confirmation({
        signedAt: "2026-10-22T09:00:00.000Z",
        signedByName: "Anna Muster",
        signatureArt: "gezeichnet",
        signedDocumentId: "vertrag-1",
      }),
    });
    expect(view.status).toBe("signed");
    expect(view.coversCurrentTerms).toBe(true);
    expect(view.signedByName).toBe("Anna Muster");
    expect(view.currentQuotationDiffers).toBe(false);
  });

  it("does not let a superseded signature cover a changed quotation", () => {
    const view = buildSignatureView({
      ...live,
      current: snapshot({ totalCents: 99000, fixedPriceCents: 99000 }),
      currentDocumentSha256: "neu",
      confirmation: confirmation({
        superseded: true,
        signedAt: "2026-10-22T09:00:00.000Z",
        signedByName: "Anna Muster",
        signatureArt: "getippt",
        signedDocumentId: "vertrag-1",
      }),
    });
    expect(view.status).toBe("superseded");
    expect(view.coversCurrentTerms).toBe(false);
    expect(view.currentQuotationDiffers).toBe(true);
    expect(view.differReasons).toEqual(expect.arrayContaining(["total", "quotation_pdf"]));
  });

  it("reports no signature when the deal was never accepted", () => {
    const view = buildSignatureView({ ...live, confirmation: null });
    expect(view.status).toBe("none");
    expect(view.coversCurrentTerms).toBe(false);
    expect(view.confirmationId).toBeNull();
  });
});

describe("completedSignature", () => {
  it("ignores a reservation that never stored the contract", () => {
    expect(
      completedSignature({
        unterschriftAt: new Date("2026-10-22T09:00:00.000Z"),
        unterschriftName: "Anna",
        unterschriftArt: "getippt",
        vertragDocumentId: null,
      })
    ).toBeNull();
  });
});
