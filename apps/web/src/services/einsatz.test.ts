import { describe, expect, it, vi } from "vitest";
import type { RechnerErgebnis } from "./rechner/client";

vi.mock("@/db", () => ({ db: {} }));

const { rechnerDatenAus } = await import("./einsatz");

const ergebnis = (buchung?: RechnerErgebnis["buchung"]): RechnerErgebnis =>
  ({
    empfehlungOptionId: "o1",
    fahrzeugoptionen: [{ id: "o1", name: "Sprinter L", fahrten: 1, km: 40, fahrtMin: 60, teamgroesse: 3 }],
    kosten: { selbstkosten: 800, posten: [{ key: "fahrzeug.k@s.miete", bezeichnung: "Sprinter L: Anteil Buchung", menge: 1, einheit: "Anteil", satz: 150, betrag: 150 }] },
    ...(buchung ? { buchung } : {}),
  }) as RechnerErgebnis;

describe("rechnerDatenAus (Review M3)", () => {
  const anfrage = { buchung: '{"id":"b1"}' };
  it("„Anteil Buchung“ nur, wenn die Buchung am Hauptdatum gilt", () => {
    expect(rechnerDatenAus(anfrage, ergebnis({ id: "b1", hauptdatum: true }))?.fahrzeugName).toBe("Sprinter L, Anteil Buchung");
    expect(rechnerDatenAus(anfrage, ergebnis({ id: "b1", hauptdatum: false }))?.fahrzeugName).toBe("Sprinter L");
    expect(rechnerDatenAus(anfrage, ergebnis())?.fahrzeugName).toBe("Sprinter L");
  });
});
