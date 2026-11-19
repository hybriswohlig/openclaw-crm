import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

// Statisch geladen (vi.mock wird vorgezogen): der kalte Import dauert unter Last über 5 s und lief sonst in die Test-Zeitgrenze.
import { leistungAus } from "./ablauf-fakten";

/** Kopfzeile (ablauf-fakten) nach derselben Regel wie Vorprüfung und KV-Dialog (Review Grok 19.11.). */
describe("leistungAus für die Kopfzeile", () => {
  const ohne = { leistung_akte: null, lead_type: null };
  it("Anfrageart Entrümpelung ohne Angebot und ohne Akte: Entrümpelung", () => {
    expect(leistungAus(undefined, { ...ohne, lead_type: "entruempelung" })).toBe("clearance");
    expect(leistungAus(undefined, ohne)).toBe("move");
  });
  it("Akte schlägt unbestätigten Umzug, nicht aber eine Leistung im Angebot", () => {
    const angebot = (service_type: string, extra: Record<string, unknown> = {}) =>
      ({ service_type, mit_entruempelung: null, ...extra }) as unknown as Parameters<typeof leistungAus>[0];
    expect(leistungAus(angebot("move"), { ...ohne, leistung_akte: "kitchen_installation" })).toBe("kitchen_installation");
    expect(leistungAus(angebot("move", { bestaetigt: true }), { ...ohne, leistung_akte: "clearance" })).toBe("move");
    expect(leistungAus(angebot("clearance"), { ...ohne, leistung_akte: "move" })).toBe("clearance");
    expect(leistungAus(angebot("move", { mit_entruempelung: "true" }), ohne)).toBe("clearance_move");
  });
});
