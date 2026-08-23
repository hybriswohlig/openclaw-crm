import { describe, expect, it } from "vitest";
import { OPERATIVE_AREAS } from "@/lib/project-constants";
import { customerRequestArea } from "./customer-portal-data";

const AREA_VALUES = OPERATIVE_AREAS.map((a) => a.value);

describe("customerRequestArea", () => {
  it("routes a damage report to the Schadensfall area", () => {
    expect(customerRequestArea("damage")).toBe("schaden");
  });
  it("routes a reschedule request to Auftrag", () => {
    expect(customerRequestArea("reschedule")).toBe("auftrag");
  });
  it("routes a plain question to Kundenkontakt", () => {
    expect(customerRequestArea("question")).toBe("kunde");
  });
  it("only ever returns a value that exists in OPERATIVE_AREAS", () => {
    for (const kind of ["damage", "reschedule", "question"] as const) {
      expect(AREA_VALUES).toContain(customerRequestArea(kind));
    }
  });
});
