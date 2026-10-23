import { describe, expect, it } from "vitest";
import { portalActivityCopy } from "./portal-activity";

describe("portalActivityCopy", () => {
  it("shows the customer's change request on the deal feed", () => {
    expect(
      portalActivityCopy("customer.question", { message: "Bitte den Keller mitnehmen" })
    ).toEqual({
      title: "Änderung angefragt",
      description: "Bitte den Keller mitnehmen",
    });
    expect(
      portalActivityCopy("customer.reschedule_requested", {
        message: "Der 12. passt nicht",
        preferredDates: ["2026-11-18", "2026-11-19"],
      })?.description
    ).toContain("Wunschtermine: 2026-11-18, 2026-11-19");
  });

  it("labels a handled request and a signature", () => {
    expect(portalActivityCopy("customer.change_request_handled", { message: "Keller" })?.title).toBe(
      "Änderungsanfrage erledigt"
    );
    expect(portalActivityCopy("customer.kva_signed", {})?.title).toBe(
      "Vertrag im Kundenportal unterschrieben"
    );
    expect(portalActivityCopy("kva.annahme_aufgehoben", { grund: "Angebot geändert" })?.description).toBe(
      "Angebot geändert"
    );
    expect(portalActivityCopy("deal.stage_changed", {})).toBeNull();
  });
});
