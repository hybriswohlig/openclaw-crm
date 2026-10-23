import { describe, expect, it } from "vitest";
import robots from "./robots";

describe("robots.txt", () => {
  it("sperrt das ganze CRM für alle Crawler", () => {
    expect(robots().rules).toEqual([{ userAgent: "*", disallow: "/" }]);
  });

  it("lädt keinen Crawler mehr ein und verweist auf keine Sitemap", () => {
    const ergebnis = robots();
    expect(ergebnis.sitemap).toBeUndefined();
    const regeln = Array.isArray(ergebnis.rules) ? ergebnis.rules : [ergebnis.rules];
    expect(regeln.some((r) => "allow" in r)).toBe(false);
    expect(JSON.stringify(ergebnis)).not.toMatch(/GPTBot|ClaudeBot|PerplexityBot/);
  });
});
