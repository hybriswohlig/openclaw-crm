import { describe, expect, it, vi } from "vitest";
import { kundeVorschlag, type VorschlagQuellen } from "./kunde-vorschlag";

function quellen(over: Partial<VorschlagQuellen> = {}): VorschlagQuellen {
  return {
    ki: vi.fn(async () => null),
    kiGespeichert: vi.fn(async () => null),
    texte: vi.fn(async () => []),
    ...over,
  };
}

describe("kundeVorschlag (Aus dem Chat übernehmen)", () => {
  it("Viktoria: die KI liest Name, E-Mail und Adressen mit Straße aus dem Chat", async () => {
    const q = quellen({
      ki: vi.fn(async () => ({
        customer_name: "Viktoria Muster",
        customer_email: "V.Muster@beispiel.de",
        customer_phone: "0171 2345678",
        move_from_address: "Hauptstraße 1, 72218 Wildberg",
        move_to_address: "Bahnhofstr. 5, 71032 Böblingen",
      })),
    });
    expect(await kundeVorschlag("ws", "d1", q)).toEqual({
      quelle: "ki",
      name: "Viktoria Muster",
      email: "v.muster@beispiel.de",
      telefon: "0171 2345678",
      auszug: { strasse: "Hauptstraße 1", plz: "72218", ort: "Wildberg" },
      einzug: { strasse: "Bahnhofstr. 5", plz: "71032", ort: "Böblingen" },
      hinweis: null,
    });
    // Mit beiden Adressen aus der KI wird nichts weiter gelesen.
    expect(q.kiGespeichert).not.toHaveBeenCalled();
    expect(q.texte).not.toHaveBeenCalled();
  });

  it("Rückfall: gespeicherte KI-Adresse, dann Erkennung in den Nachrichten (nur PLZ und Ort)", async () => {
    const q = quellen({
      ki: vi.fn(async () => ({ customer_name: null, move_from_address: null, move_to_address: null })),
      kiGespeichert: vi.fn(async () => ({ von: "Königstr. 1, 70173 Stuttgart", nach: null })),
      texte: vi.fn(async () => ["Hallo, wir ziehen nach 71032 Böblingen.\nViele Grüße\nTel 0711 123456, 70999 Irgendwo"]),
    });
    const v = await kundeVorschlag("ws", "d1", q);
    expect(v.auszug).toEqual({ strasse: "Königstr. 1", plz: "70173", ort: "Stuttgart" });
    expect(v.einzug).toEqual({ strasse: "", plz: "71032", ort: "Böblingen" });
    expect(v.quelle).toBe("ki_gespeichert");
    expect(v.name).toBeNull();
  });

  it("Telefonnummern und Kundennummern aus der KI landen nie als Adresse", async () => {
    const v = await kundeVorschlag(
      "ws",
      "d1",
      quellen({
        ki: vi.fn(async () => ({
          move_from_address: "Tel. 0711 123456, 70372 Stuttgart",
          move_to_address: "Kundennummer 12345",
          customer_email: "abc@mail.kleinanzeigen.de",
        })),
      })
    );
    expect(v.auszug).toEqual({ strasse: "", plz: "70372", ort: "Stuttgart" });
    expect(v.einzug).toBeNull();
    expect(v.email).toBeNull();
  });

  it("KI-Fehler: Erkennung trotzdem, sonst ein Hinweis", async () => {
    const kaputt = vi.fn(async () => {
      throw new Error("VPS weg");
    });
    const leer = await kundeVorschlag("ws", "d1", quellen({ ki: kaputt }));
    expect(leer.quelle).toBeNull();
    expect(leer.hinweis).toBe("Die KI-Auswertung hat nicht geklappt, und in den Nachrichten steht keine Adresse mit PLZ und Ort.");
    const erkannt = await kundeVorschlag(
      "ws",
      "d1",
      quellen({ ki: kaputt, texte: vi.fn(async () => ["Wir ziehen von 70372 Stuttgart nach 71032 Böblingen"]) })
    );
    expect(erkannt.quelle).toBe("erkennung");
    expect(erkannt.auszug).toEqual({ strasse: "", plz: "70372", ort: "Stuttgart" });
    expect(erkannt.einzug).toEqual({ strasse: "", plz: "71032", ort: "Böblingen" });
  });
});
