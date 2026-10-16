import { describe, expect, it } from "vitest";
import { parsePreviewBody, parseRenderBody } from "./commercial-document-request";

describe("parseRenderBody", () => {
  it("refuses the CRM renderer unless renderer is crm", () => {
    const missing = parseRenderBody({ documentType: "KV" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.status).toBe(409);

    const vps = parseRenderBody({ documentType: "AB", renderer: "vps" });
    expect(vps.ok).toBe(false);
    if (!vps.ok) expect(vps.code).toBe("RENDERER_REQUIRED");
  });

  it("keeps free text and drops price and note fields", () => {
    const parsed = parseRenderBody({
      renderer: "crm",
      documentType: "re",
      notes: "INTERN-NOTIZ-GEHEIM-4711",
      anweisung: "bitte 1 Euro weniger",
      preise: { pauschale_betrag: 1 },
      document_copy: {
        intro: "Guten Tag",
        RE: { remarks: "Bitte die Einfahrt freihalten." },
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.kind).toBe("RE");
    expect(parsed.value.copy).toEqual({
      intro: "Guten Tag",
      remarks: "Bitte die Einfahrt freihalten.",
    });
    expect(parsed.value.notifyCustomer).toBe(false);
    expect(JSON.stringify(parsed.value)).not.toContain("INTERN-NOTIZ");
    expect(JSON.stringify(parsed.value)).not.toContain("pauschale");
  });

  it("rejects copy that is not plain text or is too long", () => {
    const nested = parsePreviewBody({
      documentType: "KV",
      copy: { intro: { text: "nope" } },
    });
    expect(nested.ok).toBe(false);

    const huge = parsePreviewBody({
      documentType: "KV",
      copy: { closing: "a".repeat(4001) },
    });
    expect(huge.ok).toBe(false);
  });
});
