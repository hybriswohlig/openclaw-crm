import { describe, expect, it } from "vitest";
import { angezeigtesKvDokument, gueltigeAuftragsbestaetigung, loeschbar, neuestesKvDokument, oeffentlichAbrufbar, serviceTypeZuSpeichern, vertragUrl } from "./portal-dokumente";

const doc = (id: string, uploadedAt: string) => ({ id, uploadedAt: new Date(uploadedAt) });

describe("neuestesKvDokument", () => {
  it("nimmt das neueste KV, auch wenn die Angebotszeile danach gespeichert würde", () => {
    const aelter = doc("okt", "2026-10-20T16:21:30Z");
    const neuer = doc("nov", "2026-11-02T13:33:20Z");
    expect(neuestesKvDokument([aelter, neuer])?.id).toBe("nov");
    expect(neuestesKvDokument([neuer, aelter])?.id).toBe("nov");
  });
  it("ohne Dokument null: das Portal zeigt dann das HTML-Angebot", () => {
    expect(neuestesKvDokument([])).toBeNull();
  });
});

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
  it("Portal-Auswahl: neuestes KV trotz späterem Speichern, gebundenes PDF bleibt, ohne Datei HTML", () => {
    const okt = doc("okt", "2026-10-20T16:21:30Z");
    const nov = doc("nov", "2026-11-02T13:33:20Z");
    const dateien = [okt, nov];
    const aktuell = neuestesKvDokument(dateien);
    expect(angezeigtesKvDokument({ quotationDocumentId: null, angenommen: false, docRows: dateien, aktuellesKv: aktuell })?.id).toBe("nov");
    expect(angezeigtesKvDokument({ quotationDocumentId: "okt", angenommen: true, docRows: dateien, aktuellesKv: aktuell })?.id).toBe("okt");
    expect(angezeigtesKvDokument({ quotationDocumentId: null, angenommen: false, docRows: [], aktuellesKv: neuestesKvDokument([]) })).toBeNull();
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

describe("Entrümpelung: Leistungsart im CRM, Umzugs-Layout auf dem VPS", () => {
  it("der VPS bekommt für Entrümpelung das Umzugs-Layout", async () => {
    const { vpsLeistungsart } = await import("./portal-dokumente");
    expect(vpsLeistungsart("clearance")).toBe("move");
    expect(vpsLeistungsart("move")).toBe("move");
    expect(vpsLeistungsart("kitchen_installation")).toBe("kitchen_installation");
  });
  it("beim KV wird Entrümpelung am Angebot gespeichert", async () => {
    const { serviceTypeZuSpeichern } = await import("./portal-dokumente");
    expect(serviceTypeZuSpeichern({ documentType: "KV", gewaehlt: "clearance", gespeichert: "move", angenommen: false })).toBe("clearance");
  });
});

describe("oeffentlichAbrufbar", () => {
  it("nur KV, AB, Rechnung und unterschriebener Vertrag", () => {
    for (const t of ["quotation", "order_confirmation", "invoice", "signed_contract"]) expect(oeffentlichAbrufbar(t)).toBe(true);
    for (const t of ["worker_instructions", "payment_confirmation", "", "foo"]) expect(oeffentlichAbrufbar(t)).toBe(false);
  });
});

describe("vertragUrl", () => {
  it("nur bei aktiver Annahme mit Dokument", () => {
    expect(vertragUrl({ token: "t", angenommen: true, vertragDocumentId: "d1" })).toBe("/api/public/t/documents/d1");
    expect(vertragUrl({ token: "t", angenommen: false, vertragDocumentId: "d1" })).toBeNull();
    expect(vertragUrl({ token: "t", angenommen: true, vertragDocumentId: null })).toBeNull();
  });
});

describe("loeschbar", () => {
  it("der unterschriebene Vertrag ist im CRM nicht löschbar, alles andere schon", () => {
    expect(loeschbar("signed_contract")).toBe(false);
    for (const t of ["quotation", "order_confirmation", "invoice", "payment_confirmation", "worker_instructions"]) expect(loeschbar(t)).toBe(true);
  });
});
