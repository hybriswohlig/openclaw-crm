import { describe, expect, it } from "vitest";
import { parseDateOffer, parseDateOfferPatch } from "./date-offer-input";

describe("parseDateOffer", () => {
  it("accepts a date with one labelled slot", () => {
    const parsed = parseDateOffer({
      date: "2026-11-12",
      slots: [{ label: "vormittags", startTime: "08:00", endTime: "11:00" }],
      note: "flexibel",
      isRecommended: true,
    });
    expect(parsed).toEqual({
      ok: true,
      offer: {
        date: "2026-11-12",
        slots: [{ label: "vormittags", startTime: "08:00", endTime: "11:00" }],
        note: "flexibel",
        isRecommended: true,
      },
    });
  });

  it("rejects a missing slot label and a bad date", () => {
    expect(parseDateOffer({ date: "12.11.2026", slots: [{ label: "vormittags" }] }).ok).toBe(false);
    expect(parseDateOffer({ date: "2026-11-12", slots: [{ label: "  " }] }).ok).toBe(false);
    expect(parseDateOffer({ date: "2026-11-12", slots: [] }).ok).toBe(false);
  });
});

describe("parseDateOfferPatch", () => {
  it("keeps omitted fields out of the patch", () => {
    expect(parseDateOfferPatch({ isRecommended: false })).toEqual({
      ok: true,
      patch: { isRecommended: false },
    });
  });

  it("rejects an empty patch", () => {
    expect(parseDateOfferPatch({})).toEqual({ ok: false, error: "Nothing to update" });
  });
});
