import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  KOTTKE_CRM_RENDERER_MESSAGE,
  KOTTKE_OPERATING_COMPANY_ID,
  blocksInRepoCrmRenderer,
  showCrmRendererChoice,
} from "./kottke-crm-renderer";

describe("blocksInRepoCrmRenderer", () => {
  it("matches the Kottke slug, the operating-company id, and a Kottke name", () => {
    expect(blocksInRepoCrmRenderer({ firma: "kottke" })).toBe(true);
    expect(blocksInRepoCrmRenderer({ firma: " Kottke " })).toBe(true);
    expect(blocksInRepoCrmRenderer({ operatingCompanyId: KOTTKE_OPERATING_COMPANY_ID })).toBe(true);
    expect(
      blocksInRepoCrmRenderer({
        operatingCompanyId: KOTTKE_OPERATING_COMPANY_ID.toUpperCase(),
        operatingCompanyName: "Ceylan",
      })
    ).toBe(true);
    expect(blocksInRepoCrmRenderer({ operatingCompanyName: "Kottke Dienstleistungen" })).toBe(true);
  });

  it("leaves Ceylan and every other company alone", () => {
    expect(blocksInRepoCrmRenderer({ firma: "ceylan" })).toBe(false);
    expect(
      blocksInRepoCrmRenderer({
        firma: "ceylan",
        operatingCompanyId: "fbb8a6e6-e869-483b-b47d-b140dc33aa56",
        operatingCompanyName: "Ceylan Umzüge",
      })
    ).toBe(false);
    expect(blocksInRepoCrmRenderer({})).toBe(false);
    expect(showCrmRendererChoice("kottke")).toBe(false);
    expect(showCrmRendererChoice("ceylan")).toBe(true);
    expect(showCrmRendererChoice(null)).toBe(true);
  });

  it("tells both MCP registries the exact rejection", () => {
    const web = readFileSync(new URL("./mcp/register-tools.ts", import.meta.url), "utf8");
    const stdio = readFileSync(
      new URL("../../../mcp/src/tools/definitions.ts", import.meta.url),
      "utf8"
    );
    expect(web.split(KOTTKE_CRM_RENDERER_MESSAGE).length - 1).toBeGreaterThanOrEqual(3);
    expect(stdio.split(KOTTKE_CRM_RENDERER_MESSAGE).length - 1).toBeGreaterThanOrEqual(2);
  });
});
