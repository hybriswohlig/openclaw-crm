import { describe, expect, it, vi } from "vitest";
import { STANDARD_OBJECTS } from "@openclaw-crm/shared";

vi.mock("@/db", () => ({ db: {} }));

import { istDealStufenwechsel } from "./records";

describe("istDealStufenwechsel", () => {
  it("gilt nur für die Stufe von Deals", () => {
    expect(istDealStufenwechsel("deals", "stage")).toBe(true);
  });

  it("ignoriert andere Status-Attribute von Deals, etwa die Bewertungsanfrage", () => {
    expect(istDealStufenwechsel("deals", "review_request_status")).toBe(false);
  });

  it("ignoriert Status-Attribute anderer Objekte", () => {
    expect(istDealStufenwechsel("people", "stage")).toBe(false);
    expect(istDealStufenwechsel("companies", "stage")).toBe(false);
  });

  it("passt zum Slug des Stufen-Attributs in den Standardobjekten", () => {
    const deals = STANDARD_OBJECTS.find((o) => o.slug === "deals");
    const stufe = deals?.attributes.find((a) => a.type === "status" && a.slug === "stage");
    expect(stufe).toBeDefined();
  });
});
