import { describe, expect, it } from "vitest";
import { STANDARD_OBJECTS } from "@openclaw-crm/shared";
import { InsightsSchema } from "./deal-insights";
import { DEAL_FIELD_TO_SLUG } from "./deal-insights-apply";

describe("Wohnfläche und Zimmer am Lead", () => {
  it("die KI-Extraktion kennt living_area_sqm und rooms", () => {
    const felder = InsightsSchema.shape.extracted.shape;
    expect(felder).toHaveProperty("living_area_sqm");
    expect(felder).toHaveProperty("rooms");
  });

  it("die Extraktion wird auf die Lead-Felder wohnflaeche_qm und zimmer geschrieben", () => {
    expect(DEAL_FIELD_TO_SLUG.living_area_sqm).toEqual({ slug: "wohnflaeche_qm", label: "Wohnfläche" });
    expect(DEAL_FIELD_TO_SLUG.rooms).toEqual({ slug: "zimmer", label: "Zimmer" });
  });

  it("die Lead-Felder existieren als Standard-Attribute (Zahl)", () => {
    const deals = STANDARD_OBJECTS.find((o) => o.slug === "deals")!;
    const attr = (slug: string) => deals.attributes.find((a) => a.slug === slug);
    expect(attr("wohnflaeche_qm")).toMatchObject({ type: "number", title: "Wohnfläche (m²)" });
    expect(attr("zimmer")).toMatchObject({ type: "number", title: "Zimmer" });
  });
});
