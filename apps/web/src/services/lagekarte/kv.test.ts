import { describe, expect, it } from "vitest";
import { kvDokument } from "./kv";

const d = (id: string, iso: string) => ({ id, uploadedAt: new Date(iso) });

describe("kvDokument", () => {
  it("angenommen → gebundenes PDF, auch wenn ein neueres existiert", () => {
    expect(kvDokument({ angenommenDokumentId: "alt", angenommen: true, docs: [d("alt", "2026-10-01"), d("neu", "2026-10-06")] })).toEqual({ dokumentId: "alt", dokumentStand: "angenommen" });
  });
  it("ohne Annahme: neuestes PDF, auch wenn das Angebot danach gespeichert wurde", () => {
    expect(kvDokument({ angenommenDokumentId: null, angenommen: false, docs: [d("a", "2026-10-01"), d("c", "2026-10-07"), d("b", "2026-10-06")] })).toEqual({ dokumentId: "c", dokumentStand: "aktuell" });
  });
  it("ein älteres PDF bleibt das aktuelle, ein späteres Speichern der Angebotszeile blendet es nicht aus", () => {
    expect(kvDokument({ angenommenDokumentId: null, angenommen: false, docs: [d("a", "2026-10-01")] })).toEqual({ dokumentId: "a", dokumentStand: "aktuell" });
  });
  it("ohne PDF: keins, das Portal zeigt dann das HTML-Angebot", () => {
    expect(kvDokument({ angenommenDokumentId: null, angenommen: false, docs: [] })).toEqual({ dokumentId: null, dokumentStand: "keins" });
  });
  it("Annahme ohne gebundenes PDF fällt auf das neueste zurück", () => {
    expect(kvDokument({ angenommenDokumentId: null, angenommen: true, docs: [d("x", "2026-10-02")] })).toEqual({ dokumentId: "x", dokumentStand: "aktuell" });
  });
  it("gelöschtes gebundenes PDF fällt auf das neueste verbleibende zurück", () => {
    expect(kvDokument({ angenommenDokumentId: "weg", angenommen: true, docs: [d("a", "2026-10-01"), d("b", "2026-11-02")] })).toEqual({ dokumentId: "b", dokumentStand: "aktuell" });
  });
  it("Annahme ohne jedes PDF → keins", () => {
    expect(kvDokument({ angenommenDokumentId: "weg", angenommen: true, docs: [] })).toEqual({ dokumentId: null, dokumentStand: "keins" });
  });
});
