import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { preisZahlungenCent } from "./preis-zahlungen";

describe("preisZahlungenCent", () => {
  it("zählt Kundenzahlungen (betriebseinnahme)", () => {
    expect(preisZahlungenCent([{ amount: "300.00", taxTreatment: "betriebseinnahme" }, { amount: 900, taxTreatment: "betriebseinnahme" }])).toBe(120000);
  });

  it("lässt Kaution und durchlaufende Posten (nicht_steuerbar) weg", () => {
    expect(preisZahlungenCent([{ amount: "900", taxTreatment: "betriebseinnahme" }, { amount: "300", taxTreatment: "nicht_steuerbar" }])).toBe(90000);
  });

  it("lässt auch die zurückgezahlte Kaution weg", () => {
    expect(preisZahlungenCent([{ amount: "300", taxTreatment: "nicht_steuerbar" }, { amount: "-300", taxTreatment: "nicht_steuerbar" }])).toBe(0);
  });

  it("rechnet je Zeile in Cent, ohne Gleitkomma-Reste", () => {
    expect(preisZahlungenCent([{ amount: "0.10", taxTreatment: "betriebseinnahme" }, { amount: "0.20", taxTreatment: "betriebseinnahme" }])).toBe(30);
  });

  it("leere oder kaputte Beträge zählen 0", () => {
    expect(preisZahlungenCent([{ amount: null, taxTreatment: "betriebseinnahme" }, { amount: "abc", taxTreatment: "betriebseinnahme" }])).toBe(0);
  });
});

// Überall, wo Zahlungen mit dem Preis verglichen werden, gilt dieselbe Regel
// wie in Lagekarte und Gewinnübersicht.
describe("Preisvergleiche nutzen preisZahlungenCent", () => {
  const src = join(__dirname, "..");
  const dateien = [
    "services/employee-portal-data.ts",
    "app/api/v1/portal/deals/[dealId]/payment/route.ts",
    "services/deal-lifecycle.ts",
    "services/customer-portal-data.ts",
    "services/customer-portal-notifications.ts",
    "services/commercial-documents.ts",
    "services/document-job-context.ts",
  ];
  for (const datei of dateien) {
    it(datei, () => {
      const code = readFileSync(join(src, datei), "utf8");
      expect(code).toContain("preisZahlungenCent(");
      expect(code).not.toMatch(/sum\(\$\{payments\.amount\}\)|sum\(payments\.amount\)/);
    });
  }
});
