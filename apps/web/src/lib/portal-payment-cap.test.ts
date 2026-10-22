import { describe, expect, it } from "vitest";
import { portalPaymentCap } from "./portal-payment-cap";

// The crew books cash collected on site. For a fixed price the amount is
// capped at what is still open (plus a small tolerance) to catch typos. For
// hourly jobs the accepted total is only an estimate — the real bill depends
// on the hours worked, so capping at the estimate blocks the actual payment.
describe("portalPaymentCap", () => {
  it("does not cap hourly jobs at the estimate", () => {
    expect(portalPaymentCap({ quotedEur: 230, paidEur: 0, isVariable: true, toleranceEur: 50 })).toBeNull();
  });

  it("keeps the estimate cap for fixed prices", () => {
    expect(portalPaymentCap({ quotedEur: 1080, paidEur: 500, isVariable: false, toleranceEur: 50 })).toBe(630);
  });

  it("does not cap without a quote", () => {
    expect(portalPaymentCap({ quotedEur: null, paidEur: 0, isVariable: false, toleranceEur: 50 })).toBeNull();
    expect(portalPaymentCap({ quotedEur: 0, paidEur: 0, isVariable: false, toleranceEur: 50 })).toBeNull();
  });
});
