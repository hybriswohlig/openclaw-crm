import { expect, it } from "vitest";
import { portalFeatures } from "@openclaw-crm/customer-portal-core";

it("keeps live tracking and payments off for absent or legacy settings", () => {
  expect(portalFeatures()).toEqual({ liveTracking: false, payments: false });
  expect(portalFeatures({})).toEqual({ liveTracking: false, payments: false });
});
it("enables only explicitly enabled flags independently", () => {
  expect(portalFeatures({ liveTrackingEnabled: true })).toEqual({ liveTracking: true, payments: false });
  expect(portalFeatures({ paymentsEnabled: true })).toEqual({ liveTracking: false, payments: true });
});
