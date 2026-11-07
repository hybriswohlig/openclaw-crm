import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

import { abschlussAuswerten } from "./background-jobs";

describe("abschlussAuswerten (Antwort von store-as-document)", () => {
  it("abgelegt und schon vom Cron erledigt zählen als angehängt", () => {
    expect(abschlussAuswerten(true, { status: "abgelegt", dealDocumentId: "d", rechnungFaelligAm: "2026-12-01" }, 200)).toEqual({
      art: "abgelegt",
      rechnungFaelligAm: "2026-12-01",
    });
    expect(abschlussAuswerten(true, { status: "schon_erledigt", dealDocumentId: null }, 200)).toEqual({
      art: "abgelegt",
      rechnungFaelligAm: null,
    });
  });

  it("Auftragsanweisung (alter Weg ohne status) bleibt angehängt", () => {
    expect(abschlussAuswerten(true, {}, 200).art).toBe("abgelegt");
  });

  it("läuft: nochmal fragen", () => {
    expect(abschlussAuswerten(true, { status: "laeuft" }, 202)).toEqual({ art: "nochmal" });
  });

  it("verworfen und Fehler: Text zeigen", () => {
    expect(abschlussAuswerten(false, { status: "verworfen", grund: "version_veraltet", error: "KV verworfen" }, 409)).toEqual({
      art: "fehler",
      text: "KV verworfen",
    });
    expect(abschlussAuswerten(false, { error: "Job nicht gefunden" }, 404)).toEqual({ art: "fehler", text: "Job nicht gefunden" });
    expect(abschlussAuswerten(false, null, 500)).toEqual({ art: "fehler", text: "upload 500" });
  });
});
