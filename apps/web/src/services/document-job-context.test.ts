import { describe, expect, it } from "vitest";
import { preiseFromQuotation } from "./document-job-context";
import { angebotsUebernahme } from "./rechner/uebernahme";
import type { RechnerErgebnis } from "./rechner/client";

/** Posten wie nach „In Angebot übernehmen“ (Kern + Hebel, Summe 1720 €) */
const kernUndHebel = [
  { type: "other", description: "Umzug mit Team und Fahrzeug", quantity: 1, unitRate: "1500.00" },
  { type: "other", description: "Halteverbotszone", quantity: 2, unitRate: "110.00" },
];

describe("preiseFromQuotation", () => {
  it("nimmt beim Festpreis die Posten, wenn ihre Summe der Festpreis ist", () => {
    expect(preiseFromQuotation("kottke", { isVariable: false, fixedPrice: "1720.00", lineItems: kernUndHebel })).toEqual({
      modell: "pauschale",
      pauschale_positionen: [
        { titel: "Umzug mit Team und Fahrzeug", betrag: 1500 },
        { titel: "Halteverbotszone", betrag: 220 },
      ],
    });
  });

  it("behält die Aufschlüsselung direkt nach „In Angebot übernehmen“", () => {
    const ergebnis: RechnerErgebnis = {
      preis: { festpreis: 1730, selbstkosten: 1100, rundungEur: 10, posten: [{ bezeichnung: "Halteverbotszone", menge: 2, einheit: "Stück", satz: 150, betrag: 300 }] },
      kosten: { selbstkosten: 1100, posten: [{ bezeichnung: "Halteverbotszone", menge: 2, einheit: "Stück", satz: 120, betrag: 240 }] },
      zeiten: { demontage: 84, montage: 114 },
      team: { groesse: 4 },
      positionen: [{ name: "Boxspringbett", menge: 1, volumenCbm: 2, zerlegt: true }],
      schaetzung: null,
    };
    const anfrage = { von_halteverbot: "on", nach_halteverbot: "on", umzugsdatum: "2026-10-20" };
    const r = angebotsUebernahme({ result: ergebnis, request: anfrage }, null, { jetzt: new Date("2026-10-08T10:00:00Z") });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.eingabe.lineItems.length).toBeGreaterThan(1);
    const preise = preiseFromQuotation("kottke", r.eingabe);
    expect(preise?.pauschale_positionen?.map((p) => p.titel)).toEqual(r.eingabe.lineItems.map((li) => li.description));
  });

  it("fällt auf eine Pauschale zurück, wenn die Posten nicht zum Festpreis passen", () => {
    expect(preiseFromQuotation("kottke", { isVariable: false, fixedPrice: "1800.00", lineItems: kernUndHebel })).toEqual({
      modell: "pauschale",
      pauschale_positionen: [{ titel: "Pauschale", betrag: 1800 }],
    });
  });

  it("rechnet die Summe in Cent und übergeht Posten ohne Preis", () => {
    const posten = [
      { type: "other", description: "Kern", quantity: 3, unitRate: "33.33" },
      { type: "other", description: "Möbelschutz inklusive", quantity: 1, unitRate: "0" },
    ];
    const preise = preiseFromQuotation("kottke", { isVariable: false, fixedPrice: "99.99", lineItems: posten });
    expect(preise?.pauschale_positionen).toHaveLength(1);
    expect(preise?.pauschale_positionen?.[0].titel).toBe("Kern");
  });

  it("zeigt beim Festpreis ohne Posten eine Pauschale", () => {
    expect(preiseFromQuotation("kottke", { isVariable: false, fixedPrice: "890", lineItems: [] })).toEqual({
      modell: "pauschale",
      pauschale_positionen: [{ titel: "Pauschale", betrag: 890 }],
    });
  });

  it("lässt den Stundensatz unverändert", () => {
    expect(
      preiseFromQuotation("kottke", {
        isVariable: true,
        fixedPrice: null,
        lineItems: [
          { type: "helper", description: "Helfer", quantity: 3, unitRate: "45" },
          { type: "transporter", description: "Transporter", quantity: 4, unitRate: "30" },
        ],
      })
    ).toEqual({
      modell: "stundensatz",
      helfer_anzahl: 3,
      stunden_geschaetzt: 4,
      mindest_stunden: 4,
      stundensatz_helfer_eur: 45,
      stundensatz_transporter_eur: 30,
    });
    // Stundensatz ohne Helfer und Transporter: Posten wie bisher, ohne Festpreisprüfung
    expect(
      preiseFromQuotation("kottke", {
        isVariable: true,
        fixedPrice: null,
        lineItems: [{ type: "other", description: "Klaviertransport", quantity: 1, unitRate: "300" }],
      })
    ).toEqual({ modell: "pauschale", pauschale_positionen: [{ titel: "Klaviertransport", betrag: 300 }] });
  });

  it("gibt Ceylan beim Festpreis weiter nur den Betrag", () => {
    expect(preiseFromQuotation("ceylan", { isVariable: false, fixedPrice: "1720.00", lineItems: kernUndHebel })).toEqual({
      modell: "pauschale",
      pauschale_betrag: 1720,
    });
  });
});
