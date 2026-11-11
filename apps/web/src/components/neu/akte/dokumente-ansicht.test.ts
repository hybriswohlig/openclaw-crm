import { describe, expect, it } from "vitest";
import { kvErsetzt, kvMeta, kvNummer } from "./dokumente-ansicht";

describe("KV in den Dokumenten (Plan 16)", () => {
  it("Nummer aus dem VPS-Dateinamen, sonst keine; Version als „Kalkulation vN“", () => {
    expect(kvNummer("KV-KO-20261110-ART-3.pdf")).toBe("KV-KO-20261110-ART-3");
    expect(kvNummer("KV-ceylan-2026-11-11-ab12cd34.pdf")).toBeNull();
    expect(kvMeta({ fileName: "KV-KO-20261110-ART-3.pdf", kvVersion: 3 })).toBe("Nr. KV-KO-20261110-ART-3 · Kalkulation v3 · ");
    expect(kvMeta({ fileName: "KV-Familie-Weber-v2.pdf", kvVersion: 2 })).toBe("Kalkulation v2 · ");
    expect(kvMeta({ fileName: "x.pdf", kvVersion: null })).toBe("");
  });

  it("ersetzt: nicht der neueste KV oder ältere Version als die maßgebliche", () => {
    expect(kvErsetzt({ id: "a", documentType: "quotation", kvVersion: 2 }, "b", null)).toBe(true);
    expect(kvErsetzt({ id: "b", documentType: "quotation", kvVersion: 2 }, "b", 3)).toBe(true);
    expect(kvErsetzt({ id: "b", documentType: "quotation", kvVersion: 3 }, "b", 3)).toBe(false);
    expect(kvErsetzt({ id: "x", documentType: "invoice", kvVersion: null }, "b", 3)).toBe(false);
  });
});
