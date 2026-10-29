import { describe, expect, it } from "vitest";
import { gesperrtHinweis, neuerLinkBestaetigung, sperrBestaetigungText } from "./customer-link-sperre";

describe("sperrBestaetigungText", () => {
  it("ohne laufende Widerrufsfrist: die bisherige Frage", () => {
    expect(sperrBestaetigungText(null)).toBe(
      "Soll der Kunden-Link wirklich gesperrt werden? Bestehende Bestätigungen bleiben erhalten."
    );
  });

  it("mit laufender Frist: warnt und empfiehlt einen neuen Link", () => {
    const text = sperrBestaetigungText("2026-11-12");
    expect(text).toContain("bis einschließlich 12.11.2026");
    expect(text).toContain("keinen Widerrufsbutton");
    expect(text).toContain("„Neuer Link“");
  });
});

describe("gesperrtHinweis", () => {
  it("nur während der Frist", () => {
    expect(gesperrtHinweis(null)).toBeNull();
    const text = gesperrtHinweis("2026-11-12");
    expect(text).toContain("bis einschließlich 12.11.2026");
    expect(text).toContain("Solange der Link gesperrt ist");
  });
});

describe("neuerLinkBestaetigung", () => {
  it("sagt, dass der alte Link danach nicht mehr geht", () => {
    expect(neuerLinkBestaetigung()).toContain("bisherige Link funktioniert danach nicht mehr");
  });
});
