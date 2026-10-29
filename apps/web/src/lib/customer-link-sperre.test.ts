import { describe, expect, it } from "vitest";
import { gesperrtHinweis, sperrBestaetigungText } from "./customer-link-sperre";

describe("sperrBestaetigungText", () => {
  it("ohne laufende Widerrufsfrist: die bisherige Frage", () => {
    expect(sperrBestaetigungText(null)).toBe(
      "Soll der Kunden-Link wirklich gesperrt werden? Bestehende Bestätigungen bleiben erhalten."
    );
  });

  it("mit laufender Frist: warnt, dass der Widerrufsbutton wegfällt", () => {
    const text = sperrBestaetigungText("2026-11-12");
    expect(text).toContain("bis 12.11.2026 widerrufen");
    expect(text).toContain("Widerrufsbutton");
    expect(text).toContain("Re-aktivieren");
  });
});

describe("gesperrtHinweis", () => {
  it("nur während der Frist", () => {
    expect(gesperrtHinweis(null)).toBeNull();
    expect(gesperrtHinweis("2026-11-12")).toContain("12.11.2026");
  });
});
