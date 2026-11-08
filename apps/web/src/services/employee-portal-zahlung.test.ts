import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));
import { zahlungFuerApp } from "./employee-portal-data";

describe("Mitarbeiter-App: offener Betrag aus offenAus (Fix-Welle M5)", () => {
  it("bekannter Rest gewinnt gegen den Festpreis", () => {
    // Angenommen 1.100 €, Festpreis 1.300 €, 200 € gezahlt.
    expect(zahlungFuerApp({ gesamtCent: 110000, restCent: 90000 }, 1300, 200)).toEqual({ price: 1100, paid: 200, outstanding: 900 });
  });

  it("Stunden-KV ohne Rechnung: bisherige Schätzung", () => {
    expect(zahlungFuerApp({ gesamtCent: null, restCent: null }, 480, 0)).toEqual({ price: 480, paid: 0, outstanding: 480 });
    expect(zahlungFuerApp(null, 480, 500)).toEqual({ price: 480, paid: 500, outstanding: 0 });
  });
});
