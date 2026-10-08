import { afterEach, describe, expect, it, vi } from "vitest";
import {
  angezeigteStufe,
  erstelleStufenProtokoll,
  leseStufe,
  pruefeRueckgaengig,
  stufeNachlesen,
  stufenName,
} from "./stufen-wechsel";

describe("erstelleStufenProtokoll", () => {
  it("nur die jüngste Änderung je Lead gilt (zwei Änderungen hintereinander)", () => {
    const p = erstelleStufenProtokoll();
    const erste = p.beginne("lead-a");
    p.beende(erste);
    const zweite = p.beginne("lead-a");
    expect(p.istJuengste(erste)).toBe(false);
    expect(p.istJuengste(zweite)).toBe(true);
  });

  it("Änderungen an einem anderen Lead machen nichts veraltet", () => {
    const p = erstelleStufenProtokoll();
    const a = p.beginne("lead-a");
    p.beginne("lead-b");
    expect(p.istJuengste(a)).toBe(true);
  });

  it("ein begonnenes Rückgängig macht die Änderung veraltet (zweiter Klick schreibt nicht)", () => {
    const p = erstelleStufenProtokoll();
    const aenderung = p.beginne("lead-a");
    p.beende(aenderung);
    p.beginne("lead-a"); // Rückgängig
    expect(p.istJuengste(aenderung)).toBe(false);
  });

  it("laeuft: offen bis beende, je Lead getrennt", () => {
    const p = erstelleStufenProtokoll();
    expect(p.laeuft("lead-a")).toBe(false);
    const a = p.beginne("lead-a");
    expect(p.laeuft("lead-a")).toBe(true);
    expect(p.laeuft("lead-b")).toBe(false);
    p.beende(a);
    expect(p.laeuft("lead-a")).toBe(false);
  });

  it("laeuft folgt der jüngsten Änderung, nicht einer älteren, die später endet", () => {
    const p = erstelleStufenProtokoll();
    const alt = p.beginne("lead-a");
    const neu = p.beginne("lead-a");
    p.beende(neu);
    expect(p.laeuft("lead-a")).toBe(false);
    p.beende(alt);
    expect(p.laeuft("lead-a")).toBe(false);
  });
});

describe("pruefeRueckgaengig", () => {
  it("schreibt, wenn die Änderung die jüngste ist und noch gespeichert ist", () => {
    expect(pruefeRueckgaengig(true, "verloren", "verloren")).toEqual({ ok: true });
  });

  it("bricht ab, wenn danach noch einmal geändert wurde", () => {
    expect(pruefeRueckgaengig(false, "verloren", "verloren")).toEqual({ ok: false, grund: "veraltet" });
  });

  it("bricht ab, wenn inzwischen jemand anderes eine andere Stufe gespeichert hat", () => {
    expect(pruefeRueckgaengig(true, "bezahlt", "verloren")).toEqual({ ok: false, grund: "fremd", gespeichert: "bezahlt" });
  });

  it("bricht ab, wenn die Stufe inzwischen entfernt wurde", () => {
    expect(pruefeRueckgaengig(true, null, "verloren")).toEqual({ ok: false, grund: "fremd", gespeichert: null });
  });
});

describe("angezeigteStufe", () => {
  const stufen = [
    { id: "s1", titel: "In Kontakt", farbe: "#111" },
    { id: "s2", titel: "Verloren", farbe: "#222" },
  ];
  const leadStufe = { id: "alt", titel: "Archiv", farbe: "#999" };

  it("zeigt die ausgewählte Stufe aus der Liste", () => {
    expect(angezeigteStufe("s2", stufen, leadStufe)).toEqual({ titel: "Verloren", farbe: "#222" });
  });

  it("nimmt die Stufe des Leads, wenn genau sie ausgewählt ist und in der Liste fehlt", () => {
    expect(angezeigteStufe("alt", stufen, leadStufe)).toEqual({ titel: "Archiv", farbe: "#999" });
  });

  it("leere Auswahl (keine Stufe) fällt nicht auf die alte Stufe des Leads zurück", () => {
    expect(angezeigteStufe("", stufen, { id: "s2", titel: "Verloren", farbe: "#222" })).toBeNull();
  });

  it("unbekannte Auswahl liefert null statt einer fremden Stufe", () => {
    expect(angezeigteStufe("weg", stufen, leadStufe)).toBeNull();
  });
});

describe("stufenName", () => {
  const stufen = [
    { id: "s1", titel: "In Kontakt" },
    { id: "s2", titel: "Verloren" },
  ];

  it("liefert den Titel, „keine Stufe“ für null und einen Platzhalter für Unbekanntes", () => {
    expect(stufenName("s2", stufen)).toBe("Verloren");
    expect(stufenName(null, stufen)).toBe("keine Stufe");
    expect(stufenName("weg", stufen)).toBe("unbekannte Stufe");
  });
});

describe("leseStufe", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function antwort(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }

  it("liest values.stage über die Deal-Route (ohne Cache, ID kodiert)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(antwort(200, { data: { id: "a/b", values: { stage: "s2", name: "x" } } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(leseStufe("a/b")).resolves.toBe("s2");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/objects/deals/records/a%2Fb",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("liefert null, wenn der Lead keine Stufe hat", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(antwort(200, { data: { id: "a", values: {} } })));
    await expect(leseStufe("a")).resolves.toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(antwort(200, { data: { id: "a", values: { stage: null } } })));
    await expect(leseStufe("a")).resolves.toBeNull();
  });

  it("wirft bei HTTP-Fehlern mit Statuscode", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(antwort(404, { error: { message: "Record not found" } })));
    await expect(leseStufe("a")).rejects.toThrow("Stufe konnte nicht gelesen werden (404)");
  });

  it("wirft ohne Verbindung", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(leseStufe("a")).rejects.toThrow();
  });

  it("wirft bei einer Antwort ohne JSON mit lesbarer Meldung", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })));
    await expect(leseStufe("a")).rejects.toThrow("Stufe konnte nicht gelesen werden (ungültige Antwort)");
  });
});

describe("stufeNachlesen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("liefert die Stufe oder undefined statt eines Fehlers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { values: { stage: "s1" } } }), { status: 200 })));
    await expect(stufeNachlesen("a")).resolves.toBe("s1");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(stufeNachlesen("a")).resolves.toBeUndefined();
  });
});
