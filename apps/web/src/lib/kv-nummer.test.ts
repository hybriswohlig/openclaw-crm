import { describe, expect, it } from "vitest";
import { kvNummer } from "./kv-nummer";

describe("kvNummer", () => {
  it("VPS-Nummer aus dem Dateinamen, mit und ohne .pdf", () => {
    expect(kvNummer("KV-KO-20261110-ART-3")).toBe("KV-KO-20261110-ART-3");
    expect(kvNummer("KV-KO-20261110-ART-3.pdf")).toBe("KV-KO-20261110-ART-3");
    expect(kvNummer("  KV-KO-20261110-ART.pdf ")).toBe("KV-KO-20261110-ART");
  });

  it("CRM-Renderer und freie Namen: keine Nummer", () => {
    expect(kvNummer("KV-ceylan-2026-11-18-ab12cd34.pdf")).toBeNull();
    expect(kvNummer("KV-Familie-Weber-v2.pdf")).toBeNull();
    expect(kvNummer("x.pdf")).toBeNull();
  });
});
