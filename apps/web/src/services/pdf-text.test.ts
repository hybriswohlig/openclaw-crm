import { describe, expect, it } from "vitest";
import { buildDocumentModel, renderPdf } from "@openclaw-crm/document-templates";
import { vpsPreisPruefung } from "@/lib/kv-editor-anwenden";
import { PDF_SEITENTRENNER, pdfText } from "./pdf-text";

/** Ein echtes PDF aus dem CRM-Renderer (pdf-lib), gelesen mit unpdf. */
async function crmKv(): Promise<Uint8Array> {
  const model = buildDocumentModel({
    kind: "KV",
    deal: {
      firma: "ceylan",
      customerName: "Mira Beispiel",
      customerAddress: "Beispielweg 12, 70173 Stuttgart",
      serviceDate: "2026-12-15",
      documentDate: "2026-11-18",
    },
    quotation: {
      isVariable: false,
      fixedPrice: "1620.00",
      lineItems: [
        { type: "other", description: "Umzugsteam und Transporter", quantity: 1, unitRate: "1160.00" },
        { type: "other", description: "Demontage und Montage", quantity: 1, unitRate: "460.00" },
      ],
      depositRequiredCents: 20000,
      paymentMethodPreference: "bank_transfer",
      validUntil: "2026-12-31",
      summary: "Umzug laut Angebot",
      serviceType: "move",
    },
  });
  return renderPdf(model);
}

describe("pdfText", () => {
  it("liest den Text eines echten PDFs, Seiten mit Seitenvorschub getrennt", async () => {
    const bytes = await crmKv();
    const vorher = Buffer.from(bytes);
    const text = await pdfText(bytes);
    expect(text).toContain("Kostenvoranschlag");
    expect(text).toMatch(/1\.620,00\s?€/);
    expect(text.split(PDF_SEITENTRENNER).length).toBeGreaterThanOrEqual(1);
    // Die Bytes des Aufrufers bleiben unverändert (pdf.js übernimmt nur die Kopie).
    expect(Buffer.from(bytes).equals(vorher)).toBe(true);
  });

  it("ergibt mit den Beträgen des PDFs eine bestandene Preisprüfung", async () => {
    const text = await pdfText(await crmKv());
    const r = vpsPreisPruefung(text, { erwartetCent: [116000, 46000, 162000], erlaubtCent: [0, 20000, 142000] });
    expect(r.fehlt).toEqual([]);
  });

  it("wirft bei Bytes, die kein PDF sind", async () => {
    await expect(pdfText(new Uint8Array(Buffer.from("kein pdf")))).rejects.toThrow();
  });
});
