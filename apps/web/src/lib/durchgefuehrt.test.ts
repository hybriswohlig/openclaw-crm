import { expect, it } from "vitest";
import { moveCompletedSetzen } from "./durchgefuehrt";

it("setzt bei Deals mit Kategorie done_unpaid ohne vorhandenes Datum", () => {
  expect(moveCompletedSetzen({ objectSlug: "deals", toCategory: "done_unpaid", vorhanden: null })).toBe(true);
});
it("lässt ein vorhandenes Datum stehen", () => {
  expect(moveCompletedSetzen({ objectSlug: "deals", toCategory: "done_unpaid", vorhanden: "2026-11-02" })).toBe(false);
});
it("ignoriert andere Kategorien und andere Objekte", () => {
  expect(moveCompletedSetzen({ objectSlug: "deals", toCategory: "booked", vorhanden: null })).toBe(false);
  expect(moveCompletedSetzen({ objectSlug: "people", toCategory: "done_unpaid", vorhanden: null })).toBe(false);
});
