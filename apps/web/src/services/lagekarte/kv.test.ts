import { describe, expect, it } from "vitest";
import { kvDokument } from "./kv";

const d = (id: string, iso: string) => ({ id, uploadedAt: new Date(iso) });

describe("kvDokument", () => {
  it("angenommen → gebundenes PDF", () => {
    expect(kvDokument({ angenommenDokumentId: "alt", angenommen: true, quotationUpdatedAt: new Date("2026-10-05"), docs: [d("alt", "2026-10-01"), d("neu", "2026-10-06")] })).toEqual({ dokumentId: "alt", dokumentStand: "angenommen" });
  });
  it("ohne Annahme: neuestes PDF, das nicht älter als das Angebot ist", () => {
    expect(kvDokument({ angenommenDokumentId: null, angenommen: false, quotationUpdatedAt: new Date("2026-10-05"), docs: [d("a", "2026-10-01"), d("b", "2026-10-06"), d("c", "2026-10-07")] })).toEqual({ dokumentId: "c", dokumentStand: "aktuell" });
  });
  it("nur ältere PDFs → veraltet, kein Link", () => {
    expect(kvDokument({ angenommenDokumentId: null, angenommen: false, quotationUpdatedAt: new Date("2026-10-05"), docs: [d("a", "2026-10-01")] })).toEqual({ dokumentId: null, dokumentStand: "veraltet" });
  });
  it("keine PDFs → keins", () => {
    expect(kvDokument({ angenommenDokumentId: null, angenommen: false, quotationUpdatedAt: null, docs: [] })).toEqual({ dokumentId: null, dokumentStand: "keins" });
  });
  it("Annahme ohne gebundenes PDF fällt auf aktuelles zurück", () => {
    expect(kvDokument({ angenommenDokumentId: null, angenommen: true, quotationUpdatedAt: null, docs: [d("x", "2026-10-02")] })).toEqual({ dokumentId: "x", dokumentStand: "aktuell" });
  });
  it("Annahme mit gebundenem PDF, das gelöscht wurde, und nur älteren PDFs → veraltet", () => {
    expect(kvDokument({ angenommenDokumentId: "weg", angenommen: true, quotationUpdatedAt: new Date("2026-10-05"), docs: [d("a", "2026-10-01")] })).toEqual({ dokumentId: null, dokumentStand: "veraltet" });
  });
  it("Annahme ohne jedes PDF → keins", () => {
    expect(kvDokument({ angenommenDokumentId: "weg", angenommen: true, quotationUpdatedAt: null, docs: [] })).toEqual({ dokumentId: null, dokumentStand: "keins" });
  });
});
