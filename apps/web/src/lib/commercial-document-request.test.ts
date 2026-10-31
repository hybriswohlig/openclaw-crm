import { describe, expect, it } from "vitest";
import {
  kottkeUsesInRepoRenderer,
  parseDocumentOptions,
  parsePreviewBody,
  parseRenderBody,
} from "./commercial-document-request";

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
    expect(parsed.value.options).toEqual({});
    expect(JSON.stringify(parsed.value)).not.toContain("INTERN-NOTIZ");
    expect(JSON.stringify(parsed.value)).not.toContain("pauschale");
  });

  it("reads hourly lines, card off, sofort, and the § 35a block", () => {
    const options = parseDocumentOptions({
      lineItems: [
        {
          description: "Inhouse-Umzug 1. OG ins EG",
          workers: 3,
          hours: "4,75",
          rate: 105,
          includesTravel: true,
        },
      ],
      allowCard: false,
      dueDate: "sofort",
      salutation: "frau",
      invoiceNumber: "RE-2026-014",
      section35a: { amount: "498,75", leistungsort: "Gartenstr. 4, 72202 Nagold" },
      preise: { pauschale_betrag: 1, modell: "pauschale" },
    });
    expect(options.lineItems?.[0]).toMatchObject({
      description: "Inhouse-Umzug 1. OG ins EG",
      workers: 3,
      hours: 4.75,
      rate: 105,
      includesTravel: true,
    });
    expect(options.allowCard).toBe(false);
    expect(options.dueDate).toBe("sofort");
    expect(options.salutation).toBe("frau");
    expect(options.section35a).toEqual({
      labourCents: 49875,
      serviceAddress: "Gartenstr. 4, 72202 Nagold",
    });
    expect(JSON.stringify(options)).not.toContain("Pauschale");
    expect(JSON.stringify(options)).not.toContain("Umzug von");
  });

  it("turns a stundensatz payload into one hourly line", () => {
    const options = parseDocumentOptions({
      positionDescription: "Inhouse-Umzug 1. OG ins EG",
      preise: {
        modell: "stundensatz",
        helfer_anzahl: 3,
        stunden_geschaetzt: 4.75,
        stundensatz_eur: 105,
      },
      dueDate: "31.10.2026",
    });
    expect(options.lineItems).toEqual([
      {
        description: "Inhouse-Umzug 1. OG ins EG",
        workers: 3,
        hours: 4.75,
        rate: 105,
        includesTravel: true,
      },
    ]);
    expect(options.dueDate).toBe("2026-10-31");
    expect(JSON.stringify(options)).not.toContain("Pauschale");
  });

  it("routes only Kottke RE and AB, plus an explicit crm renderer, off the VPS", () => {
    expect(kottkeUsesInRepoRenderer({ firma: "kottke", documentType: "RE", renderer: "vps" })).toBe(true);
    expect(kottkeUsesInRepoRenderer({ firma: "Kottke", documentType: "ab" })).toBe(true);
    expect(kottkeUsesInRepoRenderer({ firma: "kottke", documentType: "KV", renderer: "vps" })).toBe(false);
    expect(kottkeUsesInRepoRenderer({ firma: "ceylan", documentType: "RE", renderer: "vps" })).toBe(false);
    expect(kottkeUsesInRepoRenderer({ firma: "ceylan", documentType: "RE", renderer: "crm" })).toBe(true);
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
