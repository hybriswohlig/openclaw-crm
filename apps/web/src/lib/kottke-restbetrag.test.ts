import { describe, expect, it } from "vitest";
import { KOTTKE_RESTBETRAG_EINSATZ, KOTTKE_RESTBETRAG_UMZUG } from "@openclaw-crm/document-templates/src/restbetrag";
import { portalRestbetragSatz } from "./kottke-restbetrag";

describe("portalRestbetragSatz", () => {
  it("Kottke Umzug: am Umzugstag, bar oder Überweisung", () => {
    expect(portalRestbetragSatz("kottke", "move")).toBe(KOTTKE_RESTBETRAG_UMZUG);
    expect(portalRestbetragSatz("kottke", null)).toBe(KOTTKE_RESTBETRAG_UMZUG);
  });

  it("Kottke Küche und Entrümpelung: Einsatztag, ohne das Wort Umzug", () => {
    expect(portalRestbetragSatz("kottke", "kitchen_installation")).toBe(KOTTKE_RESTBETRAG_EINSATZ);
    expect(portalRestbetragSatz("kottke", "clearance")).toBe(KOTTKE_RESTBETRAG_EINSATZ);
    expect(KOTTKE_RESTBETRAG_EINSATZ).not.toContain("Umzug");
  });

  it("Ceylan bleibt ohne diesen Satz", () => {
    expect(portalRestbetragSatz("ceylan", "move")).toBeNull();
  });
});
