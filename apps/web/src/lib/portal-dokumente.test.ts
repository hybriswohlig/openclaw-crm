import { describe, expect, it } from "vitest";
import { angezeigtesKvDokument, gueltigeAuftragsbestaetigung, serviceTypeZuSpeichern } from "./portal-dokumente";

const doc = (id: string, uploadedAt: string) => ({ id, uploadedAt: new Date(uploadedAt) });

describe("angezeigtesKvDokument", () => {
  const aktuell = doc("neu", "2026-10-02T10:00:00Z");
  const rows = [aktuell, doc("alt", "2026-09-01T10:00:00Z")];
  it("ohne Annahme: das aktuelle KV", () => {
    expect(angezeigtesKvDokument({ quotationDocumentId: null, angenommen: false, docRows: rows, aktuellesKv: aktuell })).toBe(aktuell);
  });
  it("mit gebundenem PDF: genau dieses", () => {
    expect(angezeigtesKvDokument({ quotationDocumentId: "alt", angenommen: true, docRows: rows, aktuellesKv: aktuell })?.id).toBe("alt");
  });
  it("Annahme ohne gebundenes PDF (Altbestand): Rückfall auf das aktuelle KV", () => {
    expect(angezeigtesKvDokument({ quotationDocumentId: null, angenommen: true, docRows: rows, aktuellesKv: aktuell })).toBe(aktuell);
  });
});

describe("gueltigeAuftragsbestaetigung", () => {
  const ab = doc("ab", "2026-10-03T10:00:00Z");
  it("ohne Aufhebung bleibt die AB", () => {
    expect(gueltigeAuftragsbestaetigung(ab, null)).toBe(ab);
  });
  it("AB vor der Aufhebung zählt nicht mehr", () => {
    expect(gueltigeAuftragsbestaetigung(ab, new Date("2026-10-04T10:00:00Z"))).toBeNull();
  });
  it("neue AB nach der Aufhebung zählt", () => {
    expect(gueltigeAuftragsbestaetigung(ab, new Date("2026-10-02T10:00:00Z"))).toBe(ab);
  });
});

describe("serviceTypeZuSpeichern", () => {
  it("KV mit Küche auf Umzug-Angebot: speichern", () => {
    expect(serviceTypeZuSpeichern({ documentType: "KV", gewaehlt: "kitchen_installation", gespeichert: "move", angenommen: false })).toBe("kitchen_installation");
  });
  it("gleiche Art: nichts tun", () => {
    expect(serviceTypeZuSpeichern({ documentType: "KV", gewaehlt: "move", gespeichert: "move", angenommen: false })).toBeNull();
  });
  it("nach Annahme oder bei AB/RE: nichts ändern", () => {
    expect(serviceTypeZuSpeichern({ documentType: "KV", gewaehlt: "kitchen_installation", gespeichert: "move", angenommen: true })).toBeNull();
    expect(serviceTypeZuSpeichern({ documentType: "AB", gewaehlt: "kitchen_installation", gespeichert: "move", angenommen: false })).toBeNull();
  });
});
